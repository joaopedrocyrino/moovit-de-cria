using System.Net;
using Cria.Infrastructure;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace Cria.Tests;

public class CloudflareOriginSecurityTests
{
    private readonly CloudflareOriginSecurity security = new("172.30.0.2", "https://moovit.joaocyrino.com");

    [Theory]
    [InlineData(null)]
    [InlineData("invalid")]
    [InlineData("127.0.0.1")]
    public void MissingOrUnsafeProxyFailsClosed(string? proxy) =>
        Assert.Throws<InvalidOperationException>(() => new CloudflareOriginSecurity(proxy, "https://moovit.joaocyrino.com"));

    [Theory]
    [InlineData(null)]
    [InlineData("http://moovit.joaocyrino.com")]
    [InlineData("https://moovit.joaocyrino.com/path")]
    [InlineData("https://user:password@moovit.joaocyrino.com")]
    [InlineData("https://localhost")]
    public void InvalidFrontendFailsClosed(string? origin) =>
        Assert.Throws<InvalidOperationException>(() => new CloudflareOriginSecurity("172.30.0.2", origin));

    [Theory]
    [InlineData("172.30.0.2", "203.0.113.42", "https", true)]
    [InlineData("::ffff:172.30.0.2", "2001:db8::1", "https", true)]
    [InlineData("172.30.0.3", "203.0.113.42", "https", false)]
    [InlineData("127.0.0.1", "203.0.113.42", "https", false)]
    [InlineData("172.30.0.2", "", "https", false)]
    [InlineData("172.30.0.2", "203.0.113.42, 203.0.113.43", "https", false)]
    [InlineData("172.30.0.2", "203.0.113.42", "http", false)]
    public async Task OnlyConnectorWithCloudflareHeadersMayReachApi(string peer, string client, string protocol, bool allowed)
    {
        var context = Context(peer, "/api/plans");
        context.Request.Headers["CF-Connecting-IP"] = client;
        context.Request.Headers["X-Forwarded-Proto"] = protocol;
        // Spoofing the general proxy header must not authorize the socket peer.
        context.Request.Headers["X-Forwarded-For"] = "172.30.0.2";
        var called = false;
        await security.Enforce(context, () => { called = true; return Task.CompletedTask; });
        Assert.Equal(allowed, called);
        Assert.Equal(allowed ? 200 : 403, context.Response.StatusCode);
    }

    [Theory]
    [InlineData("127.0.0.1", "/api/health/ready", "GET", true)]
    [InlineData("::1", "/api/health/live", "GET", true)]
    [InlineData("127.0.0.1", "/api/health/ready/extra", "GET", false)]
    [InlineData("127.0.0.1", "/api/health/ready", "POST", false)]
    [InlineData("172.30.0.3", "/api/health/ready", "GET", false)]
    public async Task HealthProbeExceptionIsRestricted(string peer, string path, string method, bool allowed)
    {
        var context = Context(peer, path);
        context.Request.Method = method;
        var called = false;
        await security.Enforce(context, () => { called = true; return Task.CompletedTask; });
        Assert.Equal(allowed, called);
    }

    [Fact]
    public void ForwardingTrustsOnlyConnectorAndUsesCloudflareClientIp()
    {
        var options = new ForwardedHeadersOptions();
        security.ConfigureForwarding(options);
        Assert.Equal("CF-Connecting-IP", options.ForwardedForHeaderName);
        Assert.Equal(1, options.ForwardLimit);
        Assert.Empty(options.KnownIPNetworks);
        Assert.Equal(IPAddress.Parse("172.30.0.2"), Assert.Single(options.KnownProxies));
    }

    private static DefaultHttpContext Context(string peer, string path)
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
        context.Request.Path = path;
        context.Request.Method = "GET";
        context.Response.Body = new MemoryStream();
        return context;
    }
}
