using System.Globalization;
using System.Net.Mail;
using System.Text;
using Cria.Domain;

namespace Cria.Application;

public sealed record AccountUser(string Id, string Name, string Email);
public sealed record SavedAddress(string Id, string Alias, string Address, Point Point);
public sealed record TransitLine(string Line, string Mode, string Name);
public sealed record FavoriteLine(string Id, string Line, string Mode, string Name);
public sealed record AccountData(SavedAddress[] Addresses, FavoriteLine[] Lines);

public interface IAccounts
{
    AccountUser Register(string name, string email, string password);
    AccountUser Login(string email, string password);
    string CreateSession(string userId, DateTimeOffset expires);
    AccountUser? ValidateSession(string session, string userId);
    void RevokeSession(string session);
    AccountData GetData(string userId);
    SavedAddress SaveAddress(string userId, string? id, string alias, string address, Point point);
    void DeleteAddress(string userId, string id);
    FavoriteLine SaveLine(string userId, TransitLine line);
    void DeleteLine(string userId, string id);
    void ChangePassword(string userId, string password, string newPassword);
    void DeleteAccount(string userId, string password);
}

public static class AccountRules
{
    public static string Text(string? value, int maximum, string field)
    {
        var clean = value?.Trim() ?? "";
        if (clean.Length is 0 || clean.Length > maximum || clean.Any(char.IsControl))
            throw new AppError(400, $"{field} deve ter de 1 a {maximum} caracteres.");
        return clean;
    }

    public static string Email(string? value)
    {
        var email = Text(value, 254, "E-mail");
        if (!MailAddress.TryCreate(email, out var parsed) || parsed.Address != email ||
            !parsed.Host.Contains('.') || email.Any(char.IsWhiteSpace))
            throw new AppError(400, "Informe um e-mail válido.");
        return email;
    }

    public static void Password(string? value)
    {
        if (value is null || value.Length is < 12 or > 128)
            throw new AppError(400, "A senha deve ter de 12 a 128 caracteres.");
    }

    public static string Key(string value) => string.Concat(value.Normalize(NormalizationForm.FormD)
        .Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark))
        .Normalize(NormalizationForm.FormC).ToUpperInvariant();
}

public sealed class LineCatalog(ITransitStore store)
{
    public TransitLine[] Search(string? query)
    {
        var text = (query ?? "").Trim();
        if (text.Length > 80) throw new AppError(400, "Busca de linha muito longa.");
        if (text.Length == 0) return [];
        var key = AccountRules.Key(text);
        return All().Where(l => AccountRules.Key(l.Line + " " + l.Name).Contains(key, StringComparison.Ordinal))
            .OrderBy(l => AccountRules.Key(l.Line) == key ? 0 : 1)
            .ThenBy(l => l.Line.Length).ThenBy(l => l.Line, StringComparer.Ordinal)
            .Take(25).ToArray();
    }

    public TransitLine Find(string? mode, string? line) => All()
        .FirstOrDefault(l => l.Mode == mode && string.Equals(l.Line, line?.Trim(), StringComparison.OrdinalIgnoreCase))
        ?? throw new AppError(400, "Escolha uma linha do catálogo de transporte.");

    private TransitLine[] All() => store.Get().Patterns.GroupBy(p => (p.Mode, AccountRules.Key(p.Line)))
        .Select(group => new TransitLine(group.First().Line, group.First().Mode, group.First().Name)).ToArray();
}
