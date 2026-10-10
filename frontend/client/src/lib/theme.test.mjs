import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const source = readFileSync(
  new URL("../../public/theme.js", import.meta.url),
  "utf8",
);
function bootstrap(systemDark, saved, blocked = false) {
  const root = { dataset: {}, style: {} };
  runInNewContext(source, {
    document: { documentElement: root },
    localStorage: {
      getItem() {
        if (blocked) throw new Error("blocked");
        return saved;
      },
    },
    matchMedia: () => ({ matches: systemDark }),
  });
  return root;
}
test("theme is resolved before first paint from OS or explicit preference", () => {
  for (const [dark, saved, expected] of [
    [true, null, "dark"],
    [false, null, "light"],
    [true, "light", "light"],
    [false, "dark", "dark"],
    [true, "invalid", "dark"],
  ])
    assert.equal(bootstrap(dark, saved).dataset.theme, expected);
});
test("blocked storage still honors the OS preference", () => {
  assert.equal(bootstrap(true, null, true).style.colorScheme, "dark");
});
