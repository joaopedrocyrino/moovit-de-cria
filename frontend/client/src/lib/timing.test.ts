import test from "node:test";
import assert from "node:assert/strict";
import { planTiming, rioDateTime, journeyStatus } from "./timing.ts";
import type { Leg } from "@cria/shared";
const now = Date.parse("2026-10-08T12:00:00Z");
test("now leaves scheduling to the server", () =>
  assert.deepEqual(planTiming("now", "", now), {}));
test("departure and arrival use Rio wall time regardless of the phone zone", () => {
  assert.equal(rioDateTime(new Date(now)), "2026-10-08T09:00");
  assert.deepEqual(planTiming("departure", "2026-10-08T10:30", now), {
    departure: "2026-10-08T13:30:00.000Z",
  });
  assert.deepEqual(planTiming("arrival", "2026-10-08T10:30", now), {
    arriveBy: "2026-10-08T13:30:00.000Z",
  });
});
test("invalid, past, and beyond-seven-day times are rejected", () => {
  for (const value of [
    "",
    "bad",
    "2026-02-30T10:30",
    "2026-10-08T08:00",
    "2026-10-16T10:30",
  ])
    assert.throws(() => planTiming("arrival", value, now));
});
const leg = {
  mode: "metro",
  line: "1/4",
  start: "2026-10-08T12:05:00Z",
  from: { name: "Jardim Oceânico" },
  to: { name: "Botafogo" },
  stops: [
    { name: "Jardim Oceânico" },
    { name: "São Conrado" },
    { name: "Botafogo" },
  ],
} as Leg;
test("compact journey shows walking and an explicitly estimated countdown", () => {
  const status = journeyStatus(leg, false, 0, false, true, now);
  assert.match(status.title, /Vá até Jardim Oceânico/);
  assert.match(status.detail, /5 min \(estimativa\)/);
});
test("boarding, inaccurate GPS, and alighting update the compact status", () => {
  assert.match(
    journeyStatus(leg, true, 0, false, true, now).title,
    /Próxima estação: São Conrado/,
  );
  assert.match(
    journeyStatus(leg, true, 0, false, false, now).detail,
    /Sem GPS preciso/,
  );
  assert.match(
    journeyStatus(leg, true, 1, true, true, now).title,
    /Prepare-se para descer/,
  );
});
