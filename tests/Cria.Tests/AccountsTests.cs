using Cria.Application;
using Cria.Domain;
using Cria.Infrastructure;
using Npgsql;
using Microsoft.Extensions.Configuration;

namespace Cria.Tests;

public sealed class AccountsTests : IDisposable
{
    private const string Password = "a long test phrase 123";
    private readonly PostgresFixture fixture = new();
    private readonly Clock clock = new();
    private readonly Accounts accounts;
    private static readonly Point Home = new(-22.9566277, -43.1837086);

    public AccountsTests()
    {
        accounts = new(fixture.Database, clock);
    }
    private AccountUser User(string email = "joao@example.test") => accounts.Register(" João ", email, Password);
    private static void Error(int status, Action action) => Assert.Equal(status, Assert.Throws<AppError>(action).Status);
    private object Scalar(string sql)
    {
        using var connection = fixture.Database.Open();
        using var command = connection.CreateCommand(); command.CommandText = sql;
        return command.ExecuteScalar()!;
    }

    [Fact]
    public void RegistrationNormalizesEmailAndStoresOnlyPasswordHash()
    {
        var user = User(" Joao@Example.test ");
        Assert.Equal("João", user.Name);
        Assert.Equal(user, accounts.Login("joao@example.TEST", Password));
        Error(409, () => User("JOAO@example.test"));
        Assert.DoesNotContain(Password, (string)Scalar("SELECT password_hash FROM users"));
        Assert.False(accounts.GetData(user.Id).Addresses.Any());
    }

    [Theory]
    [InlineData("bad", "a long test phrase 123")]
    [InlineData("Name <joao@example.test>", "a long test phrase 123")]
    [InlineData("joao@example.test", "short")]
    public void InvalidCredentialsCannotCreateAccount(string email, string password) => Error(400, () => accounts.Register("João", email, password));

    [Fact]
    public void AddressesKeepExactCoordinatesAndEnforceOwnership()
    {
        var first = User(); var second = User("other@example.test");
        var home = accounts.SaveAddress(first.Id, null, "Casa", "Rua Oliveira Fausto, 28", Home);
        Assert.Equal(Home, Assert.Single(accounts.GetData(first.Id).Addresses).Point);
        Assert.Empty(accounts.GetData(second.Id).Addresses);
        Error(404, () => accounts.SaveAddress(second.Id, home.Id, "Stolen", "Somewhere", Home));
        Error(404, () => accounts.DeleteAddress(second.Id, home.Id));
        Error(409, () => accounts.SaveAddress(first.Id, null, "cása", "Other", Home));
        accounts.SaveAddress(second.Id, null, "Casa", "Other", Home);
        var updated = accounts.SaveAddress(first.Id, home.Id, "Trabalho", "New address", new(-22.92, -43.21));
        Assert.Equal("Trabalho", Assert.Single(accounts.GetData(first.Id).Addresses).Alias);
        Assert.Equal(home.Id, updated.Id);
        accounts.DeleteAddress(first.Id, home.Id);
        Assert.Empty(accounts.GetData(first.Id).Addresses);
    }

    [Fact]
    public void AddressesRejectInvalidPointsAndEnforceLimitWithoutBlockingEdits()
    {
        var user = User();
        foreach (var point in new[] { new Point(0, 0), new Point(double.NaN, -43.2), new Point(-22.9, double.PositiveInfinity) })
            Error(400, () => accounts.SaveAddress(user.Id, null, "Casa", "Address", point));
        for (var i = 0; i < 20; i++) accounts.SaveAddress(user.Id, null, "Lugar " + i, "Address", Home);
        Error(400, () => accounts.SaveAddress(user.Id, null, "Extra", "Address", Home));
        var item = accounts.GetData(user.Id).Addresses[0];
        accounts.SaveAddress(user.Id, item.Id, "Renamed", "Address", Home);
        Assert.Equal(20, accounts.GetData(user.Id).Addresses.Length);
    }

    [Fact]
    public void FavoriteLinesAreIdempotentAndDistinguishModesAndOwners()
    {
        var first = User(); var second = User("other@example.test");
        var line = new TransitLine("22", "bus", "Centro");
        var saved = accounts.SaveLine(first.Id, line);
        Assert.Equal(saved, accounts.SaveLine(first.Id, line));
        accounts.SaveLine(first.Id, line with { Mode = "brt" });
        Assert.Equal(2, accounts.GetData(first.Id).Lines.Length);
        Assert.Empty(accounts.GetData(second.Id).Lines);
        Error(404, () => accounts.DeleteLine(second.Id, saved.Id));
        accounts.DeleteLine(first.Id, saved.Id);
        Assert.Equal("brt", Assert.Single(accounts.GetData(first.Id).Lines).Mode);
    }

    [Fact]
    public void FavoriteLimitAllowsRepeatSaves()
    {
        var user = User();
        for (var i = 0; i < 50; i++) accounts.SaveLine(user.Id, new(i.ToString(), "bus", "Test"));
        accounts.SaveLine(user.Id, new("0", "bus", "Test"));
        Error(400, () => accounts.SaveLine(user.Id, new("Extra", "bus", "Test")));
    }

    [Fact]
    public void SessionsAreHashedScopedExpiredRevokedAndPersistent()
    {
        var first = User(); var second = User("other@example.test");
        var token = accounts.CreateSession(first.Id, clock.GetUtcNow().AddHours(1));
        Assert.DoesNotContain(token, (string)Scalar("SELECT token_hash FROM sessions"));
        Assert.Null(accounts.ValidateSession(token, second.Id));
        var reopened = new Accounts(fixture.Database, clock);
        Assert.Equal(first, reopened.ValidateSession(token, first.Id));
        accounts.RevokeSession(token);
        Assert.Null(reopened.ValidateSession(token, first.Id));
        token = accounts.CreateSession(first.Id, clock.GetUtcNow().AddHours(1));
        clock.Advance(TimeSpan.FromHours(1));
        Assert.Null(accounts.ValidateSession(token, first.Id));
    }

    [Fact]
    public void PasswordChangeRequiresCurrentPasswordAndRevokesEverySession()
    {
        var user = User();
        var token = accounts.CreateSession(user.Id, clock.GetUtcNow().AddDays(1));
        var other = accounts.CreateSession(user.Id, clock.GetUtcNow().AddDays(1));
        Error(400, () => accounts.ChangePassword(user.Id, "wrong password phrase", "another long password"));
        Assert.Equal(user, accounts.ValidateSession(token, user.Id));
        accounts.ChangePassword(user.Id, Password, "another long password");
        Assert.Null(accounts.ValidateSession(token, user.Id)); Assert.Null(accounts.ValidateSession(other, user.Id));
        Error(401, () => accounts.Login(user.Email, Password));
        Assert.Equal(user, accounts.Login(user.Email, "another long password"));
    }

    [Fact]
    public void DeletionRequiresPasswordAndCascadesSavedDataAndSessions()
    {
        var user = User();
        accounts.SaveAddress(user.Id, null, "Casa", "Address", Home);
        accounts.SaveLine(user.Id, new("22", "brt", "Test"));
        var token = accounts.CreateSession(user.Id, clock.GetUtcNow().AddDays(1));
        Error(400, () => accounts.DeleteAccount(user.Id, "wrong password phrase"));
        Assert.Single(accounts.GetData(user.Id).Addresses);
        accounts.DeleteAccount(user.Id, Password);
        foreach (var table in new[] { "users", "addresses", "favorite_lines", "sessions" }) Assert.Equal(0L, Scalar("SELECT COUNT(*) FROM " + table));
        Assert.Null(accounts.ValidateSession(token, user.Id));
        Error(401, () => accounts.Login(user.Email, Password));
    }

    [Fact]
    public void LoginLockoutExpiresAndUnknownAccountsUseSameError()
    {
        var user = User();
        var unknown = Assert.Throws<AppError>(() => accounts.Login("unknown@example.test", Password));
        for (var i = 0; i < 5; i++) Assert.Equal(unknown.Message, Assert.Throws<AppError>(() => accounts.Login(user.Email, "wrong password phrase")).Message);
        Error(401, () => accounts.Login(user.Email, Password));
        clock.Advance(TimeSpan.FromMinutes(15));
        Assert.Equal(user, accounts.Login(user.Email, Password));
        Error(401, () => accounts.Login(user.Email, "wrong password phrase"));
        Assert.Equal(user, accounts.Login(user.Email, Password));
    }

    [Fact]
    public void DatabaseCredentialsAreRequired()
    {
        Assert.Throws<InvalidOperationException>(() => new ApplicationDatabase(new ConfigurationBuilder().Build()));
    }

    [Fact]
    public void ConcurrentAddressWritesRespectTheLimit()
    {
        var user=User();
        Parallel.For(0,30,i=> { try { accounts.SaveAddress(user.Id,null,"Lugar "+i,"Address",Home); } catch(AppError e) when(e.Status==400) {} });
        Assert.Equal(20,accounts.GetData(user.Id).Addresses.Length);
    }

    public void Dispose() => fixture.Dispose();
    private sealed class Clock : TimeProvider
    {
        private DateTimeOffset now = DateTimeOffset.Parse("2026-10-09T12:00:00Z");
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(TimeSpan time) => now += time;
    }
}
