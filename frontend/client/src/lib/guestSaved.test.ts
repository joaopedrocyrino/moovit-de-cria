import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptySaved,
  parseGuestSaved,
  withAddress,
  withLine,
  writeGuestSaved,
  readGuestSaved,
  GUEST_SAVED_KEY,
} from "./guestSaved.ts";
const home = {
  label: "Rua de teste, Rio",
  point: { lat: -22.9201234, lon: -43.2102345 },
};
test("guest places and all three line modes retain exact coordinates after reload", () => {
  let data = withAddress(emptySaved(), " Casa ", home, "home");
  for (const [index, mode] of ["bus", "brt", "metro"].entries())
    data = withLine(data, { mode, line: "1", name: mode }, String(index));
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) || null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
  writeGuestSaved(storage, data);
  assert.deepEqual(readGuestSaved(storage), data);
  assert.equal(data.addresses[0].alias, "Casa");
  assert.equal(map.size, 1);
  assert.ok(map.has(GUEST_SAVED_KEY));
});
test("alias deduplication and edits preserve place limits", () => {
  let data = withAddress(emptySaved(), "Casa", home, "home");
  assert.throws(() => withAddress(data, "Cása", home, "other"));
  for (let i = 1; i < 20; i++)
    data = withAddress(data, "Place " + i, home, String(i));
  assert.throws(() => withAddress(data, "Overflow", home, "new"));
  assert.equal(
    withAddress(data, "Trabalho", home, "home").addresses.length,
    20,
  );
});
test("line duplicates are idempotent and modes remain distinct", () => {
  const data = withLine(emptySaved(), { mode: "bus", line: "553" }, "one");
  assert.equal(withLine(data, { mode: "bus", line: "553" }, "two"), data);
  assert.equal(
    withLine(data, { mode: "brt", line: "553" }, "two").lines.length,
    2,
  );
});
test("corrupt storage and unknown versions do not break the app", () => {
  for (const raw of [
    null,
    "broken",
    "null",
    "{}",
    '{"version":2,"addresses":[]}',
  ])
    assert.deepEqual(parseGuestSaved(raw), emptySaved());
  const raw = JSON.stringify({
    version: 1,
    addresses: [
      {
        id: "a",
        alias: "Casa",
        address: home.label,
        point: { lat: 0, lon: 0 },
      },
      {
        id: "b",
        alias: "Casa",
        address: home.label,
        point: home.point,
        password: "do not retain",
      },
    ],
    lines: [{ id: "x", mode: "plane", line: "1", name: "no" }],
  });
  assert.deepEqual(
    parseGuestSaved(raw),
    withAddress(emptySaved(), "Casa", home, "b"),
  );
});
test("storage failures report that favorites were not saved", () => {
  assert.throws(
    () =>
      writeGuestSaved(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error("quota");
          },
        },
        emptySaved(),
      ),
    /armazenamento/,
  );
});
