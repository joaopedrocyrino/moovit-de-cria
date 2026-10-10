import type { FavoriteLine, TransitLine } from "@cria/shared";
import { searchKey } from "./savedPlaces.ts";

export function lineLabel(line: Pick<TransitLine, "line" | "mode">) {
  return `${line.mode === "metro" ? "Metrô" : line.mode === "brt" ? "BRT" : "Ônibus"} ${line.line}`;
}
export function findFavorite(
  lines: FavoriteLine[],
  line: Pick<TransitLine, "line" | "mode">,
) {
  return lines.find(
    (saved) =>
      saved.mode === line.mode &&
      searchKey(saved.line) === searchKey(line.line),
  );
}
