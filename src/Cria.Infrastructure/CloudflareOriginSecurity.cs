using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;

namespace Cria.Infrastructure;

// Check the socket peer before forwarded headers replace RemoteIpAddress.
public sealed class CloudflareOriginSecurity
{
    private readonly IPAddress proxy;
    public string FrontendOrigin { get; }

    public CloudflareOriginSecurity(string? proxyIp, string? frontendOrigin)
    {
        if (!IPAddress.TryParse(proxyIp, out var parsed) || IPAddress.IsLoopback(parsed))
            throw new InvalidOperationException("Production requires Security:TrustedProxyIp for the private Cloudflare Tunnel connector.");
        proxy = Normalize(parsed);
        if (!Uri.TryCreate(frontendOrigin, UriKind.Absolute, out var origin) ||
            origin.Scheme != "https" || origin.IsLoopback || !string.IsNullOrEmpty(origin.UserInfo) ||
            origin.AbsolutePath != "/" || !string.IsNullOrEmpty(origin.Query) || !string.IsNullOrEmpty(origin.Fragment))
            throw new InvalidOperationException("Production requires Security:FrontendOrigin as an HTTPS origin, without a path.");
        FrontendOrigin = origin.GetLeftPart(UriPartial.Authority);
    }

    public void ConfigureForwarding(ForwardedHeadersOptions options)
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.ForwardedForHeaderName = "CF-Connecting-IP";
        options.ForwardLimit = 1;
        options.KnownProxies.Clear();
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Add(proxy);
    }

    public async Task Enforce(HttpContext context, Func<Task> next)
    {
        var peer = context.Connection.RemoteIpAddress;
        // Container-local deployment probes only; never expose other routes via loopback.
        if (peer is not null && IPAddress.IsLoopback(Normalize(peer)) &&
            HttpMethods.IsGet(context.Request.Method) &&
            (context.Request.Path == "/api/health/live" || context.Request.Path == "/api/health/ready"))
        {
            await next();
            return;
        }

        var client = context.Request.Headers["CF-Connecting-IP"];
        var protocol = context.Request.Headers["X-Forwarded-Proto"];
        if (peer is null || !Normalize(peer).Equals(proxy) || client.Count != 1 ||
            !IPAddress.TryParse(client[0], out _) || protocol.Count != 1 || protocol[0] != "https")
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { message = "Acesso permitido somente pelo Cloudflare." });
            return;
        }
        await next();
    }

    private static IPAddress Normalize(IPAddress address) => address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;
}
