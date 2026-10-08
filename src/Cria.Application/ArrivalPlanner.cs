using Cria.Domain;
namespace Cria.Application;

// Latest-feasible-departure search over the same service calendars as leave-at routing.
internal static class ArrivalPlanner
{
    private sealed record Label(string StopId, DateTimeOffset At, int Rides, string Last, Leg[] Legs, bool Walked);
    public static PlanResponse Plan(PlanRequest request, Network network, DateTimeOffset deadline, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var origin = new Stop("origin", "Origem", request.From);
        var destination = new Stop("destination", "Destino", request.To);
        var byStop = new Dictionary<string, List<(Pattern Pattern, int Index)>>();
        foreach (var pattern in network.Patterns)
            for (var j = 1; j < pattern.Stops.Length; j++)
            {
                if (!pattern.Stops[j].Dropoff) continue;
                if (!byStop.TryGetValue(pattern.Stops[j].StopId, out var list)) byStop[pattern.Stops[j].StopId] = list = [];
                list.Add((pattern, j));
            }
        var costs = Planner.RemainingSeconds(network, request.From, reverseTravel: true);
        var queue = new PriorityQueue<Label, long>();
        var best = new Dictionary<(string, int, string, bool), DateTimeOffset>();
        void Offer(Label label)
        {
            if (label.At < now || label.At < deadline.AddHours(-3) || !costs.TryGetValue(label.StopId, out var cost)) return;
            var key = (label.StopId, label.Rides, label.Last, label.Walked);
            if (best.TryGetValue(key, out var existing) && existing >= label.At) return;
            best[key] = label.At;
            queue.Enqueue(label, -(label.At.UtcTicks - (long)cost * TimeSpan.TicksPerSecond));
        }
        Leg Walk(Stop from, Stop to, DateTimeOffset end)
        {
            var seconds = Math.Max(20, (int)Math.Ceiling(from.Point.Distance(to.Point) * 1.3 / 1.2));
            return new("walk", null, null, null, null, null, null, end.AddSeconds(-seconds), end, from, to, [from, to], 0, false, true);
        }
        foreach (var stop in network.Stops.Values.Where(s => s.Point.Distance(request.To) <= 900).OrderBy(s => s.Point.Distance(request.To)).Take(12).Concat(network.Stops.Values.Where(s => s.Id.StartsWith("metro:") && s.Point.Distance(request.To) <= 900)).DistinctBy(s => s.Id))
        {
            var walk = Walk(stop, destination, deadline);
            Offer(new(stop.Id, walk.Start, 0, "", [walk], true));
        }
        var results = new Dictionary<string, Itinerary>();
        var neighbors = new Dictionary<string, Stop[]>();
        var expanded = 0;
        while (queue.TryDequeue(out var label, out _) && expanded++ < 30000)
        {
            ct.ThrowIfCancellationRequested();
            if (best[(label.StopId, label.Rides, label.Last, label.Walked)] != label.At) continue;
            var here = network.Stops[label.StopId];
            if (label.Rides > 0 && here.Point.Distance(request.From) <= 900)
            {
                var firstWalk = Walk(origin, here, label.At);
                var legs = new[] { firstWalk }.Concat(label.Legs).ToArray();
                // The last walk starts when the last vehicle arrives, rather than waiting until the deadline.
                var lastWalk = legs[^1];
                legs[^1] = lastWalk with { Start = legs[^2].End, End = legs[^2].End + (lastWalk.End - lastWalk.Start) };
                var departure = firstWalk.Start;
                var arrival = legs[^1].End;
                var signature = string.Join("|", legs.Where(l => l.Kind == "transit").Select(l => $"{l.Mode}:{l.Line}:{l.Headsign}"));
                if (departure >= now && arrival - departure <= TimeSpan.FromHours(3) && arrival <= deadline && (!results.TryGetValue(signature, out var existing) || existing.Departure < departure))
                {
                    results[signature] = new(Guid.NewGuid().ToString("N"), (int)Math.Ceiling((arrival - departure).TotalMinutes), label.Rides - 1, (int)Math.Ceiling(legs.Where(l => l.Kind == "walk").Sum(l => (l.End - l.Start).TotalMinutes)), departure, arrival, Fares.Quote(legs, request.Payment), legs);
                    if (results.Count >= 24) break;
                }
            }
            if (!label.Walked && label.Rides > 0)
            {
                if (!neighbors.TryGetValue(here.Id, out var nearby))
                    neighbors[here.Id] = nearby = network.Stops.Values.Where(s => s.Id != here.Id && s.Point.Distance(here.Point) <= (s.Id.StartsWith("metro:") || here.Id.StartsWith("metro:") ? 350 : 180)).OrderBy(s => s.Point.Distance(here.Point)).Take(here.Id.StartsWith("metro:") ? 12 : 6).Concat(network.Stops.Values.Where(s => s.Id.StartsWith("metro:") && s.Id != here.Id && s.Point.Distance(here.Point) <= 350)).DistinctBy(s => s.Id).ToArray();
                foreach (var stop in nearby)
                {
                    var walk = Walk(stop, here, label.At);
                    Offer(label with { StopId = stop.Id, At = walk.Start, Legs = [walk, .. label.Legs], Walked = true });
                }
            }
            if (label.Rides >= request.MaxTransfers + 1 || !byStop.TryGetValue(here.Id, out var candidates)) continue;
            foreach (var (pattern, j) in candidates)
            {
                if (label.Legs.FirstOrDefault(l => l.Kind == "transit")?.RouteId == pattern.RouteId) continue;
                var latestArrival = label.At.AddSeconds(label.Rides > 0 ? -90 : 0);
                var baseTiming = pattern.Mode == "metro" ? null : Schedules.LatestDeparture(pattern, 0, latestArrival.AddSeconds(-(pattern.Stops[j].Arrival - pattern.Stops[0].Departure)), network);
                if (pattern.Mode != "metro" && baseTiming is null) continue;
                for (var i = 0; i < j; i++)
                {
                    if (!pattern.Stops[i].Pickup || !network.Stops.TryGetValue(pattern.Stops[i].StopId, out var from)) continue;
                    var seconds = pattern.Stops[j].Arrival - pattern.Stops[i].Departure;
                    if (seconds < 0) continue;
                    var timing = baseTiming is null ? Schedules.LatestDeparture(pattern, i, latestArrival.AddSeconds(-seconds), network) : (baseTiming.Value.Departure.AddSeconds(pattern.Stops[i].Departure - pattern.Stops[0].Departure), baseTiming.Value.Ready.AddSeconds(pattern.Stops[i].Departure - pattern.Stops[0].Departure));
                    if (timing is null || timing.Value.Ready < now || timing.Value.Ready < deadline.AddHours(-3)) continue;
                    // Retain alternatives by final transit mode without multiplying every search state by all destination bus lines.
                    var last = label.Last.Length == 0 ? pattern.Mode : label.Last;
                    var key = (from.Id, label.Rides + 1, last, false);
                    if (best.TryGetValue(key, out var later) && later >= timing.Value.Ready) continue;
                    var stops = pattern.Stops.Skip(i).Take(j - i + 1).Select(s => network.Stops[s.StopId]).ToArray();
                    var leg = new Leg("transit", pattern.RouteId, pattern.Line, pattern.Mode, pattern.Headsign, pattern.Direction, pattern.ShapeId, timing.Value.Departure, timing.Value.Departure.AddSeconds(seconds), from, here, stops, pattern.FareCents, pattern.Municipal, true);
                    Offer(new(from.Id, timing.Value.Ready, label.Rides + 1, last, [leg, .. label.Legs], false));
                }
            }
        }
        var notices = Planner.Notices(network, expanded).Append("Chegar até: opções ordenadas pela saída mais tarde que permite chegar ao destino até o horário escolhido, incluindo caminhada final. Tempos estimados não garantem a chegada.").ToArray();
        return new(results.Values.OrderByDescending(i => i.Departure).Take(8).ToArray(), notices, network.Source, network.ImportedAt);
    }
}
