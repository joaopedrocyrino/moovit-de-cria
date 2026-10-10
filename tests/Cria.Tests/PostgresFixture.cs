using Cria.Infrastructure;
using Microsoft.Extensions.Configuration;
using Npgsql;
namespace Cria.Tests;
internal sealed class PostgresFixture : IDisposable
{
    private readonly string connection;
    private readonly string schema="test_"+Guid.NewGuid().ToString("N");
    public ApplicationDatabase Database { get; }
    public PostgresFixture()
    {
        connection=Environment.GetEnvironmentVariable("TEST_DATABASE_CONNECTION_STRING") ?? new NpgsqlConnectionStringBuilder {
            Host="127.0.0.1",Port=int.Parse(Environment.GetEnvironmentVariable("DATABASE_PORT")??"5433"),Database="moovit",Username="postgres",
            Password=Environment.GetEnvironmentVariable("POSTGRES_ADMIN_PASSWORD")??throw new InvalidOperationException("Run npm run db:up, then npm test.")
        }.ConnectionString;
        using var db=new NpgsqlConnection(connection);db.Open();
        using var command=new NpgsqlCommand($"CREATE SCHEMA {schema}",db);command.ExecuteNonQuery();
        var scoped=new NpgsqlConnectionStringBuilder(connection){SearchPath=schema};
        Database=new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"Database:ConnectionString",scoped.ConnectionString}}).Build());
    }
    public void Dispose() {
        Database.Dispose();using var db=new NpgsqlConnection(connection);db.Open();
        using var command=new NpgsqlCommand($"DROP SCHEMA {schema} CASCADE",db);command.ExecuteNonQuery();
    }
}
