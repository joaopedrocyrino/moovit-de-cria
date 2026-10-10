import { test } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "../../scripts/lib/postgres.mjs";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
test("private report aggregates usage and first-attempt funnel without exporting identities or changing the DB", async () => {
  const postgres = await testDatabase();
  const db = postgres.db;
  try {
    await db.query(
      "CREATE TABLE usage_events(id TEXT,visitor TEXT,session TEXT,name TEXT,occurred_at BIGINT,received_at BIGINT,properties JSONB)",
    );
    const now = Date.now() - 10000;
    let id = 0;
    for (const [session, found] of [
      ["PRIVATE_COMPLETE_SESSION", true],
      ["PRIVATE_EMPTY_SESSION", false],
    ]) {
      for (const [name, props] of [
        ["app_open", { browser: "safari", os: "ios", release: "0.1.0" }],
        ["route_search", {}],
        ["route_result", { count: found ? 2 : 0 }],
        ...(found
          ? [
              ["route_selected", { legs: 2 }],
              ["journey_step", { step: "board" }],
            ]
          : []),
      ])
        await db.query(
          "INSERT INTO usage_events VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
          [
            String(id++),
            "PRIVATE_VISITOR",
            session,
            name,
            now + id,
            now,
            JSON.stringify(props),
          ],
        );
    }
    const before = (await db.query("SELECT count(*) FROM usage_events")).rows[0]
      .count;
    const run = await promisify(execFile)(
      process.execPath,
      [
        "scripts/analytics-report.mjs",
        "--schema",
        postgres.schema,
        "--days",
        "30",
      ],
      {
        env: {
          ...process.env,
          PGUSER: postgres.options.user,
          PGPASSWORD: postgres.options.password,
          PGPORT: String(postgres.options.port),
          PGDATABASE: postgres.options.database,
          PGHOST: postgres.options.host,
        },
      },
    );
    const report = JSON.parse(run.stdout);
    assert.deepEqual(report.funnel, [
      { opened: 2, searched: 2, found: 1, selected: 1, boarded: 1 },
    ]);
    assert.equal(report.overview[0].browsers, 1);
    assert.equal(report.browsers[0].os, "ios");
    assert.ok(!run.stdout.includes("PRIVATE_"));
    assert.equal(
      (await db.query("SELECT count(*) FROM usage_events")).rows[0].count,
      before,
    );
  } finally {
    await postgres.close();
  }
});
