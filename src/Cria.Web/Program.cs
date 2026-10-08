using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Cria.Domain;
using Cria.Application;
using Cria.Infrastructure;
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddMemoryCache(o => o.ExpirationScanFrequency = TimeSpan.FromMinutes(2));
builder.Services.AddHttpClient("external", c => { c.Timeout = TimeSpan.FromSeconds(15); c.MaxResponseContentBufferSize = 16 * 1024 * 1024; }).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AutomaticDecompression = DecompressionMethods.All });
builder.Services.AddSingleton<ITransitStore, TransitStore>();
builder.Services.AddSingleton<IVehicles, VehicleFeed>();
builder.Services.AddSingleton(_ => LocalPlaces.LoadBundled());
builder.Services.AddSingleton<IPlaces, Places>();
builder.Services.AddSingleton<Planner>();
CloudflareOriginSecurity? originSecurity = null;
if (!builder.Environment.IsDevelopment())
{
    originSecurity = new CloudflareOriginSecurity(builder.Configuration["Security:TrustedProxyIp"], builder.Configuration["Security:FrontendOrigin"]);
    builder.Services.Configure<ForwardedHeadersOptions>(originSecurity.ConfigureForwarding);
    builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
        .WithOrigins(originSecurity.FrontendOrigin).WithMethods("GET", "POST").AllowAnyHeader()));
}
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.OnRejected = (ctx, ct) => { ctx.HttpContext.Response.Headers.RetryAfter = "60"; return new(ctx.HttpContext.Response.WriteAsJsonAsync(new { message = "Muitas requisições. Aguarde um minuto." }, ct)); };
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 100, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddConcurrencyLimiter("plans", p => { p.PermitLimit = 2; p.QueueLimit = 0; });
});
var app = builder.Build();
app.Use(async (context, next) =>
{
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    context.Response.Headers["Permissions-Policy"] = "geolocation=(self), camera=(), microphone=()";
    if (context.Request.Path.StartsWithSegments("/api"))
        context.Response.Headers.CacheControl = "no-store";
    try
    {
        await next();
    }
    catch (AppError e) { context.Response.StatusCode = e.Status; await context.Response.WriteAsJsonAsync(new { message = e.Message }); }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
    catch (Exception) { context.Response.StatusCode = 500; await context.Response.WriteAsJsonAsync(new { message = "Não foi possível completar a operação." }); }
});
if (originSecurity is not null)
{
    app.Use((context, next) => originSecurity.Enforce(context, next));
    app.UseForwardedHeaders();
    app.UseCors();
}
app.UseRateLimiter();
app.MapGet("/api/health/live", () => Results.Ok(new { status = "live" }));
app.MapGet("/api/health/ready", (ITransitStore store) => { store.Get(); return Results.Ok(new { status = "ready" }); });
app.MapGet("/api/config", (ITransitStore store) =>
{
    Network? network = null;
    try
    {
        network = store.Get();
    }
    catch (AppError) { }
    return Results.Ok(new
    {
        city = "Rio de Janeiro",
        coverage = network?.Patterns.Select(p => p.Mode).Distinct().Select(m => m switch { "metro" => "MetrôRio", "brt" => "BRT", _ => "Ônibus municipais" }).ToArray() ?? [],
        dataReady = network is not null,
        importedAt = network?.ImportedAt,
        source = network?.Source,
        tilesUrl = builder.Configuration["Map:TilesUrl"] ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    });
});
app.MapPost("/api/plans", (PlanRequest request, Planner planner, CancellationToken ct) => planner.Plan(request, ct)).RequireRateLimiting("plans");
app.MapPost("/api/places/search", (SearchInput body, IPlaces places, CancellationToken ct) => places.Search(body.Query, body.Bias, ct));
app.MapPost("/api/places/reverse", (Point body, IPlaces places, CancellationToken ct) => places.Reverse(body, ct));
app.MapGet("/api/vehicles", (string line, string? routeId, int? direction, IVehicles feed, CancellationToken ct) =>
{
    if (routeId is not null && routeId.Length is < 1 or > 80 || line.Length is < 1 or > 20 || direction is not (null or 0 or 1))
        throw new AppError(400, "Linha ou sentido inválido.");
    return feed.Get(routeId ?? "", line, direction, ct);
});
app.MapGet("/api/shapes/{id}", (string id, ITransitStore store) => id.Length > 100 ? Results.BadRequest() : Results.Ok(store.Shape(id)));
var webRoot = app.Environment.WebRootPath ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot");
if (app.Environment.IsDevelopment() && File.Exists(Path.Combine(webRoot, "index.html")))
{
    app.UseDefaultFiles();
    app.UseStaticFiles(new StaticFileOptions { OnPrepareResponse = c => c.Context.Response.Headers.CacheControl = c.Context.Request.Path.StartsWithSegments("/assets") ? "public,max-age=31536000,immutable" : "no-cache" });
    app.MapFallbackToFile("index.html");
}
app.Map("/api/{**path}", () => Results.NotFound(new { message = "API não encontrada." }));
await app.RunAsync();
record SearchInput(string Query, Point? Bias = null);
