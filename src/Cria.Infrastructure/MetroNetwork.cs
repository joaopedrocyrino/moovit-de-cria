using System.Text.Json;
using Cria.Domain;
namespace Cria.Infrastructure;

// Station sequence and run times are a checked-in operator snapshot, not live schedules.
// An eight-minute headway is an explicit planning assumption, not a published timetable.
public static class MetroNetwork
{
    private sealed record Station(string Id, string Name, Point Point, int SecondsFromPrevious);
    private sealed record Line(string LineNumber, Station[] Stations);
    private sealed record Data(long FareCents, int EstimatedHeadwaySeconds, JsonElement[] Lines);
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    public static Network AddTo(Network network)
    {
        if (network.Patterns.Any(p => p.Mode == "metro")) return network;
        using var stream = typeof(MetroNetwork).Assembly.GetManifestResourceStream("Cria.Infrastructure.Data.metro.json")!;
        var data = JsonSerializer.Deserialize<Data>(stream, Json)!;
        var stops = new Dictionary<string, Stop>(network.Stops);
        var services = new Dictionary<string, Service>(network.Services);
        var patterns = network.Patterns.ToList();
        var holidays = Enumerable.Range(2025, 12).SelectMany(Holidays).Select(d => d.ToString("yyyyMMdd")).ToArray();
        services["metro:regular"] = new("metro:regular", "20250101", "20361231", [1, 1, 1, 1, 1, 1, 0], holidays.ToDictionary(d => d, _ => 2));
        services["metro:holiday"] = new("metro:holiday", "20250101", "20361231", [0, 0, 0, 0, 0, 0, 1], holidays.ToDictionary(d => d, _ => 1));
        foreach (var raw in data.Lines)
        {
            var line = new Line(raw.GetProperty("line").GetString()!, raw.GetProperty("stations").Deserialize<Station[]>(Json)!);
            foreach (var station in line.Stations)
                stops[station.Id] = new(station.Id, station.Name, station.Point);
            foreach (var direction in new[] { 0, 1 })
            {
                var ordered = direction == 0 ? line.Stations : line.Stations.Reverse().ToArray();
                var seconds = 0;
                var sequence = new List<PatternStop>();
                for (var i = 0; i < ordered.Length; i++)
                {
                    if (i > 0) seconds += direction == 0 ? ordered[i].SecondsFromPrevious : ordered[i - 1].SecondsFromPrevious;
                    sequence.Add(new(ordered[i].Id, seconds, seconds, true, true));
                }
                var route = "metro:" + line.LineNumber;
                patterns.Add(new(route + ":" + direction, route, line.LineNumber, "MetrôRio " + line.LineNumber, "metro", direction, ordered[^1].Name, route + ":" + direction, "DE643B", data.FareCents, false, sequence.ToArray(),
                    [new("metro:regular", 5 * 3600, 24 * 3600, data.EstimatedHeadwaySeconds, false), new("metro:holiday", 7 * 3600, 23 * 3600, data.EstimatedHeadwaySeconds, false)]));
            }
        }
        return network with { Stops = stops, Patterns = patterns.ToArray(), Services = services, Source = network.Source + " + MetrôRio (rede e tempos estimados; verificação 2026-10-08)" };
    }

    public static IEnumerable<DateOnly> Holidays(int year)
    {
        // National holidays, Rio city/state holidays, Carnival Tuesday, Good Friday and Corpus Christi.
        foreach (var (month, day) in new[] { (1, 1), (1, 20), (4, 21), (4, 23), (5, 1), (9, 7), (10, 12), (11, 2), (11, 15), (11, 20), (12, 25) })
            yield return new(year, month, day);
        var a = year % 19; var b = year / 100; var c = year % 100;
        var d = b / 4; var e = b % 4; var f = (b + 8) / 25; var g = (b - f + 1) / 3;
        var h = (19 * a + b - d - g + 15) % 30; var i = c / 4; var k = c % 4;
        var l = (32 + 2 * e + 2 * i - h - k) % 7; var m = (a + 11 * h + 22 * l) / 451;
        var easter = new DateOnly(year, (h + l - 7 * m + 114) / 31, (h + l - 7 * m + 114) % 31 + 1);
        yield return easter.AddDays(-47);
        yield return easter.AddDays(-2);
        yield return easter.AddDays(60);
    }
}
