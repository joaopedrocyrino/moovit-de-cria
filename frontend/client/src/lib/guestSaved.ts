import type {
  AccountData,
  FavoriteLine,
  Place,
  SavedAddress,
  TransitLine,
} from "@cria/shared";
import { searchKey } from "./savedPlaces.ts";

export const GUEST_SAVED_KEY = "cria.guest-saved.v1";
export const emptySaved = (): AccountData => ({ addresses: [], lines: [] });
type StorageAccess = Pick<Storage, "getItem" | "setItem">;
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= limit &&
  !/[\u0000-\u001f\u007f]/u.test(value);
const validPoint = (point: Place["point"] | undefined) =>
  !!point &&
  Number.isFinite(point.lat) &&
  Number.isFinite(point.lon) &&
  point.lat >= -23.12 &&
  point.lat <= -22.72 &&
  point.lon >= -43.85 &&
  point.lon <= -43.08;

export function parseGuestSaved(raw: string | null): AccountData {
  if (!raw) return emptySaved();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptySaved();
  }
  if (!parsed || parsed.version !== 1) return emptySaved();
  const addresses: SavedAddress[] = [],
    lines: FavoriteLine[] = [];
  const aliases = new Set<string>(),
    ids = new Set<string>(),
    lineKeys = new Set<string>();
  for (const item of Array.isArray(parsed.addresses) ? parsed.addresses : []) {
    if (
      !item ||
      !text(item.id, 80) ||
      !text(item.alias, 40) ||
      !text(item.address, 240) ||
      !validPoint(item.point) ||
      aliases.has(searchKey(item.alias)) ||
      ids.has(item.id)
    )
      continue;
    aliases.add(searchKey(item.alias));
    ids.add(item.id);
    addresses.push({
      id: item.id,
      alias: item.alias.trim(),
      address: item.address.trim(),
      point: { lat: item.point.lat, lon: item.point.lon },
    });
    if (addresses.length === 20) break;
  }
  for (const item of Array.isArray(parsed.lines) ? parsed.lines : []) {
    if (
      !item ||
      !text(item.id, 80) ||
      !text(item.line, 40) ||
      !text(item.name, 240) ||
      !["bus", "brt", "metro"].includes(item.mode) ||
      ids.has(item.id)
    )
      continue;
    const key = `${item.mode}:${searchKey(item.line)}`;
    if (lineKeys.has(key)) continue;
    lineKeys.add(key);
    ids.add(item.id);
    lines.push({
      id: item.id,
      line: item.line.trim(),
      mode: item.mode,
      name: item.name.trim(),
    });
    if (lines.length === 50) break;
  }
  return { addresses, lines };
}

export function readGuestSaved(storage: StorageAccess): AccountData {
  return parseGuestSaved(storage.getItem(GUEST_SAVED_KEY));
}
export function writeGuestSaved(
  storage: StorageAccess,
  data: AccountData,
): void {
  try {
    storage.setItem(GUEST_SAVED_KEY, JSON.stringify({ version: 1, ...data }));
  } catch {
    throw new Error(
      "O navegador não permitiu guardar seus favoritos. Libere o armazenamento deste site e tente novamente.",
    );
  }
}
export function withAddress(
  data: AccountData,
  alias: string,
  place: Place,
  id: string,
): AccountData {
  alias = alias.trim();
  const address = place.label.trim();
  if (!text(alias, 40))
    throw new Error("Apelido deve ter de 1 a 40 caracteres.");
  if (!text(address, 240) || !validPoint(place.point))
    throw new Error("Escolha um endereço válido na região do Rio.");
  const existing = data.addresses.find((item) => item.id === id);
  if (
    data.addresses.some(
      (item) => item.id !== id && searchKey(item.alias) === searchKey(alias),
    )
  )
    throw new Error("Você já tem um lugar com esse apelido.");
  if (!existing && data.addresses.length >= 20)
    throw new Error("Você pode salvar até 20 lugares.");
  const saved = {
    id,
    alias,
    address,
    point: { lat: place.point.lat, lon: place.point.lon },
  };
  return {
    ...data,
    addresses: [...data.addresses.filter((item) => item.id !== id), saved].sort(
      (a, b) => a.alias.localeCompare(b.alias, "pt-BR"),
    ),
  };
}
export function withLine(
  data: AccountData,
  line: Pick<TransitLine, "mode" | "line"> & { name?: string },
  id: string,
): AccountData {
  if (!["bus", "brt", "metro"].includes(line.mode) || !text(line.line, 40))
    throw new Error("Escolha uma linha válida de transporte.");
  if (
    data.lines.some(
      (item) =>
        item.mode === line.mode &&
        searchKey(item.line) === searchKey(line.line),
    )
  )
    return data;
  if (data.lines.length >= 50)
    throw new Error("Você pode salvar até 50 linhas.");
  const name = line.name?.trim() || `Linha ${line.line.trim()}`;
  if (!text(name, 240)) throw new Error("Nome de linha inválido.");
  return {
    ...data,
    lines: [
      ...data.lines,
      { id, mode: line.mode, line: line.line.trim(), name },
    ],
  };
}
