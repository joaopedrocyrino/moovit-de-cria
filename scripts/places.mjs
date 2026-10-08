import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { ROOT, isMain, runCli } from "./lib/runtime.mjs";

export const CATALOG = path.join(
  ROOT,
  "src/Cria.Infrastructure/Data/places.json",
);
const fields = new Set([
  "id",
  "name",
  "aliases",
  "address",
  "neighborhood",
  "lat",
  "lon",
  "enabled",
  "source",
  "notes",
]);
export const normalize = (value) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function validate(data) {
  if (!Array.isArray(data))
    throw new Error("O catálogo deve ser uma lista JSON.");
  const ids = new Set();
  for (const place of data) {
    if (
      !place ||
      typeof place !== "object" ||
      Array.isArray(place) ||
      Object.keys(place).some((key) => !fields.has(key))
    )
      throw new Error("Entrada inválida ou campo desconhecido no catálogo.");
    if (
      typeof place.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,79}$/.test(place.id) ||
      ids.has(place.id)
    )
      throw new Error(
        "Cada lugar precisa de um id único com letras minúsculas, números ou hífens.",
      );
    ids.add(place.id);
    for (const key of ["name", "neighborhood"])
      if (typeof place[key] !== "string" || !normalize(place[key]))
        throw new Error(`${place.id}: preencha ${key}.`);
    if (
      !Array.isArray(place.aliases) ||
      place.aliases.some(
        (alias) => typeof alias !== "string" || !normalize(alias),
      )
    )
      throw new Error(
        `${place.id}: aliases deve ser uma lista de nomes não vazios.`,
      );
    for (const key of ["address", "source", "notes"])
      if (place[key] != null && typeof place[key] !== "string")
        throw new Error(`${place.id}: ${key} deve ser texto ou null.`);
    if (typeof place.enabled !== "boolean")
      throw new Error(`${place.id}: enabled deve ser true ou false.`);
    const { lat, lon } = place;
    if (place.enabled || lat != null || lon != null) {
      if (
        typeof lat !== "number" ||
        typeof lon !== "number" ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        lat < -23.12 ||
        lat > -22.72 ||
        lon < -43.85 ||
        lon > -43.08
      )
        throw new Error(
          `${place.id}: informe latitude/longitude válidas dentro da região do Rio.`,
        );
    }
    if (
      place.enabled &&
      (typeof place.source !== "string" || !place.source.trim())
    )
      throw new Error(
        `${place.id}: registre a origem das coordenadas em source.`,
      );
  }
  return data;
}

export function readCatalog(file) {
  return validate(JSON.parse(readFileSync(file, "utf8")));
}

export function writeCatalog(file, data) {
  validate(data);
  const text = JSON.stringify(data, null, 2) + "\n";
  const mode = existsSync(file) ? statSync(file).mode & 0o777 : 0o644;
  const temporary = path.join(path.dirname(file), ".places-" + randomUUID());
  let fd;
  try {
    fd = openSync(temporary, "wx", mode);
    writeFileSync(fd, text, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    chmodSync(temporary, mode);
    renameSync(temporary, file);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function addPlace(file, entry) {
  writeCatalog(file, [...readCatalog(file), entry]);
}

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: Object.fromEntries(
      [
        "file",
        "name",
        "id",
        "aliases",
        "address",
        "neighborhood",
        "coordinates",
        "source",
      ].map((key) => [key, { type: "string" }]),
    ),
  });
  const [command] = positionals;
  if (positionals.length !== 1 || !["add", "validate"].includes(command))
    throw new Error("Use places.mjs add|validate [--file caminho].");
  const file = values.file || CATALOG;
  const data = readCatalog(file);
  if (command === "validate") {
    console.log(
      `Catálogo válido: ${data.length} lugares, ${data.filter((place) => place.enabled).length} ativos.`,
    );
    return;
  }
  let readline;
  async function prompt(value, label, fallback = "") {
    if (value !== undefined) return value.trim();
    readline ||= createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await readline.question(
      label + (fallback ? ` [${fallback}]` : "") + ": ",
    );
    return answer.trim() || fallback;
  }
  try {
    const name = await prompt(values.name, "Nome do lugar");
    const id = values.id || normalize(name).replaceAll(" ", "-");
    const aliases = (
      await prompt(values.aliases, "Apelidos separados por ; (opcional)")
    )
      .split(";")
      .map((alias) => alias.trim())
      .filter(Boolean);
    const address =
      (await prompt(values.address, "Rua e número (opcional)")) || null;
    const neighborhood = await prompt(values.neighborhood, "Bairro");
    const coordinates = (
      await prompt(values.coordinates, "Coordenadas: latitude, longitude")
    )
      .split(",")
      .map((value) => value.trim());
    if (coordinates.length !== 2 || coordinates.some((value) => !value))
      throw new Error(
        "Use latitude, longitude, com ponto como separador decimal.",
      );
    const [lat, lon] = coordinates.map(Number);
    const source = await prompt(
      values.source,
      "Origem das coordenadas",
      "Cadastro manual pelo mantenedor",
    );
    addPlace(file, {
      id,
      name,
      aliases,
      address,
      neighborhood,
      lat,
      lon,
      enabled: true,
      source,
    });
    console.log(`Lugar adicionado: ${name}. Arquivo: ${file}`);
    console.log(
      "Reinicie o backend local. Para produção, faça commit/push em main para reconstruir e publicar o catálogo.",
    );
  } finally {
    readline?.close();
  }
}
if (isMain(import.meta.url)) await runCli(main);
