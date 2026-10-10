using System.Security.Cryptography;
using System.Text.Json;
using Cria.Domain;
using Cria.Infrastructure;
using Microsoft.AspNetCore.DataProtection;

namespace Cria.Web;

public static class AnalyticsEndpoints
{
    private sealed record Identity(string Id, DateTimeOffset Expires);
    private sealed record ConsentInput(bool Accepted);
    private sealed record Batch(UsageEvent[] Events);
    public static void AddAnalytics(this WebApplicationBuilder builder)
    {
        builder.Services.AddSingleton<Analytics>();
        builder.Services.AddHostedService<AnalyticsRetention>();
    }
    public static void MapAnalytics(this WebApplication app)
    {
        var protector = app.Services.GetRequiredService<IDataProtectionProvider>().CreateProtector("Cria.Analytics.v1");
        var secure = !app.Environment.IsDevelopment();
        string Name(string suffix) => (secure ? "__Host-" : "") + "cria-usage-" + suffix;
        Identity? Read(HttpContext context, string suffix)
        {
            try
            {
                if (!context.Request.Cookies.TryGetValue(Name(suffix), out var raw)) return null;
                var identity = JsonSerializer.Deserialize<Identity>(protector.Unprotect(raw));
                return identity is not null && Guid.TryParse(identity.Id, out _) && identity.Expires > DateTimeOffset.UtcNow ? identity : null;
            }
            catch (Exception e) when (e is CryptographicException or JsonException) { return null; }
        }
        void Write(HttpContext context, string suffix, Identity identity) => context.Response.Cookies.Append(Name(suffix), protector.Protect(JsonSerializer.Serialize(identity)), new CookieOptions
        { HttpOnly = true, Secure = secure || context.Request.IsHttps, SameSite = SameSiteMode.Lax, Path = "/", Expires = identity.Expires, IsEssential = false });
        var group = app.MapGroup("/api/analytics");
        group.MapGet("/consent", (HttpContext context, Analytics analytics) => Results.Ok(new { accepted = Read(context, "visitor") is { } identity && !analytics.IsRevoked(Analytics.Hash(identity.Id)) }));
        group.MapPost("/consent", (ConsentInput input, HttpContext context, Analytics analytics) =>
        {
            var old = Read(context, "visitor");
            if (input.Accepted)
            {
                Write(context, "visitor", old is not null && !analytics.IsRevoked(Analytics.Hash(old.Id)) ? old : new(Guid.NewGuid().ToString(), DateTimeOffset.UtcNow.AddDays(Analytics.RetentionDays)));
                Write(context, "session", new(Guid.NewGuid().ToString(), DateTimeOffset.UtcNow.AddMinutes(30)));
            }
            else
            {
                if (old is not null) analytics.Revoke(Analytics.Hash(old.Id));
                foreach (var suffix in new[] { "visitor", "session" }) if (context.Request.Cookies.ContainsKey(Name(suffix))) context.Response.Cookies.Delete(Name(suffix), new CookieOptions { Path = "/", Secure = secure || context.Request.IsHttps, HttpOnly = true, SameSite = SameSiteMode.Lax });
            }
            return Results.Ok(new { accepted = input.Accepted });
        }).AddEndpointFilter<AccountEndpoints.CsrfFilter>();
        group.MapPost("/events", (Batch input, HttpContext context, Analytics analytics) =>
        {
            // JSON + exact Origin check keeps an attacker from writing events for another browser. No public reports.
            var expected = app.Environment.IsDevelopment() ? context.Request.Scheme + "://" + context.Request.Host : app.Configuration["Security:FrontendOrigin"];
            var origin = context.Request.Headers.Origin.ToString();
            var devClient = app.Environment.IsDevelopment() && (origin is "http://localhost:4193" or "http://127.0.0.1:4193" || origin == app.Configuration["Security:FrontendOrigin"]);
            if (origin != expected && !devClient) throw new AppError(403, "Origem não permitida.");
            var visitor = Read(context, "visitor") ?? throw new AppError(403, "Consentimento necessário.");
            var session = Read(context, "session") ?? new Identity(Guid.NewGuid().ToString(), DateTimeOffset.UtcNow.AddMinutes(30));
            analytics.Record(Analytics.Hash(visitor.Id), Analytics.Hash(session.Id), input.Events);
            Write(context, "session", session with { Expires = DateTimeOffset.UtcNow.AddMinutes(30) });
            return Results.NoContent();
        }).RequireRateLimiting("analytics");
    }
}
internal sealed class AnalyticsRetention(Analytics analytics, ILogger<AnalyticsRetention> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                try { analytics.Prune(); }
                catch (Exception e) { logger.LogError(e, "Analytics retention failed"); }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
