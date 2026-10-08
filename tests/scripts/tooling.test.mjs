import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadEnvironment, resolveDotnet } from "../../scripts/lib/runtime.mjs";
import { shellQuote } from "../../scripts/shell-quote.mjs";

test("SSH shell quoting preserves literal arguments without command execution", () => {
  const values = [
    "spaces here",
    "a'b",
    "$(echo injected)",
    "`echo injected`",
    "$VALUE",
    "line\nbreak",
  ];
  const output = execFileSync(
    "bash",
    ["-c", "printf '%s\\0' " + values.map(shellQuote).join(" ")],
    { encoding: "utf8" },
  );
  assert.deepEqual(output.split("\0").slice(0, -1), values);
});
test("environment files support quotes/comments and never override supplied variables", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "cria-env-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(
    path.join(directory, ".env"),
    'API_PORT=5193\nNAME="quoted name" # comment\n',
  );
  assert.deepEqual(loadEnvironment(directory, { API_PORT: "5199" }), {
    API_PORT: "5199",
    NAME: "quoted name",
  });
});
test("SDK fallback resolves an executable supplied through DOTNET_ROOT", (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "cria-dotnet-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const executable = path.join(folder, "dotnet");
  writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  assert.equal(
    resolveDotnet({ PATH: "", DOTNET_ROOT: folder }),
    realpathSync(executable),
  );
});
