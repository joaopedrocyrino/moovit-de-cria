using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Cria.Application;
using Cria.Domain;
namespace Cria.Infrastructure;

public static class VehicleParser
{
    private static string? Text(JsonElement r, string key) => r.TryGetProperty(key, out var p) && p.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined) ? p.ToString() : null;
    private static double? Number(JsonElement r, string key) => double.TryParse(Text(r, key)?.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : null;
    public static Vehicle[] Parse(JsonElement root, DateTimeOffset now, string source) =>
        ParseReports(root, now, source).GroupBy(v => v.Id).Select(g => g.MaxBy(v => v.ObservedAt)!).ToArray();
    // Keep all valid reports until route/direction resolution: another provider may omit trip identifiers.
    public static Vehicle[] ParseReports(JsonElement root, DateTimeOffset now, string source)
    {
        var data = root.ValueKind == JsonValueKind.Array ? root : root.TryGetProperty("data", out var list) ? list : root.TryGetProperty("veiculos", out list) ? list : default;
        if (data.ValueKind != JsonValueKind.Array)
            throw new FormatException("Unexpected vehicle feed format");
        var items = new List<Vehicle>();
        foreach (var row in data.EnumerateArray())
        {
            var id = Text(row, "id_veiculo") ?? Text(row, "codigo") ?? Text(row, "ordem");
            var line = Text(row, "servico") ?? Text(row, "linha");
            var lat = Number(row, "latitude");
            var lon = Number(row, "longitude");
            if (id is null || line is null || lat is null || lon is null)
                continue;
            var point = new Point(lat.Value, lon.Value);
            if (!point.InRioBounds)
                continue;
            DateTimeOffset at;
            if (!DateTimeOffset.TryParse(Text(row, "datetime"), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out at))
            {
                var ms = Number(row, "dataHora") ?? Number(row, "datahora");
                if (ms is null)
                    continue;
                try
                {
                    at = DateTimeOffset.FromUnixTimeMilliseconds((long)ms.Value);
                }
                catch (ArgumentOutOfRangeException) { continue; }
            }
            if (at < now.AddSeconds(-180) || at > now.AddSeconds(30))
                continue;
            var direction = Number(row, "direction_id");
            int? d = direction is 0 or 1 ? (int)direction.Value : Text(row, "sentido")?.ToLowerInvariant() switch
            {
                "i" or "ida" => 0,
                "v" or "volta" => 1,
                _ => null
            };
            var bearing = Number(row, "direcao");
            items.Add(new(id, line, Text(row, "route_id"), d, point, at, Number(row, "velocidade"), bearing is >= 0 and <= 360 ? bearing : null, source, Text(row, "shape_id")));
        }
        return items.ToArray();
    }
}
public sealed class VehicleFeed(IHttpClientFactory clients, IMemoryCache cache, IConfiguration config, ITransitStore store, TimeProvider? timeProvider = null) : IVehicles
{
    private sealed record Snapshot(Vehicle[] Vehicles, DateTimeOffset CheckedAt, bool Available);
    private sealed record Batch(Vehicle[] Reports, bool MinuteBased, bool Available);
    private readonly TimeProvider clock = timeProvider ?? TimeProvider.System;
    private readonly SemaphoreSlim gate = new(1);

    public async Task<VehicleResult> Get(string routeId, string line, int? direction, CancellationToken ct)
    {
        if (routeId.StartsWith("metro:", StringComparison.Ordinal))
            return new([], "unavailable", clock.GetUtcNow(), "MetrôRio não possui GPS público integrado. Os tempos da rota são estimativas.");
        var key = $"vehicles:line:{line.Trim().ToUpperInvariant()}";
        cache.TryGetValue<Snapshot>(key, out var snapshot);
        if (snapshot is null || snapshot.CheckedAt <= clock.GetUtcNow().AddSeconds(-20))
        {
            await gate.WaitAsync(ct);
            try
            {
                cache.TryGetValue(key, out snapshot);
                if (snapshot is null || snapshot.CheckedAt <= clock.GetUtcNow().AddSeconds(-20))
                {
                    var now = clock.GetUtcNow();
                    var minute = new DateTimeOffset(now.Year, now.Month, now.Day, now.Hour, now.Minute, 0, TimeSpan.Zero);
                    var current = await ReadMinute(line, minute, ct);
                    var batches = new List<Batch> { current };
                    if (current.MinuteBased)
                    {
                        // ITS returns one receipt-minute, not the fleet. Bootstrap the freshness window,
                        // then read the previous minute too to catch reports arriving between polls.
                        var lookback = snapshot is null || snapshot.Vehicles.Length == 0 ? 3 : 1;
                        batches.AddRange(await Task.WhenAll(Enumerable.Range(1, lookback).Select(i => ReadMinute(line, minute.AddMinutes(-i), ct))));
                    }
                    var patterns = store.Get().Patterns;
                    var assignments = patterns.GroupBy(p => (p.RouteId, p.ShapeId))
                        .ToDictionary(g => g.Key, g => g.Select(p => p.Direction).Distinct().Take(2).ToArray());
                    var updates = batches.SelectMany(b => b.Reports).Select(v =>
                    {
                        if (v.Direction is not null || string.IsNullOrEmpty(v.RouteId) || string.IsNullOrEmpty(v.ShapeId)) return v;
                        return assignments.TryGetValue((v.RouteId, v.ShapeId), out var directions) && directions.Length == 1
                            ? v with { Direction = directions[0] } : v;
                    });
                    snapshot = new(VehicleHistory.Merge(snapshot?.Vehicles ?? [], updates, clock.GetUtcNow()), clock.GetUtcNow(), batches.All(b => b.Available));
                    // Preserve reports between polls; their original observation times still expire at 180s.
                    cache.Set(key, snapshot, TimeSpan.FromMinutes(3));
                }
            }
            finally { gate.Release(); }
        }
        var fleet = VehicleHistory.Merge(snapshot!.Vehicles, [], clock.GetUtcNow());
        var vehicles = string.IsNullOrEmpty(routeId) ? fleet : fleet.Where(v => v.RouteId == routeId && (!direction.HasValue || v.Direction == direction)).ToArray();
        var unknown = fleet.Count(v => v.Direction is null);
        var message = $"{vehicles.Length} veículo(s) confirmado(s) nesta rota e sentido; {fleet.Length} na linha inteira. Outras opções podem usar o sentido ou uma variação diferente.";
        if (unknown > 0) message += $" {unknown} sem sentido informado; não são apresentados como embarques confirmados.";
        if (!snapshot.Available) message += " O GPS do operador está indisponível ou incompleto. Exibimos somente posições já recebidas há até 3 minutos, com o horário original.";
        else if (vehicles.Length == 0) message += " Nenhum GPS recente confirmado para este embarque; não há posição simulada.";
        return new(vehicles, !snapshot.Available ? "unavailable" : vehicles.Length == 0 ? "empty" : "live", snapshot.CheckedAt, message, fleet.Length, unknown);
    }

    private async Task<Batch> ReadMinute(string line, DateTimeOffset minute, CancellationToken ct)
    {
        try
        {
            var endpoint = config["Transit:VehiclesUrl"] ?? "https://its.mobilidade.rio/v1/geolocalizacao/veiculos";
            var url = $"{endpoint}{(endpoint.Contains('?') ? "&" : "?")}servico={Uri.EscapeDataString(line)}&limit=5000&minuto_utc={Uri.EscapeDataString(minute.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture))}";
            var reports = new List<Vehicle>();
            var cursors = new HashSet<string>();
            string? cursor = null;
            bool minuteBased = false;
            do
            {
                using var response = await clients.CreateClient("external").GetAsync(cursor is null ? url : url + "&cursor=" + Uri.EscapeDataString(cursor), ct);
                response.EnsureSuccessStatusCode();
                using var doc = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(ct));
                var root = doc.RootElement;
                reports.AddRange(VehicleParser.ParseReports(root, clock.GetUtcNow(), "SMTR ITS").Where(v => string.Equals(v.Line, line, StringComparison.OrdinalIgnoreCase)));
                minuteBased |= root.ValueKind == JsonValueKind.Object && root.TryGetProperty("minuto_utc", out var value) && value.ValueKind == JsonValueKind.String;
                cursor = root.ValueKind == JsonValueKind.Object && root.TryGetProperty("next_cursor", out var next) && next.ValueKind == JsonValueKind.String ? next.GetString() : null;
                if (!string.IsNullOrEmpty(cursor) && (!cursors.Add(cursor) || cursors.Count >= 10)) throw new FormatException("Invalid vehicle pagination");
            } while (!string.IsNullOrEmpty(cursor));
            return new(reports.ToArray(), minuteBased, true);
        }
        catch (Exception e) when (e is HttpRequestException or JsonException or FormatException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            return new([], false, false);
        }
    }
}
