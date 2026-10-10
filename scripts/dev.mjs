import { setupDatabase } from "./database.mjs";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  ROOT,
  loadEnvironment,
  dotnetEnvironment,
  isMain,
  runCli,
} from "./lib/runtime.mjs";

export async function main() {
  const { executable, env } = dotnetEnvironment(loadEnvironment());
  if (!existsSync(path.join(ROOT, "node_modules/.bin/vite")))
    throw new Error("Install frontend dependencies first: npm run install:web");
  Object.assign(env, {
    ASPNETCORE_ENVIRONMENT: "Development",
    ASPNETCORE_URLS: "http://127.0.0.1:" + (env.API_PORT || "5193"),
    Transit__Database: path.join(ROOT, ".data/transit.sqlite"),
    Accounts__Keys: path.resolve(
      ROOT,
      env.Accounts__Keys || ".data/accounts/keys",
    ),
    DOTNET_WATCH_SUPPRESS_BROWSER_REFRESH: "1",
    DOTNET_WATCH_SUPPRESS_STATIC_FILE_HANDLING: "1",
  });
  for (const [setting, key] of [
    ["VEHICLES_URL", "Transit__VehiclesUrl"],
    ["AUTOCOMPLETE_URL", "Geocoding__AutocompleteUrl"],
    ["GEOCODING_URL", "Geocoding__BaseUrl"],
    ["GEOCODING_USER_AGENT", "Geocoding__UserAgent"],
  ])
    if (env[setting] !== undefined && env[key] === undefined)
      env[key] = env[setting];
  // Check before starting Vite: dotnet watch stays alive after a bind failure.
  for (const [setting, fallback, host] of [
    ["API_PORT", 5193, "127.0.0.1"],
    ["WEB_PORT", 4193, "0.0.0.0"],
    ["ADMIN_WEB_PORT", 4194, "0.0.0.0"],
  ]) {
    const port = Number(env[setting] || fallback);
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", (error) =>
        reject(
          new Error(
            error.code === "EADDRINUSE"
              ? `Port ${port} is already in use. Stop the previous development run (Ctrl+C), or change ${setting} in .env. Find the listener: lsof -nP -iTCP:${port} -sTCP:LISTEN.`
              : error.message,
          ),
        ),
      );
      server.listen({ port, host }, () => server.close(resolve));
    });
  }
  Object.assign(env, await setupDatabase(env));
  const children = [];
  let stopping = false;
  function stop(signal, status) {
    if (stopping) return;
    stopping = true;
    process.exitCode = status;
    for (const child of children) {
      if (!child.pid) continue;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    const timer = setTimeout(() => {
      for (const child of children) {
        if (!child.pid) continue;
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    }, 8000);
    timer.unref();
  }
  const interrupt = () => stop("SIGTERM", 130);
  const terminate = () => stop("SIGTERM", 143);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    for (const [command, args] of [
      [
        executable,
        ["watch", "--project", "src/Cria.Web", "run", "--no-launch-profile"],
      ],
      ["npm", ["run", "dev:client"]],
      ["npm", ["run", "dev:admin"]],
    ]) {
      const child = spawn(command, args, {
        cwd: ROOT,
        env,
        stdio: "inherit",
        detached: true,
      });
      children.push(child);
      child.once("error", (error) => {
        console.error(error.message);
        stop("SIGTERM", 1);
      });
      child.once("exit", (code, signal) =>
        stop("SIGTERM", code ?? (signal === "SIGINT" ? 130 : 1)),
      );
    }
    await Promise.all(
      children.map(
        (child) => new Promise((resolve) => child.once("close", resolve)),
      ),
    );
  } finally {
    stop("SIGTERM", process.exitCode || 0);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}
if (isMain(import.meta.url)) await runCli(main);
