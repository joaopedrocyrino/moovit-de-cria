using Npgsql;
using Microsoft.Extensions.Configuration;

namespace Cria.Infrastructure;

public sealed class ApplicationDatabase : IDisposable
{
    private readonly NpgsqlDataSource source;
    public ApplicationDatabase(IConfiguration config)
    {
        var connection = config["Database:ConnectionString"];
        if (string.IsNullOrWhiteSpace(connection))
        {
            var password = config["Database:Password"];
            if (string.IsNullOrWhiteSpace(password))
                throw new InvalidOperationException("Configure PostgreSQL Database:Password (DATABASE_PASSWORD in Docker). Run npm run db:up for local setup.");
            connection = new NpgsqlConnectionStringBuilder {
                Host=config["Database:Host"] ?? "127.0.0.1", Port=int.Parse(config["Database:Port"] ?? "5433"),
                Database=config["Database:Name"] ?? "moovit", Username=config["Database:Username"] ?? "cria", Password=password,
                SearchPath="app", MaxPoolSize=20, Timeout=5, CommandTimeout=15
            }.ConnectionString;
        }
        source = NpgsqlDataSource.Create(connection);
        try
        {
            using var db=source.OpenConnection();
            using var tx=db.BeginTransaction();
            using var setup=new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtextextended(current_schema(), 0)); CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);",db,tx);
            setup.ExecuteNonQuery();
            using var version=new NpgsqlCommand("SELECT COALESCE(MAX(version),0) FROM schema_migrations",db,tx);
            var schema=Convert.ToInt32(version.ExecuteScalar());
            if(schema>1) throw new InvalidOperationException("Application database is newer than this application.");
            if(schema==0)
            {
                using var resource=typeof(ApplicationDatabase).Assembly.GetManifestResourceStream("Cria.Infrastructure.Data.accounts-v1.sql")!;
                using var reader=new StreamReader(resource);
                using var migration=new NpgsqlCommand(reader.ReadToEnd(),db,tx);
                migration.ExecuteNonQuery();
                using var record=new NpgsqlCommand("INSERT INTO schema_migrations(version) VALUES(1)",db,tx);
                record.ExecuteNonQuery();
            }
            tx.Commit();
        }
        catch { source.Dispose(); throw; }
    }
    public NpgsqlConnection Open() => source.OpenConnection();
    public void Dispose() => source.Dispose();
}
