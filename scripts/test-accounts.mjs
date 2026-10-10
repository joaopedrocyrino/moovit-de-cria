// Isolated real HTTP tests. Never opens the development/production account database.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { fixture } from "../tests/scripts/create-fixture.mjs";
import { ROOT, loadEnvironment, dotnetEnvironment } from "./lib/runtime.mjs";

import { testDatabase } from "./lib/postgres.mjs";
const postgres = await testDatabase();
const directory = await mkdtemp(path.join(tmpdir(), "cria-account-http-"));
const dll = path.join(
  ROOT,
  "src/Cria.Web/bin",
  process.env.DOTNET_CONFIGURATION || "Debug",
  "net10.0/Cria.Web.dll",
);
let child,
  logs = "";
const socket = createServer();
try {
  await access(dll);
  await fixture(path.join(directory, "transit.sqlite"));
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const base = "http://127.0.0.1:" + socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const { executable, env } = dotnetEnvironment(loadEnvironment());
  const argumentsForApi = [dll, "--urls", base];
  if (process.env.ACCOUNTS_BROWSER === "1") {
    await access(path.join(ROOT, "frontend/client/dist/index.html"));
    argumentsForApi.push("--webroot", path.join(ROOT, "frontend/client/dist"));
  }
  async function start() {
    logs = "";
    child = spawn(executable, argumentsForApi, {
      cwd: ROOT,
      env: {
        ...env,
        ASPNETCORE_ENVIRONMENT: "Development",
        Transit__Database: path.join(directory, "transit.sqlite"),
        Database__ConnectionString: postgres.connectionString,
        Accounts__Keys: path.join(directory, "accounts/keys"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (data) => {
      logs = (logs + data).slice(-8000);
    });
    child.stderr.on("data", (data) => {
      logs = (logs + data).slice(-8000);
    });
    let failure;
    child.on("error", (error) => {
      failure = error;
    });
    for (let i = 0; i < 100; i++) {
      if (failure || child.exitCode !== null)
        throw failure ?? new Error("Test API exited: " + logs);
      try {
        if (
          (
            await fetch(base + "/api/health/ready", {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        )
          return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Test API did not become ready: " + logs);
  }
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit");
      child.kill("SIGTERM");
      await exit;
    }
  }
  function client() {
    const jar = new Map();
    let csrf;
    return {
      async request(
        url,
        { method = "GET", body, status = 200, token = true } = {},
      ) {
        const response = await fetch(base + "/api" + url, {
          method,
          headers: {
            Origin: base,
            ...(jar.size
              ? {
                  cookie: [...jar]
                    .map(([key, value]) => key + "=" + value)
                    .join("; "),
                }
              : {}),
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
            ...(method === "GET" || !token || !csrf
              ? {}
              : { "x-csrf-token": csrf }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(5000),
        });
        for (const cookie of response.headers.getSetCookie()) {
          const [pair] = cookie.split(";");
          const equals = pair.indexOf("=");
          const key = pair.slice(0, equals),
            value = pair.slice(equals + 1);
          if (value) jar.set(key, value);
          else jar.delete(key);
          assert.match(cookie, /httponly/i);
        }
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        assert.equal(
          response.status,
          status,
          `${method} ${url}: ${JSON.stringify(data)}`,
        );
        assert.match(response.headers.get("cache-control"), /\bno-store\b/);
        if (data?.csrfToken) csrf = data.csrfToken;
        return data;
      },
      copy() {
        const copy = client();
        for (const [key, value] of jar) copy.jar.set(key, value);
        return copy;
      },
      jar,
    };
  }
  await start();
  const usage = client();
  await usage.request("/auth/session");
  const event = {
    id: crypto.randomUUID(),
    name: "theme_change",
    at: new Date().toISOString(),
    properties: { theme: "dark" },
  };
  assert.equal((await usage.request("/analytics/consent")).accepted, false);
  await usage.request("/analytics/events", {
    method: "POST",
    body: { events: [event] },
    status: 403,
  });
  await usage.request("/analytics/consent", {
    method: "POST",
    body: { accepted: true },
    token: false,
    status: 403,
  });
  await usage.request("/analytics/consent", {
    method: "POST",
    body: { accepted: true },
  });
  assert.equal((await usage.request("/analytics/consent")).accepted, true);
  const usageReplay = usage.copy();
  await usage.request("/analytics/events", {
    method: "POST",
    body: { events: [event, event] },
    status: 204,
  });
  await usage.request("/analytics/events", {
    method: "POST",
    body: {
      events: [{ ...event, properties: { email: "secret@example.test" } }],
    },
    status: 400,
  });
  async function eventCount() {
    return Number(
      (await postgres.db.query("SELECT count(*) AS n FROM usage_events"))
        .rows[0].n,
    );
  }
  assert.equal(await eventCount(), 1);
  await usage.request("/analytics/consent", {
    method: "POST",
    body: { accepted: false },
  });
  assert.equal(await eventCount(), 0);
  assert.equal((await usage.request("/analytics/consent")).accepted, false);
  assert.equal(
    (await usageReplay.request("/analytics/consent")).accepted,
    false,
  );
  await usageReplay.request("/analytics/events", {
    method: "POST",
    body: { events: [event] },
    status: 403,
  });
  await usage.request("/analytics/consent", {
    method: "POST",
    body: { accepted: true },
  });
  await usage.request("/analytics/events", {
    method: "POST",
    body: { events: [event] },
    status: 204,
  });
  assert.equal(await eventCount(), 1);
  await stop();
  await start();
  await usage.request("/analytics/events", {
    method: "POST",
    body: { events: [event] },
    status: 204,
  });
  assert.equal(await eventCount(), 1);
  console.log(
    "Analytics HTTP: consent, CSRF, strict schema, deduplication, withdrawal deletion/replay blocking and restart persistence passed.",
  );
  await stop();
  await start();
  const a = client(),
    b = client();
  assert.equal((await a.request("/auth/session")).user, null);
  await a.request("/account/saved", { status: 401 });
  const input = {
    name: "João",
    email: "joao@example.test",
    password: "a long account test phrase",
  };
  await a.request("/auth/register", {
    method: "POST",
    body: input,
    token: false,
    status: 403,
  });
  const session = await a.request("/auth/register", {
    method: "POST",
    body: input,
  });
  assert.equal(session.user.name, "João");
  const replay = a.copy();
  await a.request("/auth/register", {
    method: "POST",
    body: input,
    status: 409,
  });
  await b.request("/auth/session");
  await b.request("/auth/register", {
    method: "POST",
    body: { ...input, email: "other@example.test" },
  });
  const home = {
    alias: "Casa",
    address: "Rua A, Rio",
    point: { lat: -22.9201234, lon: -43.2102345 },
  };
  const address = await a.request("/account/addresses", {
    method: "POST",
    body: home,
  });
  await a.request("/account/addresses", {
    method: "POST",
    body: { ...home, alias: "cása" },
    status: 409,
  });
  await a.request("/account/addresses", {
    method: "POST",
    body: { ...home, point: { lat: 0, lon: 0 } },
    status: 400,
  });
  assert.deepEqual((await b.request("/account/saved")).addresses, []);
  await b.request("/account/addresses/" + address.id, {
    method: "PUT",
    body: home,
    status: 404,
  });
  await b.request("/account/addresses/" + address.id, {
    method: "DELETE",
    status: 404,
  });
  const catalog = await a.request("/lines?query=104");
  const line = await a.request("/account/lines", {
    method: "POST",
    body: catalog[0],
  });
  assert.equal(
    (await a.request("/account/lines", { method: "POST", body: catalog[0] }))
      .id,
    line.id,
  );
  await a.request("/account/lines", {
    method: "POST",
    body: { mode: "bus", line: "imaginary" },
    status: 400,
  });
  await b.request("/account/lines/" + line.id, {
    method: "DELETE",
    status: 404,
  });
  await a.request("/account/addresses/" + address.id, {
    method: "PUT",
    body: { ...home, alias: "Lar" },
  });
  const second = client();
  await second.request("/auth/session");
  await second.request("/auth/login", {
    method: "POST",
    body: { email: "JOAO@example.test", password: input.password },
  });
  const oldSecond = second.copy();
  await a.request("/account/password", {
    method: "POST",
    body: {
      password: input.password,
      newPassword: "a different account phrase",
    },
  });
  await second.request("/account/saved", { status: 401 });
  await replay.request("/account/saved", { status: 401 });
  await oldSecond.request("/auth/session");
  assert.equal((await oldSecond.request("/auth/session")).user, null);
  await second.request("/auth/session");
  await second.request("/auth/login", {
    method: "POST",
    body: { email: input.email, password: input.password },
    status: 401,
  });
  await second.request("/auth/login", {
    method: "POST",
    body: { email: input.email, password: "a different account phrase" },
  });
  const logoutReplay = second.copy();
  await second.request("/auth/logout", { method: "POST" });
  await logoutReplay.request("/account/saved", { status: 401 });
  await stop();
  await start();
  assert.equal((await a.request("/auth/session")).user.id, session.user.id);
  const persisted = await a.request("/account/saved");
  assert.equal(persisted.addresses[0].point.lat, home.point.lat);
  assert.equal(persisted.addresses[0].point.lon, home.point.lon);
  assert.equal(persisted.addresses[0].alias, "Lar");
  assert.equal(persisted.lines[0].id, line.id);
  await a.request("/account", {
    method: "DELETE",
    body: { password: "a different account phrase" },
  });
  await a.request("/account/saved", { status: 401 });
  await b.request("/auth/session");
  await b.request("/account", {
    method: "DELETE",
    body: { password: input.password },
  });
  console.log(
    "Accounts HTTP: CSRF, ownership, cookie revocation, password changes, deletion and restart persistence passed.",
  );
  if (process.env.ACCOUNTS_BROWSER === "1") {
    await stop();
    await start();
    for (const script of [
      "scripts/browser.mjs",
      "scripts/browser-transit.mjs",
      "scripts/browser-accounts.mjs",
      "scripts/browser-preferences.mjs",
    ]) {
      const browser = spawn(process.execPath, [script], {
        cwd: ROOT,
        env: {
          ...process.env,
          BASE_URL: base,
          API_TEST_URL: base,
          API_ORIGIN: "",
        },
        stdio: "inherit",
      });
      assert.equal(
        (await once(browser, "exit"))[0],
        0,
        "Browser checks failed: " + script,
      );
      await stop();
      await start();
    }
  }
  await stop();
} catch (error) {
  if (logs) console.error(logs);
  throw error;
} finally {
  socket.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exit = once(child, "exit");
    child.kill("SIGTERM");
    await exit;
  }
  await postgres.close();
  await rm(directory, { recursive: true, force: true });
}
