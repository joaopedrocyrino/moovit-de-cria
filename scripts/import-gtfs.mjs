import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  createWriteStream,
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { parseArgs, promisify } from "node:util";
import yauzl from "yauzl";
import { parse } from "csv-parse";
import { ROOT, isMain, loadEnvironment, runCli } from "./lib/runtime.mjs";

const MIB = 1048576;
const MAX_UNCOMPRESSED = 750 * MIB;
const progress = (message) => console.log("GTFS: " + message);

function temporarySnapshot(output) {
  mkdirSync(path.dirname(output), { recursive: true });
  const file = path.join(
    path.dirname(output),
    `.transit-${randomUUID()}.sqlite`,
  );
  closeSync(openSync(file, "wx", 0o600));
  return file;
}

function publish(file, output) {
  const fd = openSync(file, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(file, 0o644);
  renameSync(file, output);
}

function dateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type).value)
    .join("");
}

function validDate(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const date = new Date(iso + "T00:00:00Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso
  );
}

export function installSnapshot(source, output, expectedSource) {
  source = path.resolve(source);
  output = path.resolve(output);
  if (!existsSync(source) || !statSync(source).isFile())
    throw new Error(
      "Prepared GTFS snapshot missing. Build the release image with PREPARE_GTFS=1.",
    );
  if (statSync(source).size > MAX_UNCOMPRESSED)
    throw new Error("Prepared snapshot exceeds 750 MiB");
  const temporary = temporarySnapshot(output);
  let db;
  try {
    progress(
      "Installing prepared timetable snapshot (no feed download or CSV processing)",
    );
    copyFileSync(source, temporary);
    db = new DatabaseSync(temporary, { readOnly: true });
    db.exec("PRAGMA cache_size=-2000");
    const integrity = db.prepare("PRAGMA quick_check").all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok")
      throw new Error("Prepared snapshot failed SQLite integrity validation");
    for (const table of ["stops", "patterns", "services", "shapes", "metadata"])
      db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
    if (
      !db.prepare("SELECT 1 FROM stops LIMIT 1").get() ||
      !db.prepare("SELECT 1 FROM patterns LIMIT 1").get()
    )
      throw new Error("Prepared snapshot has no usable stops or patterns");
    const metadata = Object.fromEntries(
      db
        .prepare("SELECT key,value FROM metadata")
        .all()
        .map((row) => [row.key, row.value]),
    );
    if (metadata.source !== expectedSource)
      throw new Error(
        "Prepared snapshot source differs from GTFS_URL. Set the public GTFS_URL repository variable to match the droplet setting and build a new release.",
      );
    if (
      metadata.validUntil &&
      (!validDate(metadata.validUntil) || metadata.validUntil < dateKey())
    )
      throw new Error(
        "Prepared timetable snapshot has expired or invalid validity; build a new release",
      );
    db.close();
    db = undefined;
    publish(temporary, output);
    progress(
      `Prepared snapshot installed atomically: ${Math.floor(statSync(output).size / MIB)} MiB`,
    );
  } finally {
    db?.close();
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function seconds(value) {
  if (!/^\d{1,2}:\d{2}:\d{2}$/.test(value || ""))
    throw new Error("Invalid GTFS time");
  const [hour, minute, second] = value.split(":").map(Number);
  if (hour > 47 || minute > 59 || second > 59)
    throw new Error("Invalid GTFS time");
  return hour * 3600 + minute * 60 + second;
}

export function fareCents(value) {
  // Convert decimal text exactly, including exponent notation; never multiply a float.
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(value || "");
  if (!match) throw new Error("Invalid fare cents");
  const [, sign, whole, fraction = "", exponent = "0"] = match;
  const power = Number(exponent) + 2 - fraction.length;
  if (!Number.isSafeInteger(power) || Math.abs(power) > 100)
    throw new Error("Invalid fare cents");
  let cents = BigInt(whole + fraction);
  if (power < 0) {
    const divisor = 10n ** BigInt(-power);
    if (cents % divisor !== 0n) throw new Error("Invalid fare cents");
    cents /= divisor;
  } else cents *= 10n ** BigInt(power);
  if ((sign === "-" && cents !== 0n) || cents > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Invalid fare cents");
  return Number(cents);
}

function integer(value) {
  if (!/^[+-]?\d+$/.test(value || "") || !Number.isSafeInteger(Number(value)))
    throw new Error("Invalid GTFS integer");
  return Number(value);
}

// Match Python's sorted JSON encoding so pattern IDs remain stable across this migration.
function patternIdentity(value) {
  if (Array.isArray(value))
    return "[" + value.map(patternIdentity).join(", ") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => patternIdentity(key) + ": " + patternIdentity(value[key]))
        .join(", ") +
      "}"
    );
  return JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    (character) =>
      "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

async function openArchive(file) {
  const zip = await promisify(yauzl.open)(file, {
    lazyEntries: true,
    autoClose: false,
    validateEntrySizes: true,
  });
  const entries = new Map();
  try {
    await new Promise((resolve, reject) => {
      let size = 0;
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry) => {
        size += entry.uncompressedSize;
        if (size > MAX_UNCOMPRESSED) {
          reject(new Error("Uncompressed feed exceeds 750 MiB"));
          return;
        }
        const name = path.posix.basename(entry.fileName);
        if (!entry.fileName.endsWith("/") && !entries.has(name))
          entries.set(name, entry);
        zip.readEntry();
      });
      zip.readEntry();
    });
    return { zip, entries };
  } catch (error) {
    zip.close();
    throw error;
  }
}

async function* rows(archive, name, required = false) {
  const entry = archive.entries.get(name);
  if (!entry) {
    if (required) throw new Error("Missing " + name);
    return;
  }
  progress("Reading " + name);
  const input = await promisify(archive.zip.openReadStream.bind(archive.zip))(
    entry,
  );
  const parser = parse({
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    max_record_size: MIB,
  });
  const reading = pipeline(input, parser);
  // Attach immediately; parser iteration reports the same stream error below.
  reading.catch(() => {});
  let count = 0,
    last = Date.now();
  try {
    for await (const row of parser) {
      count++;
      if (count % 10000 === 0 && Date.now() - last >= 15000) {
        progress(`${name}: ${count.toLocaleString("en-US")} rows read`);
        last = Date.now();
      }
      yield row;
    }
    await reading;
    progress(`${name}: ${count.toLocaleString("en-US")} rows read; complete`);
  } finally {
    input.destroy();
    parser.destroy();
    await reading.catch(() => {});
  }
}

export async function build(archiveFile, output, source) {
  progress("Preparing SQLite snapshot");
  output = path.resolve(output);
  const temporary = temporarySnapshot(output);
  let db, archive;
  try {
    db = new DatabaseSync(temporary);
    db.exec(`PRAGMA journal_mode=OFF; PRAGMA cache_size=-16000; PRAGMA temp_store=FILE;
      CREATE TABLE stops(id TEXT PRIMARY KEY,name TEXT,lat REAL,lon REAL);
      CREATE TABLE patterns(id TEXT PRIMARY KEY,payload TEXT);
      CREATE TABLE services(id TEXT PRIMARY KEY,payload TEXT);
      CREATE TABLE shapes(id TEXT,seq INTEGER,lat REAL,lon REAL);
      CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE raw_times(trip TEXT,seq INTEGER,stop TEXT,arrival INTEGER,departure INTEGER,pickup INTEGER,dropoff INTEGER);
      BEGIN;`);
    archive = await openArchive(archiveFile);
    const stops = new Set();
    const insertStop = db.prepare(
      "INSERT OR REPLACE INTO stops VALUES(?,?,?,?)",
    );
    for await (const row of rows(archive, "stops.txt", true)) {
      const lat = Number(row.stop_lat),
        lon = Number(row.stop_lon);
      if (lat >= -23.12 && lat <= -22.72 && lon >= -43.85 && lon <= -43.08) {
        insertStop.run(row.stop_id, row.stop_name, lat, lon);
        stops.add(row.stop_id);
      }
    }
    const routes = new Map(),
      trips = new Map();
    for await (const row of rows(archive, "routes.txt", true))
      routes.set(row.route_id, row);
    for await (const row of rows(archive, "trips.txt", true))
      trips.set(row.trip_id, row);
    const prices = new Map(),
      fares = new Map();
    for await (const row of rows(archive, "fare_attributes.txt"))
      if (row.currency_type === "BRL")
        prices.set(row.fare_id, fareCents(row.price));
    for await (const row of rows(archive, "fare_rules.txt")) {
      if (row.route_id && prices.has(row.fare_id)) {
        if (!fares.has(row.route_id)) fares.set(row.route_id, new Set());
        fares.get(row.route_id).add(prices.get(row.fare_id));
      }
    }
    const frequencies = new Map();
    for await (const row of rows(archive, "frequencies.txt")) {
      if (!frequencies.has(row.trip_id)) frequencies.set(row.trip_id, []);
      frequencies
        .get(row.trip_id)
        .push([
          seconds(row.start_time),
          seconds(row.end_time),
          integer(row.headway_secs),
          row.exact_times === "1",
        ]);
    }
    const services = new Map();
    for await (const row of rows(archive, "calendar.txt")) {
      services.set(row.service_id, {
        id: row.service_id,
        start: row.start_date,
        end: row.end_date,
        days: [
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday",
        ].map((day) => integer(row[day])),
        exceptions: {},
      });
    }
    for await (const row of rows(archive, "calendar_dates.txt")) {
      if (!services.has(row.service_id))
        services.set(row.service_id, {
          id: row.service_id,
          start: "00000000",
          end: "00000000",
          days: [0, 0, 0, 0, 0, 0, 0],
          exceptions: {},
        });
      services.get(row.service_id).exceptions[row.date] = integer(
        row.exception_type,
      );
    }
    const insertTime = db.prepare(
      "INSERT INTO raw_times VALUES(?,?,?,?,?,?,?)",
    );
    for await (const row of rows(archive, "stop_times.txt", true)) {
      if (
        !trips.has(row.trip_id) ||
        !stops.has(row.stop_id) ||
        !row.arrival_time ||
        !row.departure_time
      )
        continue;
      insertTime.run(
        row.trip_id,
        integer(row.stop_sequence),
        row.stop_id,
        seconds(row.arrival_time),
        seconds(row.departure_time),
        !row.pickup_type || row.pickup_type === "0" ? 1 : 0,
        !row.drop_off_type || row.drop_off_type === "0" ? 1 : 0,
      );
    }
    progress("Indexing stop times");
    db.exec("CREATE INDEX raw_order ON raw_times(trip,seq)");
    const patterns = new Map();
    let current,
      times = [];
    function flush() {
      if (times.length < 2) return;
      const trip = trips.get(current),
        route = routes.get(trip.route_id);
      if (!route) return;
      const base = times[0].departure;
      if (
        times.some(
          (row, index) => index > 0 && row.arrival < times[index - 1].departure,
        )
      )
        return;
      const sequence = times.map((row) => ({
        stopId: row.stop,
        arrival: row.arrival - base,
        departure: row.departure - base,
        pickup: !!row.pickup,
        dropoff: !!row.dropoff,
      }));
      const shape = trip.shape_id || "",
        direction = integer(trip.direction_id || "0");
      const key = createHash("sha256")
        .update(
          patternIdentity([
            trip.route_id,
            shape,
            direction,
            trip.trip_headsign || "",
            sequence,
          ]),
        )
        .digest("hex")
        .slice(0, 24);
      const mode =
        route.agency_id === "20001"
          ? "brt"
          : { 0: "tram", 1: "metro", 2: "rail", 4: "ferry" }[
              route.route_type
            ] || "bus";
      const amounts = fares.get(trip.route_id);
      const fare = amounts?.size === 1 ? amounts.values().next().value : null;
      if (!patterns.has(key))
        patterns.set(key, {
          id: key,
          routeId: trip.route_id,
          line: route.route_short_name,
          name: route.route_long_name,
          mode,
          direction,
          headsign: trip.trip_headsign || route.route_long_name,
          shapeId: shape,
          color: route.route_color || "145A49",
          fareCents: fare,
          municipal:
            ["22002", "22003", "22004", "22005", "20001"].includes(
              route.agency_id,
            ) && fare === 500,
          stops: sequence,
          windows: [],
        });
      const pattern = patterns.get(key);
      for (const [start, end, headway, exact] of frequencies.get(current) || [
        [base, base + 1, 0, true],
      ]) {
        if (end <= start || headway < 0)
          throw new Error("Invalid frequency window");
        const window = {
          serviceId: trip.service_id,
          start,
          end,
          headway,
          exact,
        };
        if (
          !pattern.windows.some((existing) =>
            Object.keys(window).every((key) => existing[key] === window[key]),
          )
        )
          pattern.windows.push(window);
      }
    }
    progress("Building timetable patterns");
    let processed = 0,
      last = Date.now();
    for (const row of db
      .prepare("SELECT * FROM raw_times ORDER BY trip,seq")
      .iterate()) {
      processed++;
      if (processed % 10000 === 0 && Date.now() - last >= 15000) {
        progress(
          `Patterns: ${processed.toLocaleString("en-US")} stop times processed`,
        );
        last = Date.now();
      }
      if (current !== row.trip) {
        flush();
        current = row.trip;
        times = [];
      }
      times.push(row);
    }
    flush();
    const insertPattern = db.prepare("INSERT INTO patterns VALUES(?,?)");
    for (const pattern of patterns.values())
      insertPattern.run(pattern.id, JSON.stringify(pattern));
    const insertService = db.prepare("INSERT INTO services VALUES(?,?)");
    for (const service of services.values())
      insertService.run(service.id, JSON.stringify(service));
    const usedShapes = new Set(
      [...patterns.values()].map((pattern) => pattern.shapeId),
    );
    const insertShape = db.prepare("INSERT INTO shapes VALUES(?,?,?,?)");
    for await (const row of rows(archive, "shapes.txt")) {
      if (!usedShapes.has(row.shape_id)) continue;
      const lat = Number(row.shape_pt_lat),
        lon = Number(row.shape_pt_lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon))
        throw new Error("Invalid shape coordinate");
      insertShape.run(row.shape_id, integer(row.shape_pt_sequence), lat, lon);
    }
    progress("Indexing map shapes");
    db.exec("CREATE INDEX shapes_order ON shapes(id,seq)");
    const metadata = { source, importedAt: new Date().toISOString() };
    for await (const info of rows(archive, "feed_info.txt")) {
      if (info.feed_end_date) metadata.validUntil = info.feed_end_date;
      break;
    }
    const insertMetadata = db.prepare("INSERT INTO metadata VALUES(?,?)");
    for (const [key, value] of Object.entries(metadata))
      insertMetadata.run(key, value);
    if (!patterns.size || !stops.size)
      throw new Error("No usable Rio services");
    progress("Finalizing and compacting SQLite snapshot");
    db.exec("DROP TABLE raw_times; COMMIT; VACUUM");
    db.close();
    db = undefined;
    publish(temporary, output);
    progress(
      `Imported ${stops.size} stops and ${patterns.size} patterns; ${Math.floor(statSync(output).size / MIB)} MiB. Snapshot replaced atomically.`,
    );
  } finally {
    archive?.zip.close();
    db?.close();
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export async function downloadFeed(url, destination, request = fetch) {
  progress("Downloading Rio timetable feed");
  const response = await request(url, {
    headers: {
      "User-Agent": "MoovitDeCria/1.0 (+https://github.com/joaopedrocyrino)",
    },
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok || !response.body)
    throw new Error("Feed download returned HTTP " + response.status);
  let count = 0,
    last = Date.now();
  const limit = new Transform({
    transform(chunk, encoding, callback) {
      count += chunk.length;
      if (count > 150 * MIB) {
        callback(new Error("Feed download exceeds 150 MiB"));
        return;
      }
      if (Date.now() - last >= 15000) {
        progress(`Downloaded ${Math.floor(count / MIB)} MiB`);
        last = Date.now();
      }
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    limit,
    createWriteStream(destination, { flags: "wx", mode: 0o600 }),
  );
  progress(`Download complete: ${Math.floor(count / MIB)} MiB`);
}

export async function main(args = process.argv.slice(2)) {
  const env = loadEnvironment();
  const { values } = parseArgs({
    args,
    options: {
      file: { type: "string" },
      snapshot: { type: "string" },
      url: {
        type: "string",
        default: env.GTFS_URL || "https://dados.mobilidade.rio/gtfs/schedule",
      },
      output: {
        type: "string",
        default: path.join(ROOT, ".data/transit.sqlite"),
      },
    },
  });
  if (values.file && values.snapshot)
    throw new Error("Choose either --file or --snapshot.");
  if (values.snapshot)
    return installSnapshot(values.snapshot, values.output, values.url);
  if (values.file)
    return build(
      values.file,
      values.output,
      "SMTR GTFS / " + path.basename(values.file),
    );
  const folder = mkdtempSync(path.join(tmpdir(), "cria-gtfs-"));
  try {
    const archive = path.join(folder, "gtfs.zip");
    await downloadFeed(values.url, archive);
    await build(archive, values.output, values.url);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
if (isMain(import.meta.url)) await runCli(main);
