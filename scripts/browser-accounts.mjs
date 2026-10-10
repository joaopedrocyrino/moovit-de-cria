// Real account endpoints; only public map/geocoding providers are substituted.
import { chromium, webkit } from "@playwright/test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { connectTestApi } from "./browser-api.mjs";

const base = process.env.BASE_URL || "http://127.0.0.1:5193";
const productionApi = process.env.API_ORIGIN;
// Exercise HTTPS same-site cookies when previewing the exact Pages artifact.
const site = productionApi
  ? `https://${process.env.APP_HOSTNAME || "moovit.joaocyrino.com"}`
  : base;
const browser = await (
  process.env.BROWSER === "webkit" ? webkit : chromium
).launch({ headless: true });
await mkdir("output", { recursive: true });
const password = "a long browser account phrase";
const firstEmail = randomUUID() + "@example.test",
  secondEmail = randomUUID() + "@example.test";
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [],
    searches = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (productionApi)
    await page.route(site + "/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/")) return route.fallback();
      const response = await route.fetch({
        url: base + url.pathname + url.search,
      });
      await route.fulfill({ response });
    });
  await connectTestApi(page, site);
  const home = {
    label: "Rua Teste A, Rio de Janeiro",
    point: { lat: -22.9201234, lon: -43.2102345 },
    source: "catalog",
  };
  const work = {
    label: "Rua Teste C, Rio de Janeiro",
    point: { lat: -22.92, lon: -43.28 },
    source: "catalog",
  };
  await page.route("**/api/places/search", (route) => {
    const query = route.request().postDataJSON().query;
    searches.push(query);
    return route.fulfill({ json: [query.includes("Teste C") ? work : home] });
  });
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.route("**/api/vehicles?**", (route) =>
    route.fulfill({
      json: {
        vehicles: [],
        status: "empty",
        checkedAt: new Date().toISOString(),
      },
    }),
  );
  await page.goto(site);
  await page.getByRole("button", { name: "Recusar análises" }).click();
  await page.locator(".privacy-panel").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Entrar ou criar conta" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  async function register(email, name) {
    await dialog.getByRole("tab", { name: "Criar conta", exact: true }).click();
    await dialog.getByLabel("Seu nome").fill(name);
    await dialog.getByLabel("E-mail", { exact: true }).fill(email);
    await dialog.getByLabel("Senha", { exact: true }).fill(password);
    await dialog.getByLabel("Confirmar senha").fill(password);
    await dialog.getByRole("button", { name: "Criar minha conta" }).click();
    await dialog.getByRole("heading", { name: `Salve, ${name}.` }).waitFor();
  }
  async function save(alias, search, label) {
    await dialog.getByRole("button", { name: "Novo lugar" }).click();
    await dialog.getByLabel("Apelido").fill(alias);
    const input = dialog.getByRole("combobox", {
      name: "Buscar endereço para salvar",
    });
    await input.fill(search);
    await dialog.getByRole("option", { name: label }).waitFor();
    await input.press("ArrowDown");
    await input.press("Enter");
    await dialog
      .getByRole("button", { name: "Salvar lugar", exact: true })
      .click();
    await dialog.getByRole("button", { name: `Editar ${alias}` }).waitFor();
  }
  await register(firstEmail, "João");
  await save("Casa", "Teste A", home.label);
  await dialog.getByRole("button", { name: "Editar Casa" }).click();
  const editorInput = dialog.getByRole("combobox", {
    name: "Buscar endereço para salvar",
  });
  await editorInput.fill("Teste A editado");
  assert.equal(
    await editorInput.inputValue(),
    "Teste A editado",
    "Editing a saved address must retain typed text",
  );
  await dialog.getByRole("option", { name: home.label }).click();
  await dialog
    .getByRole("button", { name: "Salvar lugar", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Novo lugar" }).waitFor();
  await save("Trabalho", "Teste C", work.label);
  await page.screenshot({ path: "output/account-places-mobile.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await dialog.getByRole("button", { name: "Fechar conta" }).click();
  await page
    .getByRole("button", { name: "Abrir detalhes", exact: true })
    .click();
  const origin = page.getByRole("combobox", { name: "Buscar origem" });
  const destination = page.getByRole("combobox", { name: "Buscar destino" });
  const shortcuts = page.getByRole("region", { name: "Seus lugares salvos" });
  await shortcuts.getByRole("button", { name: "Origem", exact: true }).click();
  await shortcuts
    .getByRole("button", { name: "Usar Casa como origem" })
    .click();
  await shortcuts.getByRole("button", { name: "Destino", exact: true }).click();
  await shortcuts
    .getByRole("button", { name: "Usar Trabalho como destino" })
    .click();
  assert.equal(await origin.inputValue(), "Casa");
  assert.equal(await destination.inputValue(), "Trabalho");
  const beforeAliases = searches.length;
  await origin.fill("cása");
  await page.getByRole("option", { name: /Casa.*Rua Teste A/ }).waitFor();
  await origin.press("ArrowDown");
  await origin.press("Enter");
  await destination.fill("Trabalho");
  await page.getByRole("option", { name: /Trabalho.*Rua Teste C/ }).click();
  const planRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/plans"),
  );
  await page.getByRole("button", { name: "Encontrar rotas" }).click();
  const payload = (await planRequest).postDataJSON();
  assert.deepEqual(payload.from, home.point);
  assert.deepEqual(payload.to, work.point);
  assert.equal(
    searches.length,
    beforeAliases,
    "Saved aliases must not be sent to geocoding providers",
  );
  const favorite = page
    .getByRole("button", { name: "Favoritar Ônibus 104", exact: true })
    .first();
  await favorite.waitFor();
  await favorite.click();
  await page
    .getByRole("button", { name: "Remover Ônibus 104", exact: true })
    .first()
    .waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Abrir minha conta" }).click();
  await dialog.getByRole("button", { name: "Editar Casa" }).waitFor();
  await dialog.getByRole("tab", { name: "Linhas", exact: true }).click();
  await dialog.getByRole("button", { name: "Excluir Ônibus 104" }).waitFor();
  const lineSearch = dialog.getByRole("searchbox", {
    name: "Buscar linha para favoritar",
  });
  await lineSearch.fill("22");
  await dialog
    .getByRole("button", { name: "Favoritar BRT 22", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Excluir BRT 22", exact: true })
    .waitFor();
  await lineSearch.fill("2");
  await dialog
    .getByRole("button", { name: "Favoritar Metrô 2", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Excluir Metrô 2", exact: true })
    .waitFor();
  await dialog
    .getByText("Horários estimados nas rotas. Não há GPS público de trens.")
    .waitFor();
  await dialog
    .getByRole("button", { name: "Excluir BRT 22", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Excluir BRT 22", exact: true })
    .waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "output/account-lines-desktop.png" });
  await dialog.getByRole("tab", { name: "Conta", exact: true }).click();
  await dialog.getByRole("button", { name: "Sair desta conta" }).click();
  await page.getByRole("button", { name: "Entrar ou criar conta" }).waitFor();
  assert.equal(
    await page.locator(".saved-shortcuts,.favorite-shortcuts").count(),
    0,
  );
  await page.getByRole("button", { name: "Entrar ou criar conta" }).click();
  await register(secondEmail, "Outra");
  assert.equal(
    await dialog.getByRole("button", { name: "Editar Casa" }).count(),
    0,
  );
  await dialog.getByRole("tab", { name: "Linhas", exact: true }).click();
  assert.equal(
    await dialog.getByRole("button", { name: "Excluir Ônibus 104" }).count(),
    0,
  );
  async function deleteAccount() {
    await dialog.getByRole("tab", { name: "Conta", exact: true }).click();
    await dialog.locator("summary", { hasText: "Excluir minha conta" }).click();
    await dialog.getByLabel("Confirme sua senha").fill(password);
    await dialog.getByRole("checkbox").check();
    await dialog
      .getByRole("button", { name: "Excluir minha conta", exact: true })
      .click();
    await page.getByRole("button", { name: "Entrar ou criar conta" }).waitFor();
  }
  await deleteAccount();
  await page.getByRole("button", { name: "Entrar ou criar conta" }).click();
  await dialog.getByLabel("E-mail", { exact: true }).fill(firstEmail);
  await dialog.getByLabel("Senha", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "Entrar na conta" }).click();
  await dialog.getByRole("button", { name: "Editar Casa" }).waitFor();
  await dialog.getByRole("button", { name: "Excluir Trabalho" }).click();
  await page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().endsWith("/api/account/saved"),
  );
  assert.equal(
    await dialog.getByRole("button", { name: "Editar Trabalho" }).count(),
    0,
  );
  await deleteAccount();
  assert.deepEqual(errors, []);
  console.log(
    `${process.env.BROWSER || "chromium"} accounts: signup, edit/save/reuse exact places, local aliases, route favorites, reload, login/logout, ownership and deletion passed.`,
  );
  await context.close();
} finally {
  await browser.close();
}
