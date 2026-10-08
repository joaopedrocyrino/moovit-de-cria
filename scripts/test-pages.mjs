import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import path from "node:path";
const app = process.argv[2] || "client";
assert.ok(["client", "admin"].includes(app), "Select client or admin.");
const appRoot = `frontend/${app}`;
const port = process.env.PAGES_PREVIEW_PORT || "4173";
const base = "http://127.0.0.1:" + port;
const expectedHtml = await readFile(`${appRoot}/dist/index.html`, "utf8");
const preview = spawn(
  process.execPath,
  [
    path.resolve("node_modules/vite/bin/vite.js"),
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    port,
    "--strictPort",
  ],
  { cwd: appRoot, stdio: "inherit" },
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
  if (app === "client") {
    const tests = spawn("npm", ["run", "test:browser"], {
      stdio: "inherit",
      env: { ...process.env, BASE_URL: base },
    });
    const status = await new Promise((resolve, reject) => {
      tests.on("error", reject);
      tests.on("exit", resolve);
    });
    assert.equal(status, 0, "Client Pages artifact browser checks failed.");
  } else {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      const errors = [],
        apiRequests = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          apiRequests.push(request.url());
      });
      await page.goto(base);
      await page
        .getByRole("heading", { name: "Hello world", exact: true })
        .waitFor();
      assert.equal(await page.title(), "Moovit de Cria · Admin");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.setViewportSize({ width: 1440, height: 900 });
      await page
        .getByRole("heading", { name: "Hello world", exact: true })
        .waitFor();
      assert.deepEqual(errors, []);
      assert.deepEqual(apiRequests, []);
      console.log(
        "Admin Pages artifact: React/shared package loaded, Hello world rendered on mobile/desktop, no API requests.",
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  preview.kill("SIGTERM");
  if (preview.exitCode === null && preview.signalCode === null)
    await new Promise((resolve) => preview.once("exit", resolve));
}
