using System.Text.Json;
using Cria.Domain;
using Cria.Application;
using Cria.Infrastructure;
namespace Cria.Tests;

public class TransitTests
{
    [Fact]
    public void DistanceIsMeters()
    {
        var a = new Point(-22.9, -43.2);
        Assert.Equal(0, a.Distance(a));
        Assert.InRange(a.Distance(new(-22.901, -43.2)), 110, 113);
    }
    [Fact]
    public void ExactFrequencyWaitsForNextDeparture()
    {
        Assert.Equal(1200, Schedules.Next(new("svc", 600, 1800, 300, true), 1110, 0));
    }
    [Fact]
    public void FrequencyEstimateUsesHalfHeadway()
    {
        Assert.Equal(1160, Schedules.Next(new("svc", 600, 1800, 300, false), 1010, 0));
    }
    [Fact]
    public void EndOfFrequencyWindowIsExclusive()
    {
        Assert.Null(Schedules.Next(new("svc", 600, 1800, 300, true), 1800, 0));
    }
    [Fact]
    public void StopOffsetIsAddedToDeparture()
    {
        Assert.Equal(1450, Schedules.Next(new("svc", 600, 1800, 300, true), 1400, 250));
    }
    [Fact]
    public void ScheduledDepartureCannotBeMissed()
    {
        var w = new Window("svc", 600, 601, 0, true);
        Assert.Equal(700, Schedules.Next(w, 700, 100));
        Assert.Null(Schedules.Next(w, 701, 100));
    }
    [Fact]
    public void ExceptionOverridesWeekday()
    {
        var s = new Service("s", "20200101", "20300101", [1, 1, 1, 1, 1, 1, 1], new()
        {
            ["20261012"] = 2
        });
        Assert.False(s.Runs(new(2026, 10, 12)));
        Assert.True(s.Runs(new(2026, 10, 13)));
    }
    [Fact]
    public void CalendarDateCanAddOtherwiseInactiveService()
    {
        var s = new Service("s", "00000000", "00000000", [0, 0, 0, 0, 0, 0, 0], new()
        {
            ["20261012"] = 1
        });
        Assert.True(s.Runs(new(2026, 10, 12)));
    }
    private static Leg Ride(string mode, long? fare, DateTimeOffset at, bool municipal = true) => new("transit", "r", "22", mode, "Alvorada", 0, "shape", at, at.AddMinutes(15), new("a", "A", new(-22.92, -43.21)), new("b", "B", new(-22.93, -43.22)), [], fare, municipal, true);
    [Fact]
    public void IndividualFaresAreIntegerCents()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.Equal(1000, Fares.Quote([Ride("bus", 500, now), Ride("brt", 500, now.AddMinutes(30))], "individual").Cents);
    }
    [Fact]
    public void BUCIsAnExplicitEstimate()
    {
        var now = DateTimeOffset.UtcNow;
        var quote = Fares.Quote([Ride("bus", 500, now), Ride("brt", 500, now.AddMinutes(30))], "jae");
        Assert.Equal(500, quote.Cents);
        Assert.Contains(quote.Notes, n => n.Contains("elegibilidade"));
    }
    [Fact]
    public void BUCDoesNotApplyWithoutBRT()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.Equal(1000, Fares.Quote([Ride("bus", 500, now), Ride("bus", 500, now.AddMinutes(30))], "jae").Cents);
    }
    [Fact]
    public void BUCDoesNotApplyAfterThreeHours()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.Equal(1000, Fares.Quote([Ride("bus", 500, now), Ride("brt", 500, now.AddHours(4))], "jae").Cents);
    }
    [Fact]
    public void SpecialFareIsNotDiscounted()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.Equal(2000, Fares.Quote([Ride("bus", 1500, now, false), Ride("brt", 500, now.AddMinutes(30))], "jae").Cents);
    }
    [Fact]
    public void UnknownFareIsNotReportedAsZero()
    {
        Assert.Null(Fares.Quote([Ride("bus", null, DateTimeOffset.UtcNow)], "individual").Cents);
    }
    [Fact]
    public void LiveParserKeepsNewestAndRejectsOldInvalidPositions()
    {
        var now = DateTimeOffset.Parse("2026-10-07T15:00:00Z");
        using var doc = JsonDocument.Parse("""{"data":[{"id_veiculo":"A","servico":"22","route_id":"r","direction_id":0,"latitude":-22.92,"longitude":-43.2,"datetime":"2026-10-07T14:59:00Z"},{"id_veiculo":"A","servico":"22","route_id":"r","direction_id":0,"latitude":-22.93,"longitude":-43.2,"datetime":"2026-10-07T15:00:00Z"},{"id_veiculo":"B","servico":"22","latitude":-22.9,"longitude":-43.2,"datetime":"2026-10-07T14:00:00Z"},{"id_veiculo":"C","servico":"22","latitude":0,"longitude":0,"datetime":"2026-10-07T15:00:00Z"}]}""");
        var result = VehicleParser.Parse(doc.RootElement, now, "test");
        Assert.Single(result);
        Assert.Equal(-22.93, result[0].Point.Lat);
        Assert.Equal(0, result[0].Direction);
    }
    private sealed class Store(Network n) : ITransitStore
    {
        public Network Get() => n; public Point[] Shape(string id) => [];
    }
    private static Network Fixture()
    {
        var stops = new Dictionary<string, Stop> { ["a"] = new("a", "A", new(-22.92, -43.21)), ["b"] = new("b", "B", new(-22.92, -43.24)), ["c"] = new("c", "C", new(-22.92, -43.28)) };
        var svc = new Service("s", "20200101", "20300101", [1, 1, 1, 1, 1, 1, 1], []);
        Pattern Make(string id, string a, string b) => new(id, id, id, id, "bus", 0, "Centro", id, "145A49", 500, true, [new(a, 0, 0, true, true), new(b, 900, 900, true, true)], [new("s", 0, 172000, 600, true)]);
        return new(stops, [Make("one", "a", "b"), Make("two", "b", "c")], new()
        {
            ["s"] = svc
        }, "2026-10-07", "fixture", null);
    }
    [Fact]
    public void RoutingFindsTwoRideConnection()
    {
        var n = Fixture();
        var result = new Planner(new Store(n)).Plan(new(n.Stops["a"].Point, n.Stops["c"].Point, DateTimeOffset.UtcNow.AddHours(1)), TestContext.Current.CancellationToken);
        Assert.NotEmpty(result.Itineraries);
        Assert.Equal(1, result.Itineraries[0].Transfers);
        Assert.Equal(1000, result.Itineraries[0].Fare.Cents);
    }
    [Fact]
    public void TransferLimitIsRespected()
    {
        var n = Fixture();
        Assert.Empty(new Planner(new Store(n)).Plan(new(n.Stops["a"].Point, n.Stops["c"].Point, DateTimeOffset.UtcNow.AddHours(1), "individual", 0), TestContext.Current.CancellationToken).Itineraries);
    }
    [Fact]
    public void OriginOutsideRioIsRejected()
    {
        Assert.Throws<AppError>(() => new Planner(new Store(Fixture())).Plan(new(new(0, 0), new(-22.92, -43.21), null), TestContext.Current.CancellationToken));
    }
    [Fact]
    public void OvernightTripUsesPreviousServiceDay()
    {
        var n = Fixture();
        var tomorrow = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow.AddDays(1), Schedules.Rio).Date;
        var ready = new DateTimeOffset(tomorrow.AddMinutes(5), TimeSpan.FromHours(-3));
        var p = n.Patterns[0] with
        {
            Windows = [new("s", 24 * 3600 + 600, 24 * 3600 + 601, 0, true)]
        };
        Assert.Equal(ready.AddMinutes(5), Schedules.Departure(p, 0, ready, n));
    }
}
