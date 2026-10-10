using Cria.Application;
using Cria.Domain;
using Cria.Infrastructure;
namespace Cria.Tests;

public class TimingTests
{
    private sealed class Store(Network network) : ITransitStore
    {
        public Network Get() => network;
        public Point[] Shape(string id) => [];
    }
    private static DateTimeOffset Morning => new(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow.AddDays(1), Schedules.Rio).Date.AddHours(8), TimeSpan.FromHours(-3));
    private static Network Fixture(bool frequency = false)
    {
        var stops = new Dictionary<string, Stop> { ["a"] = new("a", "A", new(-22.92, -43.21)), ["b"] = new("b", "B", new(-22.92, -43.24)), ["c"] = new("c", "C", new(-22.92, -43.28)) };
        Pattern Make(string id, string from, string to, int departure) => new(id, id, id, id, "bus", 0, "Destino", id, "000000", 500, true, [new(from, 0, 0, true, true), new(to, 600, 600, true, true)], frequency ? [new("s", 0, 86400, 600, false)] : [new("s", departure, departure + 1, 0, true)]);
        return new(stops, [Make("one", "a", "b", 8 * 3600), Make("two", "b", "c", 8 * 3600 + 900)], new() { ["s"] = new("s", "20250101", "20361231", [1,1,1,1,1,1,1], []) }, "test", "fixture", null);
    }
    [Fact]
    public void LatestExactDepartureRoundsDownAndKeepsEndExclusive()
    {
        Assert.Equal(900, Schedules.Previous(new("s", 600, 1800, 300, true), 1110, 0));
        Assert.Equal(1500, Schedules.Previous(new("s", 600, 1800, 300, true), 1800, 0));
        Assert.Equal(1450, Schedules.Previous(new("s", 600, 1800, 300, true), 1733, 250));
        Assert.Null(Schedules.Previous(new("s", 600, 1800, 300, true), 500, 0));
    }
    [Fact]
    public void ArriveByIncludesWalkingAndFindsLatestValidConnection()
    {
        var n = Fixture(); var deadline = Morning.AddMinutes(30);
        var result = new Planner(new Store(n)).Plan(new(n.Stops["a"].Point, n.Stops["c"].Point, null, ArriveBy: deadline), TestContext.Current.CancellationToken);
        var trip = result.Itineraries[0];
        Assert.Equal(Morning.AddSeconds(-20), trip.Departure);
        Assert.Equal(Morning.AddMinutes(25).AddSeconds(20), trip.Arrival);
        Assert.True(trip.Arrival <= deadline);
        Assert.Equal(1, trip.Transfers);
        Assert.Equal(1000, trip.Fare.Cents);
        for (var i = 1; i < trip.Legs.Length; i++) Assert.True(trip.Legs[i - 1].End <= trip.Legs[i].Start);
    }
    [Fact]
    public void EstimatedWaitingIsIncludedBeforeBoarding()
    {
        var n = Fixture(frequency: true);
        var trip = new Planner(new Store(n)).Plan(new(n.Stops["a"].Point, n.Stops["b"].Point, null, ArriveBy: Morning.AddMinutes(30)), TestContext.Current.CancellationToken).Itineraries[0];
        Assert.Equal(TimeSpan.FromMinutes(5), trip.Legs[1].Start - trip.Legs[0].End);
        Assert.True(trip.Arrival <= Morning.AddMinutes(30));
    }
    [Fact]
    public void ArriveByHonorsTransferLimitsAndInactiveServices()
    {
        var n = Fixture(); var planner = new Planner(new Store(n));
        Assert.Empty(planner.Plan(new(n.Stops["a"].Point, n.Stops["c"].Point, null, MaxTransfers: 0, ArriveBy: Morning.AddMinutes(30)), TestContext.Current.CancellationToken).Itineraries);
        n.Services["s"].Exceptions[Morning.ToString("yyyyMMdd")] = 2;
        Assert.Empty(planner.Plan(new(n.Stops["a"].Point, n.Stops["c"].Point, null, ArriveBy: Morning.AddMinutes(30)), TestContext.Current.CancellationToken).Itineraries);
    }
    [Fact]
    public void ScheduledDepartureHonorsTheRequestedStartTime()
    {
        var n = Fixture(); var start = Morning.AddMinutes(-1);
        var trip = new Planner(new Store(n)).Plan(new(n.Stops["a"].Point, n.Stops["b"].Point, start), TestContext.Current.CancellationToken).Itineraries[0];
        Assert.Equal(start, trip.Departure);
        Assert.Equal(Morning, trip.Legs[1].Start);
    }
    [Fact]
    public void ContradictoryPastOrDistantTimesAreRejected()
    {
        var n = Fixture(); var planner = new Planner(new Store(n));
        foreach (var request in new[] { new PlanRequest(n.Stops["a"].Point, n.Stops["b"].Point, Morning, ArriveBy: Morning), new(n.Stops["a"].Point, n.Stops["b"].Point, null, ArriveBy: DateTimeOffset.UtcNow.AddHours(-1)), new(n.Stops["a"].Point, n.Stops["b"].Point, null, ArriveBy: DateTimeOffset.UtcNow.AddDays(8)) })
            Assert.Equal(400, Assert.Throws<AppError>(() => planner.Plan(request, TestContext.Current.CancellationToken)).Status);
    }
    [Fact]
    public void BackwardSchedulesHandleAfterMidnightService()
    {
        var n = Fixture(); var tomorrow = Morning.Date;
        var latest = new DateTimeOffset(tomorrow.AddMinutes(15), TimeSpan.FromHours(-3));
        var pattern = n.Patterns[0] with { Windows = [new("s", 24 * 3600 + 600, 24 * 3600 + 601, 0, true)] };
        Assert.Equal(latest.AddMinutes(-5), Schedules.LatestDeparture(pattern, 0, latest, n)!.Value.Departure);
    }
}
