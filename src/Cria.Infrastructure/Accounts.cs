using System.Security.Cryptography;
using System.Text;
using Cria.Application;
using Cria.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Npgsql;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace Cria.Infrastructure;

public sealed class Accounts : IAccounts
{
    private readonly ApplicationDatabase database;
    private readonly TimeProvider clock;
    private readonly PasswordHasher<AccountUser> hasher = new(Options.Create(new PasswordHasherOptions { IterationCount = 210_000 }));
    private readonly AccountUser dummy = new("", "", "");
    private readonly string dummyHash;

    public Accounts(ApplicationDatabase database, TimeProvider clock)
    {
        this.clock = clock;
        this.database = database;
        dummyHash = hasher.HashPassword(dummy, WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32)));
    }

    private long Now => clock.GetUtcNow().ToUnixTimeSeconds();
    private NpgsqlConnection Open() => database.Open();
    private static NpgsqlCommand Command(NpgsqlConnection connection, string sql, NpgsqlTransaction? transaction = null, params (string Name, object Value)[] parameters)
    {
        var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Transaction = transaction;
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        return command;
    }
    private static string TokenHash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    private static AppError InvalidLogin() => new(401, "E-mail ou senha incorretos. Se necessário, aguarde alguns minutos e tente novamente.");

    public AccountUser Register(string name, string email, string password)
    {
        name = AccountRules.Text(name, 60, "Nome");
        email = AccountRules.Email(email);
        AccountRules.Password(password);
        var user = new AccountUser(Guid.NewGuid().ToString("N"), name, email);
        var hash = hasher.HashPassword(user, password);
        using var connection = Open();
        using var command = Command(connection, "INSERT INTO users(id,name,email,email_key,password_hash,created_at) VALUES(@id,@name,@email,@key,@hash,@now)", null,
            ("@id", user.Id), ("@name", name), ("@email", email), ("@key", email.ToUpperInvariant()), ("@hash", hash), ("@now", Now));
        try { command.ExecuteNonQuery(); }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation) { throw new AppError(409, "Não foi possível criar a conta com esse e-mail. Tente entrar."); }
        return user;
    }

    public AccountUser Login(string email, string password)
    {
        // Invalid input receives the same response as an unknown account.
        try { email = AccountRules.Email(email); AccountRules.Password(password); }
        catch (AppError) { throw InvalidLogin(); }
        using var connection = Open();
        AccountUser? user = null;
        var hash = dummyHash;
        long lockedUntil = 0;
        using (var command = Command(connection, "SELECT id,name,email,password_hash,locked_until FROM users WHERE email_key=@key", null, ("@key", email.ToUpperInvariant())))
        using (var reader = command.ExecuteReader())
        {
            if (reader.Read())
            {
                user = new(reader.GetString(0), reader.GetString(1), reader.GetString(2));
                hash = reader.GetString(3);
                lockedUntil = reader.GetInt64(4);
            }
        }
        var result = hasher.VerifyHashedPassword(user ?? dummy, hash, password);
        if (user is null || lockedUntil > Now) throw InvalidLogin();
        if (result == PasswordVerificationResult.Failed)
        {
            using var failure = Command(connection, """
                UPDATE users SET failures=CASE WHEN locked_until>0 AND locked_until<=@now THEN 1 ELSE failures+1 END,
                locked_until=CASE WHEN (CASE WHEN locked_until>0 AND locked_until<=@now THEN 1 ELSE failures+1 END)>=5 THEN @until ELSE 0 END
                WHERE id=@id
                """, null, ("@now", Now), ("@until", Now + 15 * 60), ("@id", user.Id));
            failure.ExecuteNonQuery();
            throw InvalidLogin();
        }
        using var success = Command(connection, "UPDATE users SET failures=0,locked_until=0,password_hash=@hash WHERE id=@id AND locked_until<=@now AND password_hash=@old", null,
            ("@hash", result == PasswordVerificationResult.SuccessRehashNeeded ? hasher.HashPassword(user, password) : hash), ("@old", hash), ("@id", user.Id), ("@now", Now));
        if (success.ExecuteNonQuery() == 0) throw InvalidLogin();
        return user;
    }

    public string CreateSession(string userId, DateTimeOffset expires)
    {
        var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        using var connection = Open();
        using var command = Command(connection, "DELETE FROM sessions WHERE expires_at<=@now; INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(@hash,@user,@expires)", null,
            ("@now", Now), ("@hash", TokenHash(token)), ("@user", userId), ("@expires", expires.ToUnixTimeSeconds()));
        command.ExecuteNonQuery();
        return token;
    }

    public AccountUser? ValidateSession(string session, string userId)
    {
        using var connection = Open();
        using var command = Command(connection, "SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=@hash AND s.user_id=@user AND s.expires_at>@now", null,
            ("@hash", TokenHash(session)), ("@user", userId), ("@now", Now));
        using var reader = command.ExecuteReader();
        return reader.Read() ? new(reader.GetString(0), reader.GetString(1), reader.GetString(2)) : null;
    }

    public void RevokeSession(string session)
    {
        using var connection = Open();
        using var command = Command(connection, "DELETE FROM sessions WHERE token_hash=@hash", null, ("@hash", TokenHash(session)));
        command.ExecuteNonQuery();
    }

    public AccountData GetData(string userId)
    {
        using var connection = Open();
        var addresses = new List<SavedAddress>();
        using (var command = Command(connection, "SELECT id,alias,address,lat,lon FROM addresses WHERE user_id=@user ORDER BY alias_key", null, ("@user", userId)))
        using (var reader = command.ExecuteReader())
            while (reader.Read()) addresses.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2), new(reader.GetDouble(3), reader.GetDouble(4))));
        var lines = new List<FavoriteLine>();
        using (var command = Command(connection, "SELECT id,line,mode,name FROM favorite_lines WHERE user_id=@user ORDER BY mode,line_key", null, ("@user", userId)))
        using (var reader = command.ExecuteReader())
            while (reader.Read()) lines.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3)));
        return new(addresses.ToArray(), lines.ToArray());
    }

    public SavedAddress SaveAddress(string userId, string? id, string alias, string address, Point point)
    {
        alias = AccountRules.Text(alias, 40, "Apelido");
        address = AccountRules.Text(address, 240, "Endereço");
        if (point is null || !point.InRioBounds) throw new AppError(400, "Escolha um endereço válido na região do Rio.");
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        LockUser(connection, transaction, userId);
        var creating = id is null;
        if (creating)
        {
            using var count = Command(connection, "SELECT COUNT(*) FROM addresses WHERE user_id=@user", transaction, ("@user", userId));
            if (Convert.ToInt32(count.ExecuteScalar()) >= 20) throw new AppError(400, "Você pode salvar até 20 lugares.");
            id = Guid.NewGuid().ToString("N");
        }
        using var command = Command(connection, creating
            ? "INSERT INTO addresses(id,user_id,alias,alias_key,address,lat,lon) VALUES(@id,@user,@alias,@key,@address,@lat,@lon)"
            : "UPDATE addresses SET alias=@alias,alias_key=@key,address=@address,lat=@lat,lon=@lon WHERE id=@id AND user_id=@user", transaction,
            ("@id", id!), ("@user", userId), ("@alias", alias), ("@key", AccountRules.Key(alias)), ("@address", address), ("@lat", point.Lat), ("@lon", point.Lon));
        try { if (command.ExecuteNonQuery() == 0) throw new AppError(404, "Lugar não encontrado."); }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation) { throw new AppError(409, "Você já tem um lugar com esse apelido."); }
        transaction.Commit();
        return new(id!, alias, address, point);
    }

    public void DeleteAddress(string userId, string id) => DeleteOwned("addresses", userId, id);
    public void DeleteLine(string userId, string id) => DeleteOwned("favorite_lines", userId, id);
    private void DeleteOwned(string table, string userId, string id)
    {
        using var connection = Open();
        using var command = Command(connection, $"DELETE FROM {table} WHERE id=@id AND user_id=@user", null, ("@id", id), ("@user", userId));
        if (command.ExecuteNonQuery() == 0) throw new AppError(404, "Item não encontrado.");
    }

    public FavoriteLine SaveLine(string userId, TransitLine line)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        LockUser(connection, transaction, userId);
        using (var existing = Command(connection, "SELECT id,line,mode,name FROM favorite_lines WHERE user_id=@user AND mode=@mode AND line_key=@key", transaction,
            ("@user", userId), ("@mode", line.Mode), ("@key", AccountRules.Key(line.Line))))
        using (var reader = existing.ExecuteReader())
            if (reader.Read()) return new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3));
        using var count = Command(connection, "SELECT COUNT(*) FROM favorite_lines WHERE user_id=@user", transaction, ("@user", userId));
        if (Convert.ToInt32(count.ExecuteScalar()) >= 50) throw new AppError(400, "Você pode salvar até 50 linhas.");
        var id = Guid.NewGuid().ToString("N");
        using var command = Command(connection, "INSERT INTO favorite_lines(id,user_id,line,line_key,mode,name) VALUES(@id,@user,@line,@key,@mode,@name)", transaction,
            ("@id", id), ("@user", userId), ("@line", line.Line), ("@key", AccountRules.Key(line.Line)), ("@mode", line.Mode), ("@name", line.Name));
        command.ExecuteNonQuery();
        transaction.Commit();
        return new(id, line.Line, line.Mode, line.Name);
    }

    public void ChangePassword(string userId, string password, string newPassword)
    {
        AccountRules.Password(newPassword);
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        var user = CheckPassword(connection, transaction, userId, password);
        var hash = hasher.HashPassword(user, newPassword);
        using var command = Command(connection, "UPDATE users SET password_hash=@hash,failures=0,locked_until=0 WHERE id=@user; DELETE FROM sessions WHERE user_id=@user", transaction,
            ("@user", userId), ("@hash", hash));
        command.ExecuteNonQuery();
        transaction.Commit();
    }

    public void DeleteAccount(string userId, string password)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        CheckPassword(connection, transaction, userId, password);
        using var command = Command(connection, "DELETE FROM users WHERE id=@user", transaction, ("@user", userId));
        command.ExecuteNonQuery();
        transaction.Commit();
    }

    private static void LockUser(NpgsqlConnection connection, NpgsqlTransaction transaction, string userId)
    {
        using var command = Command(connection, "SELECT id FROM users WHERE id=@user FOR UPDATE", transaction, ("@user", userId));
        if (command.ExecuteScalar() is null) throw new AppError(401, "Entre na sua conta.");
    }

    private AccountUser CheckPassword(NpgsqlConnection connection, NpgsqlTransaction transaction, string userId, string password)
    {
        using var command = Command(connection, "SELECT id,name,email,password_hash FROM users WHERE id=@user FOR UPDATE", transaction, ("@user", userId));
        using var reader = command.ExecuteReader();
        if (!reader.Read() || password is null || password.Length is < 12 or > 128) throw new AppError(400, "Senha atual incorreta.");
        var user = new AccountUser(reader.GetString(0), reader.GetString(1), reader.GetString(2));
        if (hasher.VerifyHashedPassword(user, reader.GetString(3), password) == PasswordVerificationResult.Failed)
            throw new AppError(400, "Senha atual incorreta.");
        return user;
    }
}
