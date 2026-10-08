using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Cria.Application;
using Cria.Domain;

namespace Cria.Infrastructure;

public sealed record CatalogPlace(string Id, string Name, string[] Aliases, string? Address,
    string Neighborhood, double? Lat, double? Lon, bool Enabled, string? Source, string? Notes = null);

/// <summary>A small, versioned catalog; coordinates are never inferred from an alias.</summary>
public sealed class LocalPlaces
{
    private sealed record Entry(string Id, Place Place, string[] Names, string[][] SearchWords);
    private readonly Entry[] entries;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };

    private LocalPlaces(CatalogPlace[] data)
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var enabled = new List<Entry>();
        foreach (var p in data)
        {
            if (p is null || p.Id is null || !Regex.IsMatch(p.Id, "^[a-z0-9][a-z0-9-]{0,79}$") || !ids.Add(p.Id) ||
                string.IsNullOrWhiteSpace(p.Name) || Normalize(p.Name).Length == 0 ||
                string.IsNullOrWhiteSpace(p.Neighborhood) || p.Aliases is null ||
                p.Aliases.Any(a => string.IsNullOrWhiteSpace(a) || Normalize(a).Length == 0))
                throw new FormatException("Invalid or duplicate place in the local catalog.");
            if ((p.Enabled || p.Lat is not null || p.Lon is not null) &&
                (p.Lat is null || p.Lon is null || !new Point(p.Lat.Value, p.Lon.Value).InRioBounds))
                throw new FormatException($"Place '{p.Id}' needs valid coordinates inside Rio's service bounds.");
            if (p.Enabled && string.IsNullOrWhiteSpace(p.Source))
                throw new FormatException($"Place '{p.Id}' needs a coordinate source.");
            if (!p.Enabled) continue;

            var names = p.Aliases.Prepend(p.Name).Select(Normalize).Distinct().ToArray();
            var label = string.Join(", ", new[] { p.Name, p.Address, p.Neighborhood, "Rio de Janeiro" }
                .Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s!.Trim()));
            var words = names.Select(n => Normalize($"{n} {p.Address} {p.Neighborhood}").Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToArray();
            enabled.Add(new(p.Id, new(label, new(p.Lat!.Value, p.Lon!.Value), "catalog"), names, words));
        }
        entries = enabled.ToArray();
    }

    public static LocalPlaces FromJson(string json) => new(
        JsonSerializer.Deserialize<CatalogPlace[]>(json, Json) ?? throw new FormatException("The place catalog must be an array."));

    public static LocalPlaces LoadBundled()
    {
        using var stream = typeof(LocalPlaces).Assembly.GetManifestResourceStream("Cria.Infrastructure.Data.places.json")
            ?? throw new InvalidOperationException("The bundled place catalog is missing.");
        using var reader = new StreamReader(stream);
        return FromJson(reader.ReadToEnd());
    }

    public static string Normalize(string text)
    {
        var result = new StringBuilder();
        foreach (var rune in text.Normalize(NormalizationForm.FormD).EnumerateRunes())
        {
            var category = Rune.GetUnicodeCategory(rune);
            if (category is UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark or UnicodeCategory.EnclosingMark)
                continue;
            result.Append(Rune.IsLetterOrDigit(rune) ? Rune.ToLowerInvariant(rune).ToString() : " ");
        }
        return string.Join(' ', result.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    public bool HasExactName(string query)
    {
        var normalized = Normalize(query);
        return normalized.Length > 0 && entries.Any(p => p.Names.Contains(normalized, StringComparer.Ordinal));
    }

    public Place[] Search(string query, Point? bias)
    {
        var normalized = Normalize(query);
        if (normalized.Length == 0) return [];
        var tokens = normalized.Split(' ');
        return entries.Select(p => new
        {
            Entry = p,
            Rank = p.Names.Contains(normalized, StringComparer.Ordinal) ? 0 :
                p.Names.Any(n => n.StartsWith(normalized, StringComparison.Ordinal)) ? 1 :
                p.SearchWords.Any(words => tokens.All(t => words.Any(w => w.StartsWith(t, StringComparison.Ordinal)))) ? 2 : 3
        }).Where(p => p.Rank < 3).OrderBy(p => p.Rank)
            .ThenBy(p => bias is null ? 0 : bias.Distance(p.Entry.Place.Point))
            .ThenBy(p => p.Entry.Id, StringComparer.Ordinal).Take(6).Select(p => p.Entry.Place).ToArray();
    }

    public Place[] Merge(Place[] local, Place[] remote)
    {
        var result = local.ToList();
        foreach (var place in remote)
        {
            var remoteName = Normalize(place.Label.Split(',')[0]);
            var duplicate = result.Any(p => Normalize(p.Label) == Normalize(place.Label) && p.Point.Distance(place.Point) <= 30 ||
                p.Point.Distance(place.Point) <= 30 && (Normalize(p.Label.Split(',')[0]) == remoteName ||
                    entries.Any(e => e.Place == p && e.Names.Contains(remoteName, StringComparer.Ordinal))));
            if (!duplicate) result.Add(place);
        }
        return result.Take(6).ToArray();
    }
}
