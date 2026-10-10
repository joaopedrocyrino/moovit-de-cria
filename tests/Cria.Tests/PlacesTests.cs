using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Cria.Domain;
using Cria.Infrastructure;
namespace Cria.Tests;

public class PlacesTests
{
    [Fact]
    public void MalformedCoordinatesAndMissingNamesAreSkipped()
    {
        using var json = JsonDocument.Parse("""
            {"features":[null,{"properties":{},"geometry":{"type":"Point","coordinates":[-43.2,-22.9]}},{"properties":{"name":"Bad"},"geometry":{"type":"Point","coordinates":["oops",-22.9]}}]}
            """);
        Assert.Empty(PhotonPlaces.Parse(json.RootElement));
    }

    [Fact]
    public async Task InvalidInputNeverReachesAProvider()
    {
        var handler = new FakeHandler("");
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var places = new Places(new FakeFactory(handler), cache, new ConfigurationBuilder().Build(), LocalPlaces.FromJson("[]"));
        Assert.Equal(400, (await Assert.ThrowsAsync<AppError>(() => places.Search("ab", null, CancellationToken.None))).Status);
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task ExactCuratedAliasesAvoidExternalRequests()
    {
        var handler = new FakeHandler("", HttpStatusCode.ServiceUnavailable);
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var places = new Places(new FakeFactory(handler), cache, new ConfigurationBuilder().Build(), LocalPlaces.LoadBundled());
        foreach (var query in new[] { "casa do amor", "RFT", "canastra rose" })
            Assert.Equal("catalog", Assert.Single(await places.Search(query, null, CancellationToken.None)).Source);
        Assert.Equal(0, handler.Calls);
    }

    [Theory]
    [InlineData("{}", HttpStatusCode.OK)]
    [InlineData("not json", HttpStatusCode.OK)]
    [InlineData("", HttpStatusCode.ServiceUnavailable)]
    public async Task CuratedSuggestionsSurviveExternalOutagesAndMalformedResponses(string body, HttpStatusCode status)
    {
        var handler = new FakeHandler(body, status);
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var places = new Places(new FakeFactory(handler), cache, new ConfigurationBuilder().Build(), LocalPlaces.LoadBundled());
        Assert.Equal("catalog", Assert.Single(await places.Search("renovacao", null, CancellationToken.None)).Source);
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task UnknownPlacesStillReportProviderFailureAndCancellationIsNeverHidden()
    {
        var handler = new FakeHandler("", HttpStatusCode.ServiceUnavailable);
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var places = new Places(new FakeFactory(handler), cache, new ConfigurationBuilder().Build(), LocalPlaces.LoadBundled());
        Assert.Equal(503, (await Assert.ThrowsAsync<AppError>(() => places.Search("unknown venue", null, CancellationToken.None))).Status);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => places.Search("rft", null, new CancellationToken(true)));
    }

    private sealed class FakeFactory(FakeHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }
    private sealed class FakeHandler(string body, HttpStatusCode status = HttpStatusCode.OK) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        public Uri? Url { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            Url = request.RequestUri;
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body) });
        }
    }
}
