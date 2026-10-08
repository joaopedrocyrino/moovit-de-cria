using System.Net;
using System.Text.Json;
using Cria.Application;
using Cria.Domain;
using Cria.Infrastructure;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
namespace Cria.Tests;

public class VehicleTrackingTests
{
    private static readonly DateTimeOffset At = DateTimeOffset.Parse("2026-10-08T15:00:10Z");
    private static Vehicle Bus(string id, DateTimeOffset? at = null, int? direction = 0, string? route = "r", string? shape = null) =>
        new(id, "553", route, direction, new(-22.93, -43.2), at ?? At, 10, null, "test", shape);
    [Fact]
    public void PartialAndEmptyUpdatesDoNotEraseRecentBuses()
    {
        var fleet = VehicleHistory.Merge([], [Bus("A"), Bus("B"), Bus("C")], At);
        fleet = VehicleHistory.Merge(fleet, [Bus("A", At.AddSeconds(21)) with { Point = new(-22.94, -43.2) }], At.AddSeconds(21));
        fleet = VehicleHistory.Merge(fleet, [], At.AddSeconds(42));
        Assert.Equal(3, fleet.Length);
        Assert.Equal(At.AddSeconds(21), fleet.Single(v => v.Id == "A").ObservedAt);
        Assert.Equal(-22.94, fleet.Single(v => v.Id == "A").Point.Lat);
        Assert.Equal(At, fleet.Single(v => v.Id == "B").ObservedAt);
    }
    [Fact]
    public void IncompleteProviderReportsPreserveOriginalConfirmedPositionAndTimestamp()
    {
        var confirmed = Bus("A", shape: "shape");
        var incomplete = Bus("A", At.AddSeconds(25), null, "", "") with { Point = new(-22.95, -43.21) };
        Assert.Equal(confirmed, Assert.Single(VehicleHistory.Merge([], [confirmed, incomplete], At.AddSeconds(25))));
        Assert.Equal(confirmed, Assert.Single(VehicleHistory.Merge([confirmed], [incomplete], At.AddSeconds(25))));
    }
    [Fact]
    public void NewerOppositeDirectionSupersedesOldBoardingEvidence()
    {
        var opposite = Bus("A", At.AddSeconds(21), 1);
        var fleet = VehicleHistory.Merge([Bus("A")], [opposite], At.AddSeconds(21));
        Assert.Equal(opposite, Assert.Single(fleet));
        // An old delayed row cannot restore the original direction.
        Assert.Equal(opposite, Assert.Single(VehicleHistory.Merge(fleet, [Bus("A")], At.AddSeconds(42))));
    }
    [Fact]
    public void ExplicitNewVariantOrDirectionWithoutRouteInvalidatesPriorAssignment()
    {
        foreach (var change in new[] { Bus("A", At.AddSeconds(21), null, "other"), Bus("A", At.AddSeconds(21), 1, ""), Bus("A", At.AddSeconds(21), null, "r", "other-shape") })
            Assert.Equal(change, Assert.Single(VehicleHistory.Merge([Bus("A", shape: "shape")], [change], At.AddSeconds(21))));
    }
    [Fact]
    public void EmptyRefreshDoesNotRenewOldPositionsAndFutureRowsAreRejected()
    {
        Assert.Single(VehicleHistory.Merge([Bus("A")], [], At.AddSeconds(180)));
        Assert.Empty(VehicleHistory.Merge([Bus("A")], [], At.AddSeconds(181)));
        Assert.Empty(VehicleHistory.Merge([], [Bus("future", At.AddSeconds(31))], At));
    }
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = At;
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private sealed class Store : ITransitStore
    {
        public Network Get() => new([], [new("p", "r", "553", "553", "bus", 0, "Rio Sul", "shape", "000000", 500, true, [], [])], [], "test", "test", null);
        public Point[] Shape(string id) => [];
    }
    private sealed class Handler(Func<HttpRequestMessage, int, HttpResponseMessage> response) : HttpMessageHandler, IHttpClientFactory
    {
        public int Calls;
        public HttpClient CreateClient(string name) => new(this, false);
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => Task.FromResult(response(request, Interlocked.Increment(ref Calls)));
    }
    private static object Row(string id, DateTimeOffset time, int? direction = 0, string? route = "r", string? shape = null) => new
    { id_veiculo = id, servico = "553", route_id = route, direction_id = direction, shape_id = shape, latitude = -22.93, longitude = -43.2, datetime = time.ToString("O") };
    private static HttpResponseMessage Response(object value) => new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(value)) };
    [Fact]
    public async Task FeedKeepsThreeBusesThroughOneAndZeroReportCycles()
    {
        var clock = new Clock();
        var handler = new Handler((_, call) => Response(new { data = call switch { 1 => new[] { Row("A", At), Row("B", At), Row("C", At) }, 2 => new[] { Row("A", clock.Now) }, _ => Array.Empty<object>() } }));
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var feed = new VehicleFeed(handler, cache, new ConfigurationBuilder().Build(), new Store(), clock);
        Assert.Equal(3, (await feed.Get("r", "553", 0, CancellationToken.None)).Vehicles.Length);
        clock.Now = At.AddSeconds(21);
        Assert.Equal(3, (await feed.Get("r", "553", 0, CancellationToken.None)).Vehicles.Length);
        clock.Now = At.AddSeconds(42);
        Assert.Equal(3, (await feed.Get("r", "553", 0, CancellationToken.None)).Vehicles.Length);
        Assert.Equal(3, handler.Calls);
        clock.Now = At.AddSeconds(181);
        Assert.Equal(["A"], (await feed.Get("r", "553", 0, CancellationToken.None)).Vehicles.Select(v => v.Id));
        clock.Now = At.AddSeconds(202);
        Assert.Empty((await feed.Get("r", "553", 0, CancellationToken.None)).Vehicles);
    }
    [Fact]
    public async Task FeedUsesMetadataBeforeDeduplicationAcrossProviders()
    {
        var clock = new Clock();
        var handler = new Handler((_, _) => Response(new { data = new[] { Row("A", At, null, "r", "shape"), Row("A", At.AddSeconds(10), null, "", "") } }));
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var feed = new VehicleFeed(handler, cache, new ConfigurationBuilder().Build(), new Store(), clock);
        var vehicle = Assert.Single((await feed.Get("r", "553", 0, CancellationToken.None)).Vehicles);
        Assert.Equal(At, vehicle.ObservedAt);
        Assert.Equal(0, vehicle.Direction);
    }
    [Fact]
    public async Task InitialEmptyMinuteLoadsPreviousThreeMinutesAndFollowsPagination()
    {
        var clock = new Clock();
        var previousMinute = At.AddMinutes(-1).ToString("yyyy-MM-ddTHH:mm:00Z");
        var calls = new List<string>();
        var handler = new Handler((request, _) =>
        {
            var query = Uri.UnescapeDataString(request.RequestUri!.Query);
            lock (calls) calls.Add(query);
            var previous = query.Contains(previousMinute);
            var secondPage = query.Contains("cursor=next");
            return Response(new { minuto_utc = "test", data = previous ? new[] { Row(secondPage ? "B" : "A", At.AddSeconds(-30)) } : Array.Empty<object>(), next_cursor = previous && !secondPage ? "next" : null });
        });
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var feed = new VehicleFeed(handler, cache, new ConfigurationBuilder().Build(), new Store(), clock);
        Assert.Equal(2, (await feed.Get("r", "553", 0, CancellationToken.None)).Vehicles.Length);
        Assert.Equal(5, handler.Calls);
        Assert.All(calls, query => Assert.Contains("minuto_utc=", query));
        await feed.Get("r", "553", 1, CancellationToken.None);
        Assert.Equal(5, handler.Calls);
    }
    [Fact]
    public async Task ProviderFailureKeepsFreshPositionsAndExpiresThemWithoutInventingUpdates()
    {
        var clock = new Clock();
        var handler = new Handler((_, call) => call == 1 ? Response(new { data = new[] { Row("A", At) } }) : new(HttpStatusCode.ServiceUnavailable));
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var feed = new VehicleFeed(handler, cache, new ConfigurationBuilder().Build(), new Store(), clock);
        await feed.Get("r", "553", 0, CancellationToken.None);
        clock.Now = At.AddSeconds(21);
        var result = await feed.Get("r", "553", 0, CancellationToken.None);
        Assert.Equal("unavailable", result.Status);
        Assert.Equal(At, Assert.Single(result.Vehicles).ObservedAt);
        clock.Now = At.AddSeconds(181);
        Assert.Empty((await feed.Get("r", "553", 0, CancellationToken.None)).Vehicles);
    }
}
