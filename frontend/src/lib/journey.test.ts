import { test } from "node:test";
import assert from "node:assert/strict";
import { distance, progress, validFix } from "./journey.ts";
import type { Leg } from "../types.ts";
const now = Date.now();
const stops = Array.from({ length: 6 }, (_, i) => ({
  id: String(i),
  name: String(i),
  point: { lat: -22.92 - i * 0.001, lon: -43.21 },
}));
const leg = { stops, from: stops[0], to: stops[5] } as Leg;
test("distance uses meters", () =>
  assert.ok(distance(stops[0].point, stops[1].point) > 110));
test("stale or inaccurate GPS cannot trigger an alert", () => {
  assert.equal(
    validFix({ ...stops[5].point, accuracy: 300, timestamp: now }, now),
    false,
  );
  assert.equal(
    progress(
      leg,
      { ...stops[5].point, accuracy: 10, timestamp: now - 60000 },
      0,
      now,
    ).alert,
    false,
  );
});
test("no alighting alert while still at boarding stop", () =>
  assert.equal(
    progress(leg, { ...stops[0].point, accuracy: 10, timestamp: now }, 0, now)
      .alert,
    false,
  ));
test("approaching final two stops alerts", () =>
  assert.equal(
    progress(leg, { ...stops[4].point, accuracy: 15, timestamp: now }, 2, now)
      .alert,
    true,
  ));
test("route progress does not move backward", () =>
  assert.equal(
    progress(leg, { ...stops[1].point, accuracy: 10, timestamp: now }, 3, now)
      .index,
    3,
  ));
test("off-route location does not invent progress", () =>
  assert.equal(
    progress(
      leg,
      { lat: -22.96, lon: -43.3, accuracy: 10, timestamp: now },
      1,
      now,
    ).offRoute,
    true,
  ));
