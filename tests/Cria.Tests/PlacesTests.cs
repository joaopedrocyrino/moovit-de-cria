using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Cria.Domain;
using Cria.Infrastructure;
namespace Cria.Tests;

public class PlacesTests
{
    // Actual Photon response shape for the requested example; tests do not use network.
    private const string Cafe = """
        {"features":[{"properties":{"name":"Chora Café","street":"Rua Oliveira Fausto","housenumber":"28","district":"Botafogo","city":"Rio de Janeiro","countrycode":"BR"},"geometry":{"type":"Point","coordinates":[-43.1837086,-22.9566277]}}]}
        """;

    [Fact]
    public void CafeNameIncludesTheStreetNumberAndNeighborhood()
    {
        using var json = JsonDocument.Parse(Cafe);
        var place = Assert.Single(PhotonPlaces.Parse(json.RootElement));
        Assert.Equal("Chora Café, Rua Oliveira Fausto, 28, Botafogo, Rio de Janeiro", place.Label);
        Assert.Equal(new Point(-22.9566277, -43.1837086), place.Point);
    }

    [Fact]
    public void CoordinatesFromAnotherCityOrCountryAreExcluded()
    {
        foreach (var response in new[] { Cafe.Replace("-43.1837086,-22.9566277", "-46.63,-23.55"), Cafe.Replace("\"city\":\"Rio de Janeiro\"", "\"city\":\"Niterói\""), Cafe.Replace("\"countrycode\":\"BR\"", "\"countrycode\":\"DE\"") })
        {
            using var json = JsonDocument.Parse(response);
            Assert.Empty(PhotonPlaces.Parse(json.RootElement));
        }
    }

    [Fact]
    public void MalformedCoordinatesAndMissingNamesAreSkipped()
    {
        using var json = JsonDocument.Parse("""
            {"features":[null,{"properties":{},"geometry":{"type":"Point","coordinates":[-43.2,-22.9]}},{"properties":{"name":"Bad"},"geometry":{"type":"Point","coordinates":["oops",-22.9]}}]}
            """);
        Assert.Empty(PhotonPlaces.Parse(json.RootElement));
    }

    [Fact]
    public async Task AutocompleteUsesPhotonWithBiasAndReusesTheCachedResponse()
    {
        var handler = new FakeHandler(Cafe);
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Geocoding:AutocompleteUrl"] = "https://search.example.test" }).Build();
        var places = new Places(new FakeFactory(handler), cache, config);
        var result = await places.Search(" Chora cafe ", new(-22.95, -43.19), CancellationToken.None);
        Assert.Single(result);
        Assert.Single(await places.Search("Chora cafe", new(-22.95, -43.19), CancellationToken.None));
        Assert.Equal(1, handler.Calls);
        Assert.Equal("search.example.test", handler.Url!.Host);
        Assert.Equal("/api/", handler.Url.AbsolutePath);
        Assert.Contains("q=chora%20cafe", handler.Url.Query);
        Assert.Contains("lat=-22.950", handler.Url.Query);
        Assert.Contains("countrycode=BR", handler.Url.Query);
    }

    [Fact]
    public async Task InvalidInputNeverReachesAProvider()
    {
        var handler = new FakeHandler(Cafe);
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var places = new Places(new FakeFactory(handler), cache, new ConfigurationBuilder().Build());
        Assert.Equal(400, (await Assert.ThrowsAsync<AppError>(() => places.Search("ab", null, CancellationToken.None))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<AppError>(() => places.Search("Chora", new(0, 0), CancellationToken.None))).Status);
        Assert.Equal(0, handler.Calls);
    }

    private sealed class FakeFactory(FakeHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }
    private sealed class FakeHandler(string body) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        public Uri? Url { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            Url = request.RequestUri;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body) });
        }
    }
}
