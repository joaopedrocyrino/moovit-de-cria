import type { Place, SavedAddress } from "@cria/shared";

export function searchKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}
export function addressPlace(address: SavedAddress): Place {
  return {
    label: address.alias,
    point: { lat: address.point.lat, lon: address.point.lon },
    source: "saved",
  };
}
export function savedMatches(
  addresses: SavedAddress[],
  query: string,
): SavedAddress[] {
  const key = searchKey(query);
  return addresses
    .filter(
      (a) =>
        !key ||
        searchKey(a.alias).includes(key) ||
        searchKey(a.address).includes(key),
    )
    .sort(
      (a, b) =>
        Number(searchKey(b.alias) === key) - Number(searchKey(a.alias) === key),
    )
    .slice(0, 6);
}
