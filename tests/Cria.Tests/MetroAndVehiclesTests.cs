using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Cria.Application;
using Cria.Domain;
using Cria.Infrastructure;
namespace Cria.Tests;

public class MetroAndVehiclesTests
{
    private static Network Empty() => new([], [], [], "test", "fixture", null);
    private sealed class Store(Network network) : ITransitStore
    {
        public Network Get() => network;
        public Point[] Shape(string id) => [];
    }
    [Fact]
    public void MetroAddsBothDirectionsAndPhysicalTransferStationsOnce()
    {
        var n = MetroNetwork.AddTo(Empty());
        Assert.Equal(41, n.Stops.Count);
        Assert.Equal(4, n.Patterns.Length);
        Assert.All(n.Patterns, p => { Assert.Equal("metro", p.Mode); Assert.Equal(790, p.FareCents); Assert.False(p.Municipal); });
        Assert.Same(n, MetroNetwork.AddTo(n));
        Assert.All(n.Stops.Values, s => Assert.True(s.Point.InRioBounds));
        Assert.Contains(n.Patterns.Single(p => p.Line == "2" && p.Direction == 0).Stops, s => s.StopId == "metro:w1w15");
    }
    [Fact]
    public void MetroPlansJardimOceanicoToBotafogoWithoutABus()
    {
        var n = MetroNetwork.AddTo(Empty());
        var tomorrow = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow.AddDays(1), Schedules.Rio).Date.AddHours(8);
        var result = new Planner(new Store(n)).Plan(new(n.Stops["metro:w6w5"].Point, n.Stops["metro:w1w15"].Point, new(tomorrow, TimeSpan.FromHours(-3))), TestContext.Current.CancellationToken);
        var ride = Assert.Single(result.Itineraries[0].Legs, l => l.Kind == "transit");
        Assert.Equal("metro", ride.Mode);
        Assert.Equal("1/4", ride.Line);
        Assert.Equal(790, result.Itineraries[0].Fare.Cents);
        Assert.InRange(result.Itineraries[0].DurationMinutes, 20, 45);
    }
    [Fact]
    public void SundayAndHolidayOpeningUsesLocalStationHours()
    {
        var n = MetroNetwork.AddTo(Empty());
        var p = n.Patterns.Single(p => p.Line == "1/4" && p.Direction == 0);
        var sunday = DateTimeOffset.Parse("2026-10-11T06:50:00-03:00");
        // Interior stations must not shift gate hours by the trip's accumulated run time.
        Assert.Equal(DateTimeOffset.Parse("2026-10-11T07:04:00-03:00"), Schedules.Departure(p, 15, sunday, n));
        var holiday = DateTimeOffset.Parse("2026-10-12T06:50:00-03:00");
        Assert.Equal(DateTimeOffset.Parse("2026-10-12T07:04:00-03:00"), Schedules.Departure(p, 15, holiday, n));
        Assert.Null(Schedules.Departure(p, 15, DateTimeOffset.Parse("2026-10-11T23:01:00-03:00"), n));
    }
    private static Leg Ride(string mode, string from, string to, DateTimeOffset at) => new("transit", mode, "2", mode, "Destino", 0, mode, at, at.AddMinutes(15), new(from, from, new(-22.92, -43.2)), new(to, to, new(-22.93, -43.21)), [], mode == "metro" ? 790 : 500, mode != "metro", true);
    [Fact]
    public void InternalMetroTransferChargesOnceButStreetReentryChargesAgain()
    {
        var at = DateTimeOffset.UtcNow;
        var first = Ride("metro", "pavuna", "central", at);
        Assert.Equal(790, Fares.Quote([first, Ride("metro", "central", "botafogo", at.AddMinutes(20))], "individual").Cents);
        Assert.Equal(1580, Fares.Quote([first, Ride("metro", "uruguaiana", "botafogo", at.AddMinutes(20))], "individual").Cents);
        Assert.Equal(1290, Fares.Quote([Ride("brt", "a", "jardim", at), Ride("metro", "jardim", "botafogo", at.AddMinutes(20))], "jae").Cents);
        Assert.Equal(1290, Fares.Quote([Ride("bus", "a", "b", at), Ride("brt", "b", "jardim", at.AddMinutes(20)), Ride("metro", "jardim", "botafogo", at.AddMinutes(40))], "jae").Cents);
    }
    [Fact]
    public void PlannerIncludesBusToMetroConnection()
    {
        var n = MetroNetwork.AddTo(Empty());
        var origin = new Stop("bus-origin", "Recreio", new(-23.03, -43.4));
        var transfer = new Stop("bus-jardim", "Terminal Jardim Oceânico", n.Stops["metro:w6w5"].Point with { Lat = -23.0065 });
        n.Stops[origin.Id] = origin; n.Stops[transfer.Id] = transfer;
        n.Services["bus"] = new("bus", "20250101", "20361231", [1,1,1,1,1,1,1], []);
        n = n with { Patterns = [.. n.Patterns, new("bus", "bus", "22", "BRT", "brt", 0, "Jardim Oceânico", "bus", "000000", 500, true, [new(origin.Id, 0, 0, true, true), new(transfer.Id, 1200, 1200, true, true)], [new("bus", 0, 86400, 600, false)])] };
        var tomorrow = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow.AddDays(1), Schedules.Rio).Date.AddHours(8);
        var result = new Planner(new Store(n)).Plan(new(origin.Point, n.Stops["metro:w1w15"].Point, new(tomorrow, TimeSpan.FromHours(-3))), TestContext.Current.CancellationToken);
        Assert.Contains(result.Itineraries, i => i.Legs.Any(l => l.Mode == "brt") && i.Legs.Any(l => l.Mode == "metro") && i.Fare.Cents == 1290);
    }
    private sealed class Handler : HttpMessageHandler, IHttpClientFactory
    {
        public int Calls;
        public HttpClient CreateClient(string name) => new(this, false);
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Interlocked.Increment(ref Calls);
            var at = DateTimeOffset.UtcNow.ToString("O");
            object Row(string id, string route, int? direction, string? shape = null) => new { id_veiculo = id, servico = "361", route_id = route, direction_id = direction, shape_id = shape, latitude = -22.93, longitude = -43.2, datetime = at };
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(new { data = new[] { Row("A", "r", 0), Row("B", "r", 1), Row("C", "variant", 0), Row("D", "r", null, "shape-1"), Row("E", "r", null) } })) });
        }
    }
    private static Network BusNetwork()
    {
        var pattern = new Pattern("r", "r", "361", "361", "bus", 1, "Recreio", "shape-1", "000000", 500, true, [], []);
        return Empty() with { Patterns = [pattern] };
    }
    [Fact]
    public async Task AlternativesShareOneLineSnapshotWhileKeepingDirectionAndVariantFilters()
    {
        var handler = new Handler();
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var feed = new VehicleFeed(handler, cache, new ConfigurationBuilder().Build(), new Store(BusNetwork()));
        var results = await Task.WhenAll(feed.Get("r", "361", 0, CancellationToken.None), feed.Get("r", "361", 1, CancellationToken.None), feed.Get("variant", "361", 0, CancellationToken.None));
        Assert.Equal(1, handler.Calls);
        Assert.All(results, r => { Assert.Equal(5, r.LineCount); Assert.Equal(1, r.UnknownDirectionCount); Assert.Equal(results[0].CheckedAt, r.CheckedAt); });
        Assert.Equal(["A"], results[0].Vehicles.Select(v => v.Id));
        Assert.Equal(["B", "D"], results[1].Vehicles.Select(v => v.Id));
        Assert.Equal(["C"], results[2].Vehicles.Select(v => v.Id));
        Assert.Equal(results[0].Vehicles, (await feed.Get("r", "361", 0, CancellationToken.None)).Vehicles);
        Assert.Equal(1, handler.Calls);
        var fleet = await feed.Get("", "361", null, CancellationToken.None);
        Assert.Equal(5, fleet.Vehicles.Length);
        Assert.Equal(results[0].CheckedAt, fleet.CheckedAt);
        Assert.Equal(1, handler.Calls);
    }
    [Fact]
    public async Task MetroNeverQueriesTheBusGpsProvider()
    {
        var handler = new Handler();
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var feed = new VehicleFeed(handler, cache, new ConfigurationBuilder().Build(), new Store(Empty()));
        Assert.Empty((await feed.Get("metro:1/4", "1/4", 0, CancellationToken.None)).Vehicles);
        Assert.Equal(0, handler.Calls);
    }
}
