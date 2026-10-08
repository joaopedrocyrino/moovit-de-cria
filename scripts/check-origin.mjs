import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { isMain, runCli } from "./lib/runtime.mjs";

function docker(args, check = true) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 8 * 1048576,
  });
  if (result.error) throw result.error;
  if (check && result.status !== 0)
    throw new Error("Docker check failed: " + result.stderr);
  return result;
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: { image: { type: "string" } },
  });
  if (!values.image) throw new Error("Provide --image.");
  const fixture = path.resolve(".data/transit.sqlite");
  if (!existsSync(fixture))
    throw new Error("Create the disposable test fixture first.");
  const prefix = "cria-origin-" + randomUUID().replaceAll("-", "").slice(0, 10);
  const [peer, rogue, app] = ["peer", "rogue", "app"].map(
    (suffix) => prefix + "-" + suffix,
  );
  const containers = [];
  docker(["network", "create", "--internal", prefix]);
  try {
    for (const name of [peer, rogue]) {
      docker([
        "run",
        "-d",
        "--name",
        name,
        "--network",
        prefix,
        "--entrypoint",
        "node",
        values.image,
        "-e",
        "setTimeout(() => {}, 600000)",
      ]);
      containers.push(name);
    }
    const ip = JSON.parse(docker(["inspect", peer]).stdout)[0].NetworkSettings
      .Networks[prefix].IPAddress;
    docker([
      "run",
      "-d",
      "--name",
      app,
      "--network",
      prefix,
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--memory",
      "256m",
      "-v",
      path.dirname(fixture) + ":/data:ro",
      "-e",
      "ASPNETCORE_ENVIRONMENT=Production",
      "-e",
      "Security__TrustedProxyIp=" + ip,
      "-e",
      "Security__FrontendOrigin=https://moovit.joaocyrino.com",
      "-e",
      "AllowedHosts=moovit-api.joaocyrino.com;localhost;127.0.0.1",
      values.image,
    ]);
    containers.push(app);
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (
        docker(
          [
            "exec",
            app,
            "node",
            "/app/scripts/health-check.mjs",
            "http://127.0.0.1:8080/api/health/ready",
          ],
          false,
        ).status === 0
      ) {
        ready = true;
        break;
      }
      await delay(500);
    }
    assert.ok(
      ready,
      "Production API failed local readiness: " +
        (ready ? "" : docker(["logs", "--tail", "30", app]).stdout),
    );

    function request(
      container,
      endpoint = "/api/config",
      { client = "203.0.113.7", origin, method = "GET", extra = {} } = {},
    ) {
      const headers = {
        Host: "moovit-api.joaocyrino.com",
        "CF-Connecting-IP": client,
        "X-Forwarded-Proto": "https",
        ...(origin ? { Origin: origin } : {}),
        ...extra,
      };
      const url =
        "http://" +
        (container === app ? "127.0.0.1" : app) +
        ":8080" +
        endpoint;
      // node:http preserves the explicit Host header used by these proxy tests.
      const script = `import http from "node:http";await new Promise((resolve,reject)=>{const r=http.request(${JSON.stringify(url)},{headers:${JSON.stringify(headers)},method:${JSON.stringify(method)},timeout:3000},response=>{response.resume();response.once("end",()=>{console.log(JSON.stringify({status:response.statusCode,origin:response.headers["access-control-allow-origin"]??null}));resolve();});});r.once("error",reject);r.once("timeout",()=>r.destroy(new Error("Request timeout")));r.end();});`;
      return JSON.parse(
        docker(["exec", container, "node", "--input-type=module", "-e", script])
          .stdout,
      );
    }
    assert.deepEqual(
      request(peer, "/api/config", { origin: "https://moovit.joaocyrino.com" }),
      { status: 200, origin: "https://moovit.joaocyrino.com" },
    );
    assert.equal(
      request(peer, "/api/config", { origin: "https://evil.example" }).origin,
      null,
    );
    assert.equal(
      request(peer, "/api/config", {
        method: "OPTIONS",
        origin: "https://moovit.joaocyrino.com",
        extra: {
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      }).status,
      204,
    );
    assert.equal(
      request(rogue, "/api/config", { extra: { "X-Forwarded-For": ip } })
        .status,
      403,
    );
    assert.equal(request(peer, "/api/config", { client: "" }).status, 403);
    assert.equal(
      request(peer, "/api/config", { extra: { "X-Forwarded-Proto": "http" } })
        .status,
      403,
    );
    assert.equal(request(app).status, 403);
    assert.equal(request(app, "/api/health/live").status, 200);
    assert.equal(
      request(peer, "/").status,
      404,
      "Production API must not serve the React site",
    );
    for (let count = 0; count < 100; count++)
      assert.equal(
        request(peer, "/api/config", { client: "203.0.113.99" }).status,
        200,
      );
    assert.equal(
      request(peer, "/api/config", {
        client: "203.0.113.99",
        extra: { "X-Forwarded-For": "198.51.100.4" },
      }).status,
      429,
    );
    assert.equal(
      request(peer, "/api/config", { client: "198.51.100.4" }).status,
      200,
    );
    console.log(
      "Production origin: direct access/spoofing blocked; CORS, local health, API-only image and per-client rate limiting passed.",
    );
  } finally {
    for (const container of containers.reverse())
      docker(["rm", "-f", container], false);
    docker(["network", "rm", prefix], false);
  }
}
if (isMain(import.meta.url)) await runCli(main);
