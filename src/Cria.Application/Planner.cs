using Cria.Domain;
namespace Cria.Application;

public sealed class Planner(ITransitStore store)
{
    private sealed record Label(string StopId, DateTimeOffset At, int Rides, string First, Leg[] Legs, bool Walked);
    public PlanResponse Plan(PlanRequest request, CancellationToken ct)
    {
        if (!request.From.InRioBounds || !request.To.InRioBounds)
            throw new AppError(400, "Escolha origem e destino na região do Rio de Janeiro.");
        if (request.Payment is not ("individual" or "jae") || request.MaxTransfers is < 0 or > 2)
            throw new AppError(400, "Opções de viagem inválidas.");
        if (request.Departure is not null && request.ArriveBy is not null)
            throw new AppError(400, "Escolha sair em um horário ou chegar até um horário, não ambos.");
        var start = request.Departure ?? request.ArriveBy ?? DateTimeOffset.UtcNow;
        if (start < DateTimeOffset.UtcNow.AddMinutes(-2) || start > DateTimeOffset.UtcNow.AddDays(7))
            throw new AppError(400, "Escolha um horário entre agora e os próximos 7 dias.");
        var n = store.Get();
        if (n.ValidUntil is not null && string.CompareOrdinal(TimeZoneInfo.ConvertTime(start, Schedules.Rio).ToString("yyyyMMdd"), n.ValidUntil) > 0)
            throw new AppError(503, "O GTFS está vencido. Atualize os horários antes de planejar.");
        if (request.ArriveBy is not null)
            return ArrivalPlanner.Plan(request, n, start, ct);
        var origin = new Stop("origin", "Origem", request.From);
        var destination = new Stop("destination", "Destino", request.To);
        var byStop = new Dictionary<string, List<(Pattern Pattern, int Index)>>();
        foreach (var p in n.Patterns)
            for (var i = 0; i < p.Stops.Length - 1; i++)
            {
                if (!p.Stops[i].Pickup)
                    continue;
                if (!byStop.TryGetValue(p.Stops[i].StopId, out var list))
                    byStop[p.Stops[i].StopId] = list = [];
                list.Add((p, i));
            }
        var finishes = n.Stops.Values.Where(s => s.Point.Distance(request.To) <= 900).ToDictionary(s => s.Id);
        var remainingSeconds = RemainingSeconds(n, request.To);
        var queue = new PriorityQueue<Label, long>();
        var best = new Dictionary<(string, int, string, bool), DateTimeOffset>();
        void Offer(Label l)
        {
            if (!remainingSeconds.TryGetValue(l.StopId, out var remaining)) return;
            var key = (l.StopId, l.Rides, l.First, l.Walked);
            if (best.TryGetValue(key, out var old) && old <= l.At)
                return;
            best[key] = l.At;
            // Static transit + walking lower bound directs the search toward feasible connections.
            queue.Enqueue(l, l.At.UtcTicks + (long)remaining * TimeSpan.TicksPerSecond);
        }
        Leg Walk(Stop from, Stop to, DateTimeOffset at)
        {
            var seconds = Math.Max(20, (int)Math.Ceiling(from.Point.Distance(to.Point) * 1.3 / 1.2));
            return new("walk", null, null, null, null, null, null, at, at.AddSeconds(seconds), from, to, [from, to], 0, false, true);
        }
        foreach (var s in n.Stops.Values.Where(s => s.Point.Distance(request.From) <= 900).OrderBy(s => s.Point.Distance(request.From)).Take(12).Concat(n.Stops.Values.Where(s => s.Id.StartsWith("metro:") && s.Point.Distance(request.From) <= 900)).DistinctBy(s => s.Id))
        {
            var leg = Walk(origin, s, start);
            Offer(new(s.Id, leg.End, 0, "", [leg], true));
        }
        var results = new Dictionary<string, Itinerary>();
        var walkedNeighbors = new Dictionary<string, Stop[]>();
        int expanded = 0;
        while (queue.TryDequeue(out var label, out _) && expanded++ < 30000)
        {
            ct.ThrowIfCancellationRequested();
            if (label.At > start.AddHours(3))
                continue;
            var key = (label.StopId, label.Rides, label.First, label.Walked);
            if (best[key] != label.At)
                continue;
            var here = n.Stops[label.StopId];
            if (label.Rides > 0 && finishes.TryGetValue(label.StopId, out var finalStop))
            {
                var walk = Walk(finalStop, destination, label.At);
                var legs = label.Legs.Append(walk).ToArray();
                var signature = string.Join("|", legs.Where(l => l.Kind == "transit").Select(l => $"{l.Mode}:{l.Line}:{l.Headsign}"));
                if (!results.TryGetValue(signature, out var existing) || existing.Arrival > walk.End)
                {
                    results[signature] = new(Guid.NewGuid().ToString("N"), (int)Math.Ceiling((walk.End - start).TotalMinutes), label.Rides - 1, (int)Math.Ceiling(legs.Where(l => l.Kind == "walk").Sum(l => (l.End - l.Start).TotalMinutes)), start, walk.End, Fares.Quote(legs, request.Payment), legs);
                    if (results.Count >= 24)
                        break;
                }
            }
            if (!label.Walked && label.Rides > 0)
            {
                if (!walkedNeighbors.TryGetValue(here.Id, out var nearby))
                    walkedNeighbors[here.Id] = nearby = n.Stops.Values.Where(s => s.Id != here.Id && s.Point.Distance(here.Point) <= (s.Id.StartsWith("metro:") || here.Id.StartsWith("metro:") ? 350 : 180)).OrderBy(s => s.Point.Distance(here.Point)).Take(here.Id.StartsWith("metro:") ? 12 : 6).Concat(n.Stops.Values.Where(s => s.Id.StartsWith("metro:") && s.Id != here.Id && s.Point.Distance(here.Point) <= 350)).DistinctBy(s => s.Id).ToArray();
                foreach (var s in nearby)
                {
                    var walk = Walk(here, s, label.At);
                    Offer(label with
                    {
                        StopId = s.Id,
                        At = walk.End,
                        Legs = [.. label.Legs, walk],
                        Walked = true
                    });
                }
            }
            if (label.Rides >= request.MaxTransfers + 1 || !byStop.TryGetValue(here.Id, out var candidates))
                continue;
            foreach (var (p, i) in candidates)
            {
                // Avoid boarding the same route again without meaningful progress.
                if (label.Legs.LastOrDefault(l => l.Kind == "transit")?.RouteId == p.RouteId)
                    continue;
                var depart = Schedules.Departure(p, i, label.At.AddSeconds(label.Rides > 0 ? 90 : 0), n);
                if (depart is null)
                    continue;
                for (var j = i + 1; j < p.Stops.Length; j++)
                {
                    if (!p.Stops[j].Dropoff || !n.Stops.TryGetValue(p.Stops[j].StopId, out var to))
                        continue;
                    var arrival = depart.Value.AddSeconds(p.Stops[j].Arrival - p.Stops[i].Departure);
                    if (arrival < depart || arrival > start.AddHours(3))
                        continue;
                    var destinationKey = (to.Id, label.Rides + 1, label.First.Length == 0 ? $"{p.Mode}:{p.Line}:{p.Headsign}" : label.First, false);
                    if (best.TryGetValue(destinationKey, out var earlier) && earlier <= arrival)
                        continue;
                    var stops = p.Stops.Skip(i).Take(j - i + 1).Select(s => n.Stops[s.StopId]).ToArray();
                    var leg = new Leg("transit", p.RouteId, p.Line, p.Mode, p.Headsign, p.Direction, p.ShapeId, depart.Value, arrival, here, to, stops, p.FareCents, p.Municipal, true);
                    Offer(new(to.Id, arrival, label.Rides + 1, label.First.Length == 0 ? $"{p.Mode}:{p.Line}:{p.Headsign}" : label.First, [.. label.Legs, leg], false));
                }
            }
        }
        return new(results.Values.OrderBy(r => r.Arrival).Take(8).ToArray(), Notices(n, expanded), n.Source, n.ImportedAt);
    }

    internal static string[] Notices(Network n, int expanded)
    {
        var notices = new List<string> { "Cobertura: ônibus municipais e BRT da SMTR + MetrôRio (linhas 1/4 e 2). Trem, VLT e barcas ainda não estão integrados.", "Até 8 alternativas encontradas, até 2 baldeações e 3h de viagem. Horários e caminhadas são estimativas; caminhos a pé usam distância aproximada, não uma rota de calçadas.", "Os horários não são ajustados por trânsito em tempo real. Confira o letreiro e o sentido antes de embarcar." };
        if (n.Patterns.Any(p => p.Mode == "metro"))
            notices.Add("Metrô: tempos entre estações publicados pelo operador, espera estimada de 4 min e horário regular de funcionamento. Alterações operacionais não são consultadas em tempo real; não há GPS público de trens integrado.");
        if (expanded >= 30000)
            notices.Add("Busca atingiu o limite de processamento; pode haver outras alternativas.");
        return notices.ToArray();
    }

    internal static Dictionary<string, int> RemainingSeconds(Network network, Point destination, bool reverseTravel = false)
    {
        // Reverse shortest paths ignore waiting/service hours: optimistic costs, never fabricated trips.
        var reverse = network.Stops.Keys.ToDictionary(id => id, _ => new Dictionary<string, int>());
        void Edge(string from, string to, int seconds)
        {
            if (reverseTravel) (from, to) = (to, from);
            if (!reverse[to].TryGetValue(from, out var old) || seconds < old) reverse[to][from] = seconds;
        }
        foreach (var pattern in network.Patterns)
            for (var i = 1; i < pattern.Stops.Length; i++)
                Edge(pattern.Stops[i - 1].StopId, pattern.Stops[i].StopId, Math.Max(0, pattern.Stops[i].Arrival - pattern.Stops[i - 1].Departure));
        // Spatial buckets avoid comparing every pair of stops for transfer walks.
        (int, int) Cell(Stop s) => ((int)Math.Floor(s.Point.Lat / .004), (int)Math.Floor(s.Point.Lon / .004));
        var grid = network.Stops.Values.GroupBy(Cell).ToDictionary(g => g.Key, g => g.ToArray());
        foreach (var stop in network.Stops.Values)
        {
            var (lat, lon) = Cell(stop);
            for (var dx = -1; dx <= 1; dx++)
                for (var dy = -1; dy <= 1; dy++)
                    if (grid.TryGetValue((lat + dx, lon + dy), out var neighbors))
                        foreach (var neighbor in neighbors)
                        {
                            if (stop.Id == neighbor.Id) continue;
                            var distance = stop.Point.Distance(neighbor.Point);
                            var max = stop.Id.StartsWith("metro:") || neighbor.Id.StartsWith("metro:") ? 350 : 180;
                            if (distance <= max) Edge(stop.Id, neighbor.Id, Math.Max(20, (int)Math.Ceiling(distance * 1.3 / 1.2)));
                        }
        }
        var best = new Dictionary<string, int>();
        var queue = new PriorityQueue<string, int>();
        foreach (var stop in network.Stops.Values)
        {
            var distance = stop.Point.Distance(destination);
            if (distance <= 900)
            {
                var seconds = Math.Max(20, (int)Math.Ceiling(distance * 1.3 / 1.2));
                best[stop.Id] = seconds; queue.Enqueue(stop.Id, seconds);
            }
        }
        while (queue.TryDequeue(out var id, out var seconds))
        {
            if (best[id] != seconds) continue;
            foreach (var (previous, weight) in reverse[id])
                if (!best.TryGetValue(previous, out var old) || seconds + weight < old)
                {
                    best[previous] = seconds + weight; queue.Enqueue(previous, seconds + weight);
                }
        }
        return best;
    }
}
