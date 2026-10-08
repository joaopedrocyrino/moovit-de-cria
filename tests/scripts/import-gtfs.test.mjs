import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  build,
  seconds,
  fareCents,
  installSnapshot,
} from "../../scripts/import-gtfs.mjs";
import { fixture, FILES, SOURCE, writeZip } from "./create-fixture.mjs";

function directory(t) {
  const folder = mkdtempSync(path.join(tmpdir(), "cria-import-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}
function contents(file, table = "patterns") {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db
      .prepare(`SELECT payload FROM ${table}`)
      .all()
      .map((row) => JSON.parse(row.payload));
  } finally {
    db.close();
  }
}

test("GTFS times support after midnight and reject invalid times", () => {
  assert.equal(seconds("25:03:04"), 90184);
  for (const value of ["24:65:00", "48:00:00", "-1:00:00", "abc", "00:00:60"])
    assert.throws(() => seconds(value));
});
test("fare cents are exact, including exponent notation, and reject fractional cents", () => {
  for (const [value, cents] of [
    ["5.00", 500],
    ["1253.42", 125342],
    ["0.29", 29],
    ["5.000", 500],
    ["5e0", 500],
  ])
    assert.equal(fareCents(value), cents);
  for (const value of [
    "0.001",
    "-5.00",
    "NaN",
    "Infinity",
    "900719925474099.00",
  ])
    assert.throws(() => fareCents(value));
});
test("interleaved trips, fares, BRT and shapes are preserved", async (t) => {
  const file = path.join(directory(t), "transit.sqlite");
  await fixture(file);
  const patterns = contents(file);
  assert.equal(patterns.length, 2);
  assert.deepEqual(patterns.map((pattern) => pattern.id).sort(), [
    "47af24d306fbd0f2b9379ffe",
    "e5f1799c6237ebba7efeed47",
  ]);
  assert.equal(patterns[0].fareCents, 500);
  assert.ok(
    patterns.every(
      (pattern) => pattern.stops.length === 2 && pattern.municipal,
    ),
  );
  assert.deepEqual(
    patterns.map((pattern) => pattern.mode),
    ["bus", "brt"],
  );
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM shapes").get().count,
      4,
    );
  } finally {
    db.close();
  }
});
test("invalid imports preserve the existing snapshot and clean temporary files", async (t) => {
  const folder = directory(t),
    file = path.join(folder, "transit.sqlite"),
    bad = path.join(folder, "bad.zip");
  await fixture(file);
  const before = readFileSync(file);
  await writeZip(bad, { "stops.txt": "stop_id\n" });
  await assert.rejects(build(bad, file, "bad"));
  assert.deepEqual(readFileSync(file), before);
  assert.ok(!readdirSync(folder).some((name) => name.startsWith(".transit-")));
});
test("prepared snapshots install without network and preserve bytes and readable permissions", async (t) => {
  const folder = directory(t),
    source = path.join(folder, "prepared.sqlite"),
    output = path.join(folder, "data/transit.sqlite");
  await fixture(source);
  const saved = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Network must not be used");
  };
  try {
    installSnapshot(source, output, SOURCE);
  } finally {
    globalThis.fetch = saved;
  }
  assert.deepEqual(readFileSync(source), readFileSync(output));
  assert.equal(statSync(output).mode & 0o777, 0o644);
});
for (const condition of [
  "corrupt",
  "wrong-source",
  "expired",
  "missing",
  "invalid-validity",
]) {
  test(`${condition} snapshot preserves existing data`, async (t) => {
    const folder = directory(t),
      source = path.join(folder, "prepared.sqlite"),
      output = path.join(folder, "transit.sqlite");
    await fixture(output);
    const before = readFileSync(output);
    if (condition === "corrupt") writeFileSync(source, "not SQLite");
    else if (condition !== "missing") {
      await fixture(source);
      if (["expired", "invalid-validity"].includes(condition)) {
        const db = new DatabaseSync(source);
        try {
          db.prepare("INSERT INTO metadata VALUES('validUntil',?)").run(
            condition === "expired" ? "20000101" : "20269999",
          );
        } finally {
          db.close();
        }
      }
    }
    assert.throws(() =>
      installSnapshot(
        source,
        output,
        condition === "wrong-source"
          ? "https://different.example/feed"
          : SOURCE,
      ),
    );
    assert.deepEqual(readFileSync(output), before);
    assert.ok(
      !readdirSync(folder).some((name) => name.startsWith(".transit-")),
    );
  });
}
test("pattern IDs remain stable for equal patterns and deduplicate windows", async (t) => {
  const file = path.join(directory(t), "transit.sqlite");
  await fixture(file, {
    "trips.txt": FILES["trips.txt"] + "t3,r1,all,Teste B,0,s1\n",
    "stop_times.txt":
      FILES["stop_times.txt"] +
      "t3,0,a,00:00:00,00:00:00\nt3,1,b,00:15:00,00:15:00\n",
    "frequencies.txt":
      FILES["frequencies.txt"] + "t3,00:00:00,47:00:00,300,1\n",
  });
  const first = contents(file);
  assert.equal(first.length, 2);
  assert.equal(first[0].windows.length, 1);
  await fixture(file);
  assert.deepEqual(
    contents(file).map((pattern) => pattern.id),
    first.map((pattern) => pattern.id),
  );
});
test("CSV quoting/BOM, pickup restrictions and calendar exceptions survive the import", async (t) => {
  const file = path.join(directory(t), "transit.sqlite");
  await fixture(file, {
    "stops.txt":
      '\ufeffstop_id,stop_name,stop_lat,stop_lon\na,"Parada, Café",-22.92,-43.21\nb,Parada B,-22.92,-43.24\nc,Parada C,-22.92,-43.28\n',
    "stop_times.txt":
      "trip_id,stop_sequence,stop_id,arrival_time,departure_time,pickup_type,drop_off_type\nt1,0,a,25:00:00,25:00:00,1,0\nt1,1,b,25:15:00,25:15:00,0,1\n",
    "calendar_dates.txt": "service_id,date,exception_type\nall,20261231,2\n",
    "feed_info.txt": "feed_end_date\n20300101\n",
  });
  const pattern = contents(file)[0];
  assert.equal(pattern.stops[0].pickup, false);
  assert.equal(pattern.stops[1].dropoff, false);
  assert.equal(contents(file, "services")[0].exceptions["20261231"], 2);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(
      db.prepare("SELECT name FROM stops WHERE id='a'").get().name,
      "Parada, Café",
    );
  } finally {
    db.close();
  }
});
