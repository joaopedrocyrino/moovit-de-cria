import { randomBytes } from "node:crypto";
import { appendFile, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { openDatabase } from "./lib/postgres.mjs";
import { ROOT, loadEnvironment, isMain, runCli } from "./lib/runtime.mjs";
export async function setupDatabase(environment = loadEnvironment()) {
  const env = { ...environment };
  let additions = "";
  for (const key of ["DATABASE_PASSWORD", "POSTGRES_ADMIN_PASSWORD"]) {
    if (!env[key]) {
      env[key] = randomBytes(32).toString("hex");
      additions += `\n${key}=${env[key]}\n`;
    }
  }
  if (additions) {
    await appendFile(path.join(ROOT, ".env"), additions, { mode: 0o600 });
    await chmod(path.join(ROOT, ".env"), 0o600);
    console.log(
      "Generated local PostgreSQL credentials in the ignored .env file.",
    );
  }
  const child = spawn("docker", ["compose", "up", "-d", "database"], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0)
    throw new Error("PostgreSQL startup failed. Check Docker is running.");
  env.Database__Host = env.Database__Host || "127.0.0.1";
  env.Database__Port = env.Database__Port || env.DATABASE_PORT || "5433";
  env.Database__Password = env.Database__Password || env.DATABASE_PASSWORD;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const db = await openDatabase(env);
      await db.end();
      return env;
    } catch {
      await delay(500);
    }
  }
  throw new Error(
    "PostgreSQL did not become ready. Check docker compose logs database.",
  );
}
if (isMain(import.meta.url)) await runCli(() => setupDatabase());
