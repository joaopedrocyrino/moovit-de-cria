import { connectTestSite } from "./browser-api.mjs";
import { chromium, webkit } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const base = process.env.BASE_URL || "http://127.0.0.1:5193";
const engine = process.env.BROWSER === "webkit" ? webkit : chromium;
// Wait for the API, including container startup in CI.
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await fetch(
      (process.env.API_TEST_URL || base) + "/api/health/ready",
      {
        signal: AbortSignal.timeout(3000),
      },
    );
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.ok(
  ready,
  "The test API must have an imported fixture before browser checks.",
);
const browser = await engine.launch({ headless: true });
await mkdir("output", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
    geolocation: { latitude: -22.92, longitude: -43.21, accuracy: 10 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  const site = await connectTestSite(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // External providers are replaced only in this test; the app/API router stays real.
  await page.route("**/api/places/reverse", (r) =>
    r.fulfill({
      json: {
        label: "Parada Teste A, Rio de Janeiro",
        point: { lat: -22.92, lon: -43.21 },
      },
    }),
  );
  const searches = [];
  await page.route("**/api/places/search", async (route) => {
    const body = route.request().postDataJSON();
    searches.push(body.query);
    const isCafe = body.query.toLowerCase().includes("chora");
    const isOrigin = body.query === "Teste A";
    if (body.query === "Teste antigo")
      await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      await route.fulfill({
        json: [
          {
            label: isCafe
              ? "Chora Café, Rua Oliveira Fausto, 28, Botafogo, Rio de Janeiro"
              : isOrigin
                ? "Parada Teste A, Rio de Janeiro"
                : body.query === "Teste antigo"
                  ? "Resultado antigo"
                  : "Parada Teste C, Rio de Janeiro",
            point: isCafe
              ? { lat: -22.9566277, lon: -43.1837086 }
              : { lat: -22.92, lon: isOrigin ? -43.21 : -43.28 },
          },
        ],
      });
    } catch {
      /* A replaced query is deliberately aborted by TanStack Query. */
    }
  });
  await page.route("**/api/vehicles?**", (r) =>
    r.fulfill({
      json: {
        vehicles: [],
        status: "empty",
        checkedAt: new Date().toISOString(),
        message: "Nenhum GPS recente — fixture de teste.",
      },
    }),
  );
  await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  // Blocking the service worker keeps external-provider interception deterministic in WebKit.
  await page.goto(site);
  await page.getByRole("button", { name: "Recusar análises" }).click();
  await page.locator(".privacy-panel").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Abrir detalhes" }).click();
  await page.getByRole("heading", { name: "Partiu, cria?" }).waitFor();
  page.on("requestfailed", (r) => {
    if (r.url().includes("/api/"))
      console.error("API request failed:", r.failure()?.errorText);
  });
  const destination = page.getByRole("combobox", { name: "Buscar destino" });
  await destination.click();
  const origin = page.getByRole("combobox", { name: "Buscar origem" });
  await origin.waitFor();
  assert.equal(
    await page.locator(".search-panel input").count(),
    2,
    "Only the endpoint fields may accept addresses",
  );
  await destination.fill("Ch");
  await page.waitForTimeout(600);
  assert.deepEqual(
    searches,
    [],
    "Fewer than three characters must not call a provider",
  );
  await destination.fill("Teste antigo");
  await page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/places/search") &&
      request.postDataJSON().query === "Teste antigo",
  );
  await destination.fill("Chora cafe");
  const cafe = page.getByRole("option", { name: /Chora Café/ });
  await cafe.waitFor();
  await page.waitForTimeout(650);
  assert.equal(
    await page.getByRole("option", { name: "Resultado antigo" }).count(),
    0,
    "An old response cannot replace the current suggestions",
  );
  await page.screenshot({
    path: `output/${process.env.BROWSER || "chromium"}-autocomplete-mobile.png`,
  });
  await destination.press("ArrowDown");
  await destination.press("Enter");
  assert.match(await destination.inputValue(), /Chora Café.*Botafogo/);
  assert.equal(await destination.getAttribute("aria-expanded"), "false");
  await origin.fill("Teste A");
  assert.equal(
    await page.getByRole("button", { name: "Encontrar rotas" }).isDisabled(),
    true,
    "Editing must invalidate previous coordinates",
  );
  await page.getByRole("option", { name: /Parada Teste A/ }).waitFor();
  await page.waitForTimeout(200);
  assert.equal(
    await origin.inputValue(),
    "Teste A",
    "GPS must not overwrite the manually edited origin",
  );
  await origin.press("ArrowDown");
  await origin.press("Enter");
  await destination.fill("Teste C");
  await page.getByRole("option", { name: /Parada Teste C/ }).click();
  await page.getByRole("button", { name: "Trocar origem e destino" }).click();
  assert.match(await origin.inputValue(), /Parada Teste C/);
  assert.match(await destination.inputValue(), /Parada Teste A/);
  await page.getByRole("button", { name: "Trocar origem e destino" }).click();
  await page.getByRole("button", { name: "Encontrar rotas" }).click();
  await page
    .getByText("Mais rápida encontrada")
    .first()
    .waitFor({ timeout: 30000 });
  await page.locator(".route-card").first().click();
  await page.getByRole("button", { name: "Abrir detalhes da viagem" }).click();
  await page.getByRole("button", { name: "Já embarquei" }).waitFor();
  await page.getByRole("button", { name: "Já embarquei" }).click();
  await page.getByRole("button", { name: "Abrir detalhes da viagem" }).click();
  await page.getByText("ACOMPANHANDO SUA VIAGEM").waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: "output/mobile-journey.png", fullPage: true });
  await page.getByRole("button", { name: "Desci · próxima conexão" }).click();
  await page.getByRole("heading", { name: "BRT 22" }).waitFor();
  await page.getByRole("button", { name: "Outras rotas" }).click();
  await page.getByRole("heading", { name: "Partiu, cria?" }).waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "output/desktop.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    `${process.env.BROWSER || "chromium"} inline autocomplete, keyboard selection, stale-response handling, routing and boarding: passed`,
  );
  await context.close();
} finally {
  await browser.close();
}
