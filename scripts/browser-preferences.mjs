// Real APIs and browser storage; only third-party geocoding/tiles and device GPS are fixtures.
import { chromium, webkit } from "@playwright/test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { connectTestApi } from "./browser-api.mjs";
const base = process.env.BASE_URL || "http://127.0.0.1:5193";
const site = process.env.API_ORIGIN
  ? `https://${process.env.APP_HOSTNAME || "moovit.joaocyrino.com"}`
  : base;
const browser = await (
  process.env.BROWSER === "webkit" ? webkit : chromium
).launch({ headless: true });
await mkdir("output", { recursive: true });
const home = {
  label: "Rua Teste A, Rio de Janeiro",
  point: { lat: -22.9201234, lon: -43.2102345 },
  source: "catalog",
};
async function setup(context, gps = "success") {
  await context.addInitScript(
    ({ gps }) => {
      // Model Safari installations without a usable Permissions API.
      Object.defineProperty(navigator, "permissions", {
        get: () => undefined,
        configurable: true,
      });
      window.gpsCalls = [];
      if (gps === "insecure")
        Object.defineProperty(window, "isSecureContext", {
          get: () => false,
          configurable: true,
        });
      Object.defineProperty(navigator, "geolocation", {
        value:
          gps === "unsupported"
            ? undefined
            : {
                getCurrentPosition(success, error, options) {
                  window.gpsCalls.push(options);
                  if (gps === "silent") return;
                  if (gps === "denied") return error({ code: 1 });
                  if (gps === "fallback" && !options.enableHighAccuracy)
                    return error({ code: 3 });
                  success({
                    coords: {
                      latitude: -22.92,
                      longitude: -43.21,
                      accuracy: 10,
                    },
                    timestamp: Date.now(),
                  });
                },
                watchPosition() {
                  return 1;
                },
                clearWatch() {},
              },
        configurable: true,
      });
    },
    { gps },
  );
  const page = await context.newPage();
  if (process.env.API_ORIGIN)
    await page.route(site + "/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/")) return route.fallback();
      const response = await route.fetch({
        url: base + url.pathname + url.search,
      });
      await route.fulfill({ response });
    });
  await connectTestApi(page, site);
  await page.route("**/api/places/search", (route) =>
    route.fulfill({ json: [home] }),
  );
  await page.route("**/api/places/reverse", (route) =>
    route.fulfill({ json: home }),
  );
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  return page;
}
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  const page = await setup(context);
  const errors = [],
    events = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === "/api/analytics/events")
      events.push(req.postDataJSON());
  });
  await page.goto(site);
  await page.getByRole("button", { name: "Recusar análises" }).waitFor();
  assert.equal(events.length, 0, "No usage events before consent");
  await page.getByRole("button", { name: "Recusar análises" }).click();
  await page.locator(".privacy-panel").waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "dark",
  );
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await page.getByRole("button", { name: "Ativar tema escuro" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Ativar tema claro" }).waitFor();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("cria.theme")),
    "dark",
  );
  assert.equal(
    await page.evaluate(() => window.gpsCalls.length),
    0,
    "A new GPS permission is requested only after a tap",
  );
  await page
    .getByRole("button", { name: "Minha localização", exact: true })
    .click();
  await page.waitForFunction(() => window.gpsCalls.length === 1);
  await page.locator(".location-label").waitFor();
  assert.equal(
    (await page.evaluate(() => window.gpsCalls))[0].enableHighAccuracy,
    false,
  );
  await page
    .getByRole("button", { name: "Abrir lugares e linhas salvos" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Novo lugar" }).click();
  await dialog.getByLabel("Apelido").fill("Casa");
  await dialog
    .getByRole("combobox", { name: "Buscar endereço para salvar" })
    .fill("Teste A");
  await dialog.getByRole("option", { name: home.label }).click();
  await dialog
    .getByRole("button", { name: "Salvar lugar", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Editar Casa" }).waitFor();
  await dialog.getByRole("tab", { name: "Linhas", exact: true }).click();
  for (const [query, label] of [
    ["104", "Ônibus 104"],
    ["22", "BRT 22"],
    ["2", "Metrô 2"],
  ]) {
    await dialog
      .getByRole("searchbox", { name: "Buscar linha para favoritar" })
      .fill(query);
    await dialog
      .getByRole("button", { name: "Favoritar " + label, exact: true })
      .click();
    await dialog.getByText("Linha salva.", { exact: true }).waitFor();
  }
  await dialog.getByRole("button", { name: "Fechar conta" }).click();
  const local = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("cria.guest-saved.v1")),
  );
  assert.equal(local.addresses[0].point.lat, home.point.lat);
  assert.deepEqual(
    new Set(local.lines.map((line) => line.mode)),
    new Set(["bus", "brt", "metro"]),
  );
  const second = await setup(context);
  await second.goto(site);
  await second.evaluate(() => localStorage.setItem("cria.theme", "light"));
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await second.evaluate(() => localStorage.setItem("cria.theme", "dark"));
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await second.unrouteAll({ behavior: "wait" });
  await second.close();
  await page.reload();
  await page
    .getByRole("button", { name: "Abrir lugares e linhas salvos" })
    .click();
  await dialog.getByRole("button", { name: "Editar Casa" }).waitFor();
  await dialog
    .getByRole("button", { name: "Entrar ou criar conta", exact: true })
    .click();
  await dialog.getByRole("tab", { name: "Criar conta", exact: true }).click();
  await dialog.getByLabel("Seu nome").fill("Teste");
  await dialog
    .getByLabel("E-mail", { exact: true })
    .fill(randomUUID() + "@example.test");
  await dialog
    .getByLabel("Senha", { exact: true })
    .fill("a long preferences test password");
  await dialog
    .getByLabel("Confirmar senha")
    .fill("a long preferences test password");
  await dialog.getByRole("button", { name: "Criar minha conta" }).click();
  await dialog.getByRole("heading", { name: "Salve, Teste." }).waitFor();
  assert.equal(
    await dialog.getByRole("button", { name: "Editar Casa" }).count(),
    0,
    "Local guest favorites stay separate from an account",
  );
  await dialog.getByRole("tab", { name: "Conta", exact: true }).click();
  await dialog.getByRole("button", { name: "Sair desta conta" }).click();
  await page
    .getByRole("button", { name: "Abrir lugares e linhas salvos" })
    .click();
  await dialog.getByRole("button", { name: "Editar Casa" }).waitFor();
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cria.guest-saved.v1")),
    ),
    local,
  );
  await dialog.getByRole("button", { name: "Fechar conta" }).click();
  assert.equal(
    events.length,
    0,
    "Rejecting analytics leaves normal app actions untracked",
  );
  await page.getByRole("button", { name: "Sobre o aplicativo" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Privacidade e cookies" })
    .click();
  const received = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/analytics/events",
  );
  await page.getByRole("button", { name: "Aceitar análises" }).click();
  await page.locator(".privacy-panel").waitFor({ state: "hidden" });
  await page.waitForFunction(
    () => document.querySelector(".privacy-panel") === null,
  );
  const response = await received;
  assert.equal(response.status(), 204);
  assert.ok(
    events
      .flatMap((batch) => batch.events)
      .some((event) => event.name === "app_open"),
  );
  assert.ok(!JSON.stringify(events).includes(home.label));
  await page.getByRole("button", { name: "Sobre o aplicativo" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Privacidade e cookies" })
    .click();
  await page.getByRole("button", { name: "Recusar análises" }).click();
  await page.locator(".privacy-panel").waitFor({ state: "hidden" });
  assert.ok(
    !(await context.cookies()).some((cookie) =>
      cookie.name.includes("cria-usage"),
    ),
  );
  await page.getByRole("button", { name: "Sobre o aplicativo" }).click();
  await page.getByLabel("Preferência de tema").selectOption("system");
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.screenshot({
    path: `output/preferences-${process.env.BROWSER || "chromium"}-dark.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await context.close();
  for (const gps of [
    "denied",
    "fallback",
    "silent",
    "insecure",
    "unsupported",
  ]) {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: "block",
    });
    const p = await setup(c, gps);
    if (gps === "silent") await p.clock.install();
    await p.goto(site);
    await p.getByRole("button", { name: "Recusar análises" }).click();
    await p.locator(".privacy-panel").waitFor({ state: "hidden" });
    await p
      .getByRole("button", { name: "Minha localização", exact: true })
      .click();
    if (gps === "insecure")
      await p.getByText(/A localização precisa/).waitFor();
    if (gps === "unsupported")
      await p.getByText(/Este navegador não oferece localização/).waitFor();
    if (gps === "denied") await p.getByText(/Localização bloqueada/).waitFor();
    if (gps === "fallback") {
      await p.locator(".location-label").waitFor();
      assert.equal((await p.evaluate(() => window.gpsCalls)).length, 2);
    }
    if (gps === "silent") {
      await p.clock.runFor(25_001);
      await p.getByText(/A localização demorou/).waitFor();
    }
    await p.unrouteAll({ behavior: "ignoreErrors" });
    await c.close();
  }
  console.log(
    "Preferences browser: OS/manual themes, guest persistence/account separation, consent gating/cookies, Safari permission flow, GPS fallback/denial/silent timeout passed.",
  );
} finally {
  await browser.close();
}
