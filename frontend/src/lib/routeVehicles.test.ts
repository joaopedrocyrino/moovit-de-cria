import test from "node:test";
import assert from "node:assert/strict";
import { mapVehicles, routeLayers } from "./routeVehicles.ts";
import type { Itinerary, Leg, Vehicle } from "../types.ts";
const now = Date.now();
const leg = (line: string, routeId: string, direction: number, mode = "bus") =>
  ({
    kind: "transit",
    line,
    routeId,
    direction,
    headsign: "Botafogo",
    mode,
  }) as Leg;
const route = {
  legs: [
    leg("361", "bus-361", 0),
    leg("18", "brt-18", 1, "brt"),
    leg("1/4", "metro:1/4", 1, "metro"),
  ],
} as Itinerary;
const vehicle = (
  id: string,
  line: string,
  routeId: string,
  direction: number | null,
  age = 0,
) =>
  ({
    id,
    line,
    routeId,
    direction,
    observedAt: new Date(now - age).toISOString(),
  }) as Vehicle;
test("all journey lines appear with distinct matching route colors", () => {
  const vehicles = mapVehicles(
    route,
    {
      "361": [
        vehicle("A", "361", "bus-361", 0),
        vehicle("B", "361", "bus-361", 0),
      ],
      "18": [vehicle("C", "18", "brt-18", 1)],
    },
    now,
  );
  assert.deepEqual(
    vehicles.map((v) => v.id),
    ["A", "B", "C"],
  );
  assert.equal(vehicles[0].color, vehicles[1].color);
  assert.notEqual(vehicles[0].color, vehicles[2].color);
  assert.equal(vehicles[2].color, routeLayers(route)[1].color);
});
test("opposite directions, unknown directions, other variants, and old positions are excluded", () => {
  const vehicles = mapVehicles(
    route,
    {
      "361": [
        vehicle("wrong-way", "361", "bus-361", 1),
        vehicle("unknown", "361", "bus-361", null),
        vehicle("variant", "361", "other", 0),
        vehicle("old", "361", "bus-361", 0, 181000),
        vehicle("good", "361", "bus-361", 0),
      ],
    },
    now,
  );
  assert.deepEqual(
    vehicles.map((v) => v.id),
    ["good"],
  );
});
test("repeated legs do not duplicate vehicle markers and metro GPS is not fabricated", () => {
  const repeated = { legs: [...route.legs, route.legs[0]] } as Itinerary;
  assert.equal(routeLayers(repeated).length, 3);
  assert.equal(
    mapVehicles(
      repeated,
      {
        "361": [vehicle("A", "361", "bus-361", 0)],
        "1/4": [vehicle("train", "1/4", "metro:1/4", 1)],
      },
      now,
    ).length,
    1,
  );
  assert.deepEqual(mapVehicles(null, {}), []);
});
