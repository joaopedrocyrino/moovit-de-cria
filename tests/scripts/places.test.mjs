import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  statSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CATALOG,
  addPlace,
  readCatalog,
  writeCatalog,
  validate,
  main,
} from "../../scripts/places.mjs";
const entry = () => ({
  id: "novo-lugar",
  name: "Novo Café",
  aliases: ["Cafe Novo"],
  address: null,
  neighborhood: "Botafogo",
  lat: -22.95,
  lon: -43.18,
  enabled: true,
  source: "GPS próprio",
});
function catalog(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "cria-places-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "places.json");
}
test("add preserves existing entries, Unicode and file permissions", (t) => {
  const file = catalog(t),
    existing = { ...entry(), id: "existente", name: "Existente" };
  writeCatalog(file, [existing]);
  addPlace(file, entry());
  assert.deepEqual(readCatalog(file), [existing, entry()]);
  assert.ok(readFileSync(file, "utf8").includes("Novo Café"));
  assert.equal(statSync(file).mode & 0o777, 0o644);
});
test("invalid additions never modify the catalog or leave temporary files", (t) => {
  const file = catalog(t);
  writeCatalog(file, [entry()]);
  const original = readFileSync(file);
  for (const bad of [
    entry(),
    { ...entry(), id: "outside", lat: 0 },
    { ...entry(), id: "missing-source", source: "" },
  ]) {
    assert.throws(() => addPlace(file, bad));
    assert.deepEqual(readFileSync(file), original);
    assert.ok(
      !readdirSync(path.dirname(file)).some((name) =>
        name.startsWith(".places-"),
      ),
    );
  }
});
test("disabled drafts are valid but malformed data is rejected", () => {
  const draft = {
    ...entry(),
    enabled: false,
    lat: null,
    lon: null,
    source: null,
  };
  assert.deepEqual(validate([draft]), [draft]);
  for (const change of [
    { lat: true },
    { lat: NaN },
    { unknown: "field" },
    { aliases: [""] },
    { enabled: "true" },
    { name: "..." },
  ])
    assert.throws(() => validate([{ ...entry(), ...change }]));
});
test("bundled curated coordinates remain valid", () => {
  const places = new Map(
    readCatalog(CATALOG).map((place) => [place.id, place]),
  );
  assert.equal(places.get("casa-do-amor").lat, -22.970418642926163);
  assert.equal(places.get("rft-botafogo").lon, -43.18393118957157);
});
test("noninteractive CLI accepts negative coordinates and generates accented-name aliases", async (t) => {
  const file = catalog(t);
  writeCatalog(file, []);
  await main([
    "add",
    "--file",
    file,
    "--name",
    "Novo Café",
    "--aliases",
    "Cafe Novo;Outra grafia",
    "--address",
    "",
    "--neighborhood",
    "Botafogo",
    "--coordinates=-22.95,-43.18",
    "--source",
    "GPS próprio",
  ]);
  assert.equal(readCatalog(file)[0].id, "novo-cafe");
  assert.deepEqual(readCatalog(file)[0].aliases, ["Cafe Novo", "Outra grafia"]);
});
