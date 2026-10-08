using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Cria.Application;
using Cria.Domain;
namespace Cria.Infrastructure;

public sealed class TransitStore(IConfiguration config) : ITransitStore
{
    private readonly object gate = new(); private Network? cached; private DateTime loaded;
    private string Path => System.IO.Path.GetFullPath(config["Transit:Database"] ?? ".data/transit.sqlite");
    private SqliteConnection Open()
    {
        if (!File.Exists(Path))
            throw new AppError(503, "Importe o GTFS: npm run data:sync.");
        var c = new SqliteConnection($"Data Source={Path};Mode=ReadOnly;Pooling=False");
        c.Open();
        return c;
    }
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    public Network Get()
    {
        lock (gate)
        {
            var mtime = File.GetLastWriteTimeUtc(Path);
            if (cached is not null && mtime == loaded)
                return cached;
            using var c = Open();
            using var command = c.CreateCommand();
            command.CommandText = "SELECT id,name,lat,lon FROM stops";
            var stops = new Dictionary<string, Stop>();
            using (var r = command.ExecuteReader())
            while (r.Read())
                stops[r.GetString(0)] = new(r.GetString(0), r.GetString(1), new(r.GetDouble(2), r.GetDouble(3)));
            command.CommandText = "SELECT payload FROM patterns";
            var patterns = new List<Pattern>();
            using (var r = command.ExecuteReader())
            while (r.Read())
                patterns.Add(JsonSerializer.Deserialize<Pattern>(r.GetString(0), Json)!);
            command.CommandText = "SELECT payload FROM services";
            var services = new Dictionary<string, Service>();
            using (var r = command.ExecuteReader())
            while (r.Read())
            {
                var s = JsonSerializer.Deserialize<Service>(r.GetString(0), Json)!;
                services[s.Id] = s;
            }
            command.CommandText = "SELECT key,value FROM metadata";
            var meta = new Dictionary<string, string>();
            using (var r = command.ExecuteReader())
            while (r.Read())
                meta[r.GetString(0)] = r.GetString(1);
            if (stops.Count == 0 || patterns.Count == 0)
                throw new AppError(503, "O GTFS importado não contém serviços utilizáveis.");
            cached = MetroNetwork.AddTo(new(stops, patterns.ToArray(), services, meta["importedAt"], meta["source"], meta.GetValueOrDefault("validUntil")));
            loaded = mtime;
            return cached;
        }
    }
    public Point[] Shape(string id)
    {
        if (id.StartsWith("metro:", StringComparison.Ordinal))
        {
            var pattern = Get().Patterns.FirstOrDefault(p => p.Mode == "metro" && p.ShapeId == id);
            return pattern?.Stops.Select(s => Get().Stops[s.StopId].Point).ToArray() ?? [];
        }
        using var c = Open();
        using var q = c.CreateCommand();
        q.CommandText = "SELECT lat,lon FROM shapes WHERE id=$id ORDER BY seq LIMIT 6000";
        q.Parameters.AddWithValue("$id", id);
        using var r = q.ExecuteReader();
        var points = new List<Point>();
        while (r.Read())
            points.Add(new(r.GetDouble(0), r.GetDouble(1)));
        return points.ToArray();
    }
}
