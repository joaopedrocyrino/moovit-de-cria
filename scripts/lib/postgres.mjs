import pg from "pg";
import { loadEnvironment } from "./runtime.mjs";
export function databaseOptions(environment = loadEnvironment()) {
  return {
    host: environment.PGHOST || environment.Database__Host || "127.0.0.1",
    port: Number(
      environment.PGPORT ||
        environment.Database__Port ||
        environment.DATABASE_PORT ||
        5433,
    ),
    database: environment.PGDATABASE || environment.Database__Name || "moovit",
    user: environment.PGUSER || environment.Database__Username || "cria",
    password:
      environment.PGPASSWORD ||
      environment.Database__Password ||
      environment.DATABASE_PASSWORD,
    connectionTimeoutMillis: 5000,
  };
}
export async function openDatabase(environment, schema = "app") {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema))
    throw new Error("Invalid database schema.");
  const client = new pg.Client(databaseOptions(environment));
  await client.connect();
  try {
    await client.query(`SET search_path TO "${schema}"`);
    return client;
  } catch (error) {
    await client.end();
    throw error;
  }
}
export async function testDatabase() {
  const env = loadEnvironment();
  const options = {
    ...databaseOptions(env),
    user: env.PGUSER || "postgres",
    password: env.PGPASSWORD || env.POSTGRES_ADMIN_PASSWORD,
  };
  const schema = "test_" + crypto.randomUUID().replaceAll("-", "");
  const db = new pg.Client(options);
  await db.connect();
  await db.query(`CREATE SCHEMA "${schema}"`);
  await db.query(`SET search_path TO "${schema}"`);
  const connectionString = Object.entries({
    Host: options.host,
    Port: options.port,
    Database: options.database,
    Username: options.user,
    Password: options.password,
    SearchPath: schema,
    MaxPoolSize: 20,
  })
    .map(([key, value]) => `${key}="${String(value).replaceAll('"', '""')}"`)
    .join(";");
  return {
    db,
    schema,
    connectionString,
    options,
    async close() {
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.end();
    },
  };
}
