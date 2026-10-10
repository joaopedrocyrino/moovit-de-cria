import { test } from "node:test";
import assert from "node:assert/strict";
import { addressPlace, savedMatches } from "./savedPlaces.ts";
import { findFavorite } from "./favorites.ts";

const home = {
  id: "a",
  alias: "Casa",
  address: "Rua A, Botafogo",
  point: { lat: -22.9566277, lon: -43.1837086 },
};
const gym = { ...home, id: "b", alias: "Academia", address: "Rua Casa Nova" };
test("alias search is local, accent insensitive and prioritizes exact aliases", () => {
  assert.deepEqual(savedMatches([gym, home], "cása"), [home, gym]);
  assert.deepEqual(savedMatches([home, gym], "botafogo"), [home]);
  assert.deepEqual(savedMatches([home, gym], "nowhere"), []);
  assert.equal(
    savedMatches(
      Array.from({ length: 10 }, () => home),
      "",
    ).length,
    6,
  );
});
test("saved places reuse exact coordinates and mark their source", () => {
  assert.deepEqual(addressPlace(home), {
    label: "Casa",
    point: home.point,
    source: "saved",
  });
});
test("favorite matching distinguishes the same number in different modes", () => {
  const brt = { id: "f", line: "22", mode: "brt", name: "Test" };
  assert.equal(findFavorite([brt], { mode: "bus", line: "22" }), undefined);
  assert.equal(findFavorite([brt], { mode: "brt", line: "22" }), brt);
});
