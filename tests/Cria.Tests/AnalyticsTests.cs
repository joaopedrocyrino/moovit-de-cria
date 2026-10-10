using System.Text.Json;
using Cria.Domain;
using Cria.Infrastructure;
using Npgsql;
using Microsoft.Extensions.Configuration;
namespace Cria.Tests;
public sealed class AnalyticsTests : IDisposable
{
    private readonly PostgresFixture fixture = new();
    private readonly Clock clock = new();
    private readonly Analytics analytics;
    public AnalyticsTests() { analytics = new(fixture.Database,clock); }
    private UsageEvent Event(string name = "theme_change", string props = "{\"theme\":\"dark\"}") => new(Guid.NewGuid().ToString(),name,clock.GetUtcNow(),JsonSerializer.Deserialize<Dictionary<string,JsonElement>>(props)!);
    private long Count() { using var db = fixture.Database.Open(); using var cmd = db.CreateCommand(); cmd.CommandText="SELECT COUNT(*) FROM usage_events"; return (long)cmd.ExecuteScalar()!; }
    [Fact] public void DuplicatesAreIdempotentAndEventsSurviveRestart() { var e=Event(); analytics.Record("visitor","session",[e,e]); Assert.Equal(1,Count()); var restarted=new Analytics(fixture.Database,clock); restarted.Record("visitor","session",[e]); Assert.Equal(1,Count()); }
    [Theory]
    [InlineData("{\"email\":\"joao@example.test\"}")]
    [InlineData("{\"lat\":-22.9}")]
    [InlineData("{\"query\":\"my home\"}")]
    [InlineData("{\"theme\":\"my password\"}")]
    [InlineData("{\"theme\":123}")]
    public void UnexpectedOrSensitiveFieldsAreRejected(string props) { Assert.Equal(400,Assert.Throws<AppError>(()=>analytics.Record("v","s",[Event(props:props)])).Status); Assert.Equal(0,Count()); }
    [Fact] public void InvalidBatchDoesNotPartiallyPersist() { Assert.Throws<AppError>(()=>analytics.Record("v","s",[Event(),Event("unrecognized")])); Assert.Equal(0,Count()); }
    [Fact] public void InvalidTimesAndLargeBatchesAreRejected() { Assert.Throws<AppError>(()=>analytics.Record("v","s",[Event() with { At=clock.GetUtcNow().AddDays(-2) }])); Assert.Throws<AppError>(()=>analytics.Record("v","s",Enumerable.Range(0,21).Select(_=>Event()).ToArray())); }
    [Fact] public void RevocationDeletesAllVisitorSessionsAndBlocksInflightReplay() { analytics.Record("v","s1",[Event()]); analytics.Record("v","s2",[Event()]); analytics.Record("other","s3",[Event()]); analytics.Revoke("v"); Assert.Equal(1,Count()); Assert.Equal(403,Assert.Throws<AppError>(()=>analytics.Record("v","s1",[Event()])).Status); }
    [Fact] public void RetentionPrunesEvenWithoutNewEvents() { analytics.Record("v","s",[Event()]); clock.Now=clock.Now.AddDays(91); analytics.Prune(); Assert.Equal(0,Count()); }
    [Fact] public void HashDoesNotRetainCookieIdentifier() { var id=Guid.NewGuid().ToString(); Assert.Equal(64,Analytics.Hash(id).Length); Assert.DoesNotContain(id,Analytics.Hash(id)); }
    public void Dispose() => fixture.Dispose();
    private sealed class Clock : TimeProvider { public DateTimeOffset Now = DateTimeOffset.UtcNow; public override DateTimeOffset GetUtcNow()=>Now; }
}
