namespace Cria.Domain;

public sealed record Point(double Lat, double Lon)
{
    public bool InRioBounds => double.IsFinite(Lat) && double.IsFinite(Lon) && Lat is >= -23.12 and <= -22.72 && Lon is >= -43.85 and <= -43.08;
    public double Distance(Point other)
    {
        const double r = Math.PI / 180;
        var a = Math.Pow(Math.Sin((other.Lat - Lat) * r / 2), 2) + Math.Cos(Lat * r) * Math.Cos(other.Lat * r) * Math.Pow(Math.Sin((other.Lon - Lon) * r / 2), 2);
        return 6371000 * 2 * Math.Asin(Math.Min(1, Math.Sqrt(a)));
    }
}
public sealed record Stop(string Id, string Name, Point Point);
public sealed record PatternStop(string StopId, int Arrival, int Departure, bool Pickup, bool Dropoff);
public sealed record Window(string ServiceId, int Start, int End, int Headway, bool Exact);
public sealed record Pattern(string Id, string RouteId, string Line, string Name, string Mode, int Direction, string Headsign, string ShapeId, string Color, long? FareCents, bool Municipal, PatternStop[] Stops, Window[] Windows);
public sealed record Service(string Id, string Start, string End, int[] Days, Dictionary<string, int> Exceptions)
{
    public bool Runs(DateOnly date)
    {
        var key = date.ToString("yyyyMMdd");
        if (Exceptions.TryGetValue(key, out var value))
            return value == 1;
        return string.CompareOrdinal(key, Start) >= 0 && string.CompareOrdinal(key, End) <= 0 && Days[((int)date.DayOfWeek + 6) % 7] == 1;
    }
}
public sealed record Network(Dictionary<string, Stop> Stops, Pattern[] Patterns, Dictionary<string, Service> Services, string ImportedAt, string Source, string? ValidUntil);
public sealed record Leg(string Kind, string? RouteId, string? Line, string? Mode, string? Headsign, int? Direction, string? ShapeId, DateTimeOffset Start, DateTimeOffset End, Stop From, Stop To, Stop[] Stops, long? FareCents, bool Municipal, bool Estimated);
public sealed record Fare(long? Cents, string Label, string[] Notes);
public sealed record Itinerary(string Id, int DurationMinutes, int Transfers, int WalkMinutes, DateTimeOffset Departure, DateTimeOffset Arrival, Fare Fare, Leg[] Legs);
public sealed record PlanRequest(Point From, Point To, DateTimeOffset? Departure, string Payment = "individual", int MaxTransfers = 2, DateTimeOffset? ArriveBy = null);
public sealed record PlanResponse(Itinerary[] Itineraries, string[] Notices, string Source, string ImportedAt);
public sealed record Vehicle(string Id, string Line, string? RouteId, int? Direction, Point Point, DateTimeOffset ObservedAt, double? Speed, double? Bearing, string Source, string? ShapeId = null);
public sealed record VehicleResult(Vehicle[] Vehicles, string Status, DateTimeOffset CheckedAt, string? Message, int LineCount = 0, int UnknownDirectionCount = 0);
public sealed class AppError(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}
