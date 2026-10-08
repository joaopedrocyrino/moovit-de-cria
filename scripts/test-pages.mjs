import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const port = process.env.PAGES_PREVIEW_PORT || "4173";
const base = "http://127.0.0.1:" + port;
const expectedHtml = await readFile("frontend/dist/index.html", "utf8");
const preview = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    port,
    "--strictPort",
  ],
  { cwd: "frontend", stdio: "inherit" },
);
try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (preview.exitCode !== null)
      throw new Error("Vite preview failed to start.");
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        assert.equal(
          await response.text(),
          expectedHtml,
          "Preview must serve this exact artifact.",
        );
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.ok(ready, "Pages artifact preview must be available.");
  const tests = spawn("npm", ["run", "test:browser"], {
    stdio: "inherit",
    env: { ...process.env, BASE_URL: base },
  });
  const status = await new Promise((resolve, reject) => {
    tests.on("error", reject);
    tests.on("exit", resolve);
  });
  assert.equal(status, 0, "Pages artifact browser checks failed.");
} finally {
  preview.kill("SIGTERM");
  if (preview.exitCode === null)
    await new Promise((resolve) => preview.once("exit", resolve));
}
