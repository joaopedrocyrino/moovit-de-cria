import { chromium, webkit } from "@playwright/test";
import assert from "node:assert/strict";
// Deterministic UI-only fixtures; backend routing/GPS filtering have separate .NET tests.
const stop = (id, name, lat, lon) => ({ id, name, point: { lat, lon } });
const a = stop("a", "Recreio", -23.026, -43.466),
  b = stop("b", "Gláucio Gil", -23.008, -43.438),
  c = stop("metro:w6w5", "Jardim Oceânico", -23.007, -43.31),
  d = stop("metro:w1w15", "Botafogo", -22.95, -43.184);
const ride = (line, mode, from, to) => ({
  kind: "transit",
  routeId:
    mode === "metro" ? "metro:1/4" : line === "361" ? "O0361AAA0A" : "brt:18",
  line,
  mode,
  headsign:
    mode === "metro"
      ? "Uruguai"
      : line === "361"
        ? "Castelo"
        : "Jardim Oceânico",
  direction: 0,
  shapeId: null,
  start: new Date().toISOString(),
  end: new Date(Date.now() + 1200000).toISOString(),
  from,
  to,
  stops: [from, to],
  fareCents: mode === "metro" ? 790 : 500,
  municipal: mode !== "metro",
  estimated: true,
});
const legs = [
  ride("361", "bus", a, b),
  ride("18", "brt", b, c),
  ride("1/4", "metro", c, d),
];
const itinerary = (id, parts) => ({
  id,
  durationMinutes: 90,
  transfers: parts.length - 1,
  walkMinutes: 5,
  departure: parts[0].start,
  arrival: parts.at(-1).end,
  fare: { cents: 1790, label: "Teste", notes: [] },
  legs: parts,
});
const plans = {
  itineraries: [
    itinerary("metro-connection", legs),
    itinerary("bus-alternative", [legs[0], ride("18", "brt", b, d)]),
  ],
  notices: [],
  source: "Browser fixture",
  importedAt: "test",
};
const lineRoutes = plans.itineraries.filter(
  (r) => r.legs.find((l) => l.kind === "transit")?.line === "361",
);
assert.ok(lineRoutes.length >= 2);
const leg = lineRoutes[0].legs.find((l) => l.kind === "transit");
const engines =
  process.env.BROWSER === "all"
    ? [
        ["chromium", chromium],
        ["webkit", webkit],
      ]
    : process.env.BROWSER === "webkit"
      ? [["webkit", webkit]]
      : [["chromium", chromium]];
for (const [name, engine] of engines) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
      permissions: ["geolocation"],
      geolocation: {
        latitude: -23.0262518,
        longitude: -43.4659924,
        accuracy: 10,
      },
    });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const planRequests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
    await page.route("**/api/places/reverse", (r) =>
      r.fulfill({
        json: {
          label: "Rua Nilton Fontoura Reis",
          point: { lat: -23.0262518, lon: -43.4659924 },
        },
      }),
    );
    await page.route("**/api/places/search", (r) =>
      r.fulfill({
        json: [
          {
            label: "Chora Café, Botafogo",
            point: { lat: -22.9566277, lon: -43.1837086 },
          },
        ],
      }),
    );
    await page.route("**/api/plans", (r) => {
      planRequests.push(r.request().postDataJSON());
      return r.fulfill({ json: plans });
    });
    await page.route("**/api/vehicles?**", (r) => {
      const line = new URL(r.request().url()).searchParams.get("line");
      requests.push(line);
      const row = (id, dir, route = leg.routeId, point = leg.from.point) => ({
        id,
        line,
        routeId: route,
        direction: dir,
        point,
        observedAt: new Date().toISOString(),
        source: "test",
        speed: 0,
        bearing: null,
      });
      const vehicles =
        line === "361"
          ? [
              row("A", leg.direction),
              row("B", leg.direction),
              row("C", 1 - leg.direction),
              row("D", null),
            ]
          : line === "18"
            ? [
                row("E", 0, "brt:18", c.point),
                row("F", 1, "brt:18", b.point),
                row("G", null, "brt:18", b.point),
              ]
            : [];
      return r.fulfill({
        json: {
          vehicles,
          status: vehicles.length ? "live" : "empty",
          checkedAt: new Date().toISOString(),
          message: null,
          lineCount: vehicles.length,
          unknownDirectionCount: line === "361" ? 1 : 0,
        },
      });
    });
    await page.goto(process.env.BASE_URL || "http://127.0.0.1:5193");
    const destination = page.getByRole("combobox", { name: "Buscar destino" });
    await destination.waitFor();
    assert.equal(
      await page.getByRole("combobox", { name: "Buscar origem" }).count(),
      0,
      "Compact mobile search has only the destination field",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Abrir detalhes" })
        .getAttribute("aria-expanded"),
      "false",
    );
    await destination.fill("Chora cafe");
    await page.getByRole("option", { name: /Chora Café/ }).click();
    await page.getByRole("button", { name: "Encontrar rotas" }).click();
    await page.locator(".route-card").first().waitFor();
    assert.equal(
      planRequests.at(-1).departure,
      undefined,
      "Now is the default",
    );
    assert.equal(planRequests.at(-1).arriveBy, undefined);
    const mode = page.getByLabel("Quando viajar");
    await mode.selectOption("departure");
    const when = page.getByLabel("Data e hora no Rio de Janeiro");
    const rioTime = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(new Date(Date.now() + 86400000))
      .replace(" ", "T");
    await when.fill(rioTime);
    await page.getByRole("button", { name: "Encontrar rotas" }).click();
    await page.waitForFunction(() =>
      document
        .querySelector(".plan-button")
        ?.textContent?.includes("Encontrar rotas"),
    );
    assert.equal(
      planRequests.at(-1).departure,
      new Date(rioTime + ":00-03:00").toISOString(),
    );
    assert.equal(planRequests.at(-1).arriveBy, undefined);
    await mode.selectOption("arrival");
    await page.getByRole("button", { name: "Encontrar rotas" }).click();
    await page.getByText("Saída mais tarde", { exact: true }).waitFor();
    assert.equal(
      planRequests.at(-1).arriveBy,
      new Date(rioTime + ":00-03:00").toISOString(),
    );
    assert.equal(planRequests.at(-1).departure, undefined);
    async function dragHandle(distance) {
      await page.locator(".bottom-sheet").evaluate(async (el) => {
        await Promise.all(
          el.getAnimations().map((animation) => animation.finished),
        );
      });
      const box = await page.locator(".sheet-handle").boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2,
        box.y + box.height / 2 + distance,
        { steps: 10 },
      );
      await page.mouse.up();
    }
    await dragHandle(110);
    await page.locator(".bottom-sheet.collapsed").waitFor();
    assert.equal(
      await page.getByRole("combobox", { name: "Buscar origem" }).count(),
      0,
    );
    assert.match(
      await destination.inputValue(),
      /Chora Café/,
      "Collapsing preserves the selected destination",
    );
    await dragHandle(-100);
    await page.locator(".bottom-sheet.expanded").waitFor();
    assert.equal(
      await mode.inputValue(),
      "arrival",
      "Collapsing preserves the selected travel time",
    );
    await mode.selectOption("now");
    await page.getByRole("button", { name: "Encontrar rotas" }).click();
    await page.getByText("Mais rápida encontrada", { exact: true }).waitFor();
    const cardIndex = plans.itineraries.indexOf(lineRoutes[0]);
    await page.locator(".route-card").nth(cardIndex).click();
    await page.locator(".bottom-sheet.collapsed").waitFor();
    await page
      .getByRole("button", { name: "Abrir detalhes da viagem" })
      .getByText("Vá até Recreio", { exact: true })
      .waitFor();
    if (process.env.TRANSIT_SCREENSHOT_DIR) {
      await page.waitForFunction(
        () => document.querySelectorAll(".vehicle-dot").length === 3,
      );
      await page.screenshot({
        path: `${process.env.TRANSIT_SCREENSHOT_DIR}/${name}-compact-fleet.png`,
      });
    }
    await page
      .getByRole("button", { name: "Abrir detalhes da viagem" })
      .click();
    await page
      .getByText(/2 neste sentido e variação · 4 na linha inteira/)
      .waitFor();
    assert.equal(await page.locator(".vehicle-list button").count(), 2);
    await page.waitForFunction(
      () => document.querySelectorAll(".vehicle-dot").length === 3,
    );
    const vehicleColors = await page
      .locator(".vehicle-dot")
      .evaluateAll((elements) =>
        elements.map((el) => el.style.getPropertyValue("--vehicle-color")),
      );
    assert.equal(
      new Set(vehicleColors).size,
      2,
      "Every bus/BRT line has its own marker color",
    );
    const routeColors = await page
      .locator(".leaflet-overlay-pane path[stroke-width='7']")
      .evaluateAll((elements) =>
        elements.map((el) => el.getAttribute("stroke")),
      );
    assert.ok(
      vehicleColors.every((color) => routeColors.includes(color)),
      "Markers match their route path color",
    );
    const markerLabels = await page
      .locator(".vehicle-dot")
      .evaluateAll((elements) =>
        elements.map((el) => el.style.backgroundColor),
      );
    assert.equal(
      markerLabels.length,
      3,
      "Opposite and unknown directions are excluded",
    );
    assert.equal(
      requests.includes("18"),
      true,
      "All journey lines load immediately",
    );
    if (process.env.TRANSIT_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.TRANSIT_SCREENSHOT_DIR}/${name}-all-lines.png`,
      });
    await page.getByRole("button", { name: "Outras rotas" }).click();
    await page
      .locator(".route-card")
      .nth(plans.itineraries.indexOf(lineRoutes[1]))
      .click();
    await page
      .getByRole("button", { name: "Abrir detalhes da viagem" })
      .click();
    await page
      .getByText(/2 neste sentido e variação · 4 na linha inteira/)
      .waitFor();
    assert.equal(
      requests.filter((l) => l === "361").length,
      1,
      "Same-line route alternatives reuse one browser snapshot",
    );
    await page.getByRole("button", { name: "Outras rotas" }).click();
    await page.locator(".route-card").nth(cardIndex).click();
    await page
      .getByRole("button", { name: "Abrir detalhes da viagem" })
      .click();
    await page.getByRole("button", { name: "Já embarquei" }).click();
    await page.locator(".bottom-sheet.collapsed").waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Abrir detalhes da viagem" })
        .isVisible(),
      true,
      "Boarding collapses to the live journey status",
    );
    await page
      .getByRole("button", { name: "Abrir detalhes da viagem" })
      .click();
    await page.getByRole("button", { name: "Desci · próxima conexão" }).click();
    await page.getByRole("heading", { name: "BRT 18" }).waitFor();
    await page.getByRole("button", { name: "Já embarquei" }).click();
    await page
      .getByRole("button", { name: "Abrir detalhes da viagem" })
      .click();
    await page.getByRole("button", { name: "Desci · próxima conexão" }).click();
    await page.getByRole("heading", { name: "Metrô 1/4" }).waitFor();
    await page.getByText(/Metrô sem posição de trens em tempo real/).waitFor();
    assert.equal(
      requests.includes("1/4"),
      false,
      "Metro must not query bus GPS",
    );
    assert.equal(
      await page.locator(".vehicle-dot").count(),
      3,
      "All journey bus/BRT positions stay visible during the metro stage",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    if (process.env.TRANSIT_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.TRANSIT_SCREENSHOT_DIR}/${name}-metro.png`,
        fullPage: true,
      });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("heading", { name: "Metrô 1/4" }).waitFor();
    await page.waitForFunction(() => !document.querySelector(".sheet-handle"));
    assert.equal(
      await page.locator(".sheet-handle").count(),
      0,
      "Desktop keeps the full sidebar",
    );
    if (process.env.TRANSIT_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.TRANSIT_SCREENSHOT_DIR}/${name}-desktop.png`,
      });
    assert.deepEqual(errors, []);
    console.log(
      name +
        ": travel times, draggable panel, all-line colors, direction filtering and transfers passed",
    );
  } finally {
    await browser.close();
  }
}
