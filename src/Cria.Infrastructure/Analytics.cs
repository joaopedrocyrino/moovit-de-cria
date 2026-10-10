using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Npgsql;
using Microsoft.Extensions.Configuration;
using Cria.Domain;

namespace Cria.Infrastructure;

public sealed record UsageEvent(string Id, string Name, DateTimeOffset At, Dictionary<string, JsonElement> Properties);
public sealed class Analytics
{
    private readonly ApplicationDatabase database;
    private readonly TimeProvider clock;
    public const int RetentionDays = 90;
    // Every field has a purpose and a bounded type. Never accept raw URLs, form text, GPS, email, or error stacks.
    private static readonly Dictionary<string, string> Fields = new()
    {
        ["release"] = "release", ["browser"] = "safari|chrome|firefox|edge|other", ["os"] = "ios|android|mac|windows|linux|other",
        ["viewport"] = "small|medium|large", ["theme"] = "light|dark|system", ["storage"] = "guest|account",
        ["kind"] = "address|line", ["action"] = "add|edit|remove", ["mode"] = "bus|brt|metro",
        ["method"] = "login|register|logout|password|delete", ["result"] = "success|error|denied|timeout|unavailable|insecure|unsupported",
        ["accuracy"] = "fine|medium|coarse", ["timing"] = "now|depart|arrive", ["payment"] = "individual|jae",
        ["control"] = "zoom_in|zoom_out|locate|vehicle", ["expanded"] = "bool", ["tab"] = "addresses|lines|settings", ["source"] = "search|saved|gps", ["target"] = "from|to",
        ["step"] = "board|alight|back", ["online"] = "bool", ["authenticated"] = "bool",
        ["endpoint"] = "config|plans|places-search|places-reverse|vehicles|shapes|lines|auth|account",
        ["metric"] = "load|lcp|cls|interaction", ["duration"] = "number", ["count"] = "number", ["length"] = "number",
        ["status"] = "number", ["legs"] = "number", ["value"] = "number"
    };
    private static readonly Dictionary<string, string[]> Events = new()
    {
        ["app_open"] = ["browser", "os", "viewport", "theme", "authenticated", "release"],
        ["account_state"] = ["authenticated"], ["map_action"] = ["control"], ["panel_change"] = ["expanded"], ["about_open"] = [],
        ["engagement"] = ["duration"], ["theme_change"] = ["theme"], ["connectivity"] = ["online"],
        ["saved_change"] = ["storage", "kind", "action", "mode"], ["saved_open"] = ["tab", "storage"],
        ["place_selected"] = ["source", "target"], ["place_search"] = ["length"],
        ["route_search"] = ["timing", "payment"], ["route_result"] = ["count", "duration"], ["route_selected"] = ["legs"],
        ["journey_step"] = ["step"], ["location_request"] = [], ["location_result"] = ["result", "accuracy"],
        ["auth_result"] = ["method", "result"], ["api_result"] = ["endpoint", "status", "duration", "count"],
        ["performance"] = ["metric", "value"], ["ui_error"] = ["release"]
    };
    public Analytics(ApplicationDatabase database, TimeProvider clock)
    {
        this.clock = clock;
        this.database = database;
        Prune();
    }
    private NpgsqlConnection Open() => database.Open();
    private static void LockVisitor(NpgsqlConnection db, NpgsqlTransaction tx, string visitor)
    {
        using var command = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtextextended(@visitor,0))",db,tx);
        command.Parameters.AddWithValue("visitor",visitor);
        command.ExecuteNonQuery();
    }
    public static string Hash(string id) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(id)));
    public void Record(string visitor, string session, UsageEvent[] events)
    {
        if (events is null || events.Length is < 1 or > 20) throw new AppError(400, "Lote de eventos inválido.");
        var now = clock.GetUtcNow();
        foreach (var e in events)
        {
            if (e is null || !Guid.TryParse(e.Id, out _) || e.Name is null || !Events.TryGetValue(e.Name, out var allowed)
                || e.At < now.AddHours(-24) || e.At > now.AddMinutes(5) || e.Properties is null || e.Properties.Count > allowed.Length)
                throw new AppError(400, "Evento inválido.");
            foreach (var (key, value) in e.Properties)
            {
                if (!allowed.Contains(key) || !Fields.TryGetValue(key, out var type)) throw new AppError(400, "Propriedade não permitida.");
                var valid = type switch
                {
                    "number" => value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) && double.IsFinite(number) && number is >= 0 and <= 3600000,
                    "release" => value.ValueKind == JsonValueKind.String && Regex.IsMatch(value.GetString()!, "^(?:[a-f0-9]{40}|[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3})$"),
                    "bool" => value.ValueKind is JsonValueKind.True or JsonValueKind.False,
                    _ => value.ValueKind == JsonValueKind.String && type.Split('|').Contains(value.GetString())
                };
                if (!valid) throw new AppError(400, "Valor de evento inválido.");
            }
        }
        {
            using var db = Open(); using var tx = db.BeginTransaction();
            LockVisitor(db, tx, visitor);
            using var revoked = db.CreateCommand(); revoked.Transaction = tx;
            revoked.CommandText = "SELECT COUNT(*) FROM usage_revocations WHERE visitor=@v AND expires_at>@now";
            revoked.Parameters.AddWithValue("@v", visitor); revoked.Parameters.AddWithValue("@now", now.ToUnixTimeMilliseconds());
            if (Convert.ToInt64(revoked.ExecuteScalar()) > 0) throw new AppError(403, "Consentimento revogado.");
            foreach (var e in events)
            {
                using var cmd = db.CreateCommand(); cmd.Transaction = tx;
                cmd.CommandText = "INSERT INTO usage_events VALUES (@id,1,@visitor,@session,@name,@at,@now,CAST(@props AS jsonb)) ON CONFLICT(id) DO NOTHING";
                cmd.Parameters.AddWithValue("@id", e.Id); cmd.Parameters.AddWithValue("@visitor", visitor); cmd.Parameters.AddWithValue("@session", session);
                cmd.Parameters.AddWithValue("@name", e.Name); cmd.Parameters.AddWithValue("@at", e.At.ToUnixTimeMilliseconds());
                cmd.Parameters.AddWithValue("@now", now.ToUnixTimeMilliseconds()); cmd.Parameters.AddWithValue("@props", JsonSerializer.Serialize(e.Properties)); cmd.ExecuteNonQuery();
            }
            tx.Commit();
        }
    }
    public bool IsRevoked(string visitor)
    {
        {
            using var db = Open(); using var cmd = db.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM usage_revocations WHERE visitor=@v AND expires_at>@now";
            cmd.Parameters.AddWithValue("@v", visitor); cmd.Parameters.AddWithValue("@now", clock.GetUtcNow().ToUnixTimeMilliseconds());
            return Convert.ToInt64(cmd.ExecuteScalar()) > 0;
        }
    }
    public void Revoke(string visitor)
    {
        {
            using var db = Open(); using var tx = db.BeginTransaction();
            LockVisitor(db, tx, visitor); using var cmd = db.CreateCommand(); cmd.Transaction = tx;
            cmd.CommandText = "DELETE FROM usage_events WHERE visitor=@v; INSERT INTO usage_revocations VALUES (@v,@expires) ON CONFLICT(visitor) DO UPDATE SET expires_at=EXCLUDED.expires_at;";
            cmd.Parameters.AddWithValue("@v", visitor); cmd.Parameters.AddWithValue("@expires", clock.GetUtcNow().AddDays(RetentionDays).ToUnixTimeMilliseconds()); cmd.ExecuteNonQuery(); tx.Commit();
        }
    }
    public void Prune()
    {
        {
            using var db = Open(); using var cmd = db.CreateCommand();
            cmd.CommandText = "DELETE FROM usage_events WHERE received_at < @cutoff; DELETE FROM usage_revocations WHERE expires_at <= @now;";
            cmd.Parameters.AddWithValue("@cutoff", clock.GetUtcNow().AddDays(-RetentionDays).ToUnixTimeMilliseconds()); cmd.Parameters.AddWithValue("@now", clock.GetUtcNow().ToUnixTimeMilliseconds()); cmd.ExecuteNonQuery();
        }
    }
}
