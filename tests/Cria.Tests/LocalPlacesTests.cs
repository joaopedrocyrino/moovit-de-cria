using System.Text.Json;
using Cria.Application;
using Cria.Domain;
using Cria.Infrastructure;

namespace Cria.Tests;

public class LocalPlacesTests
{
    private static CatalogPlace Venue(string id, string name, string[] aliases, double lon = -43.18, bool enabled = true) =>
        new(id, name, aliases, "Rua Teste, 10", "Botafogo", -22.95, lon, enabled, "Test coordinates");
    private static LocalPlaces Catalog(params CatalogPlace[] places) => LocalPlaces.FromJson(JsonSerializer.Serialize(places));

    [Theory]
    [InlineData("RFT")]
    [InlineData("r.f.t.")]
    [InlineData("RENOVACAO fight")]
    [InlineData("rft botafogo")]
    [InlineData("fight renovacao")]
    public void AliasesIgnoreAccentsCasePunctuationAndWordOrder(string query)
    {
        var result = Assert.Single(Catalog(Venue("rft", "Renovação Fight Team", ["RFT", "R.F.T."])).Search(query, null));
        Assert.StartsWith("Renovação Fight Team", result.Label);
        Assert.Equal("catalog", result.Source);
    }

    [Fact]
    public void ExactAliasRanksAheadOfPrefixesAndSharedAliasesRespectLocationBias()
    {
        var catalog = Catalog(Venue("near", "Casa do Amor Norte", ["Casa do Amor"], -43.18),
            Venue("far", "Casa do Amor Sul", ["Casa do Amor"], -43.48),
            Venue("prefix", "Casa do Amorim", [], -43.48));
        var result = catalog.Search("casa do amor", new(-22.95, -43.48));
        Assert.StartsWith("Casa do Amor Sul", result[0].Label);
        Assert.StartsWith("Casa do Amor Norte", result[1].Label);
        Assert.StartsWith("Casa do Amorim", result[2].Label);
    }

    [Fact]
    public void DisabledDraftsAreExcludedAndInvalidCoordinatesAreRejected()
    {
        var draft = Venue("draft", "Lugar pendente", []) with { Enabled = false, Lat = null, Lon = null, Source = null };
        Assert.Empty(Catalog(draft).Search("lugar", null));
        Assert.Throws<FormatException>(() => Catalog(draft with { Enabled = true }));
        Assert.Throws<FormatException>(() => Catalog(Venue("outside", "Outro lugar", []) with { Lat = 0 }));
    }

    [Fact]
    public void DuplicateIdsMissingSourcesAndUnknownFieldsAreRejected()
    {
        var place = Venue("duplicate", "Lugar", []);
        Assert.Throws<FormatException>(() => Catalog(place, place));
        Assert.Throws<FormatException>(() => Catalog(place with { Source = null }));
        Assert.Throws<JsonException>(() => LocalPlaces.FromJson("[{\"latitdue\":-22.95}]"));
    }

    [Fact]
    public void PunctuationOnlyQueriesDoNotMatchEveryPlace()
    {
        Assert.Empty(Catalog(Venue("rft", "RFT", [])).Search("...", null));
    }

    [Fact]
    public void MergeRemovesTheSameVenueUnderItsAliasButKeepsNearbyDifferentBusinesses()
    {
        var catalog = Catalog(Venue("rft", "Renovação Fight Team", ["RFT"]));
        var local = catalog.Search("rft", null);
        var remote = new[] { new Place("RFT, Botafogo", new(-22.95001, -43.18)),
            new Place("Outra academia, Botafogo", new(-22.95, -43.18)),
            new Place("RFT, Outra unidade", new(-22.96, -43.18)) };
        var result = catalog.Merge(local, remote);
        Assert.Equal(3, result.Length);
        Assert.Equal("catalog", result[0].Source);
        Assert.Contains(result, p => p.Label.StartsWith("Outra academia"));
        Assert.Contains(result, p => p.Label.Contains("Outra unidade"));
    }

    [Fact]
    public void SearchAndMergedResultsAreLimitedToSix()
    {
        var catalog = Catalog(Enumerable.Range(0, 12).Select(i => Venue($"place-{i}", $"Lugar {i}", [])).ToArray());
        Assert.Equal(6, catalog.Search("lugar", null).Length);
        Assert.Equal(6, catalog.Merge([], Enumerable.Range(0, 12).Select(i => new Place($"Lugar {i}", new(-22.95, -43.18))).ToArray()).Length);
    }

    [Theory]
    [InlineData("casa do amor", -22.970418642926163, -43.47979683121289)]
    [InlineData("rft", -22.953766213550384, -43.18393118957157)]
    [InlineData("canastra rose", -22.9563325, -43.1817643)]
    public void BundledCatalogPreservesTheConfiguredPins(string query, double lat, double lon)
    {
        var catalog = LocalPlaces.LoadBundled();
        Assert.True(catalog.HasExactName(query));
        Assert.Equal(new Point(lat, lon), Assert.Single(catalog.Search(query, null)).Point);
    }
}
