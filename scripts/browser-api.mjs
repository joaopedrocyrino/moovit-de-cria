// Route the production artifact's API hostname to the disposable local API.
// Registered first so individual provider fixtures can override it afterwards.
export async function connectTestApi(
  page,
  frontendOrigin = new URL(process.env.BASE_URL || "http://127.0.0.1:5193")
    .origin,
) {
  const origin = process.env.API_ORIGIN;
  if (!origin) return;
  const local = process.env.API_TEST_URL || "http://127.0.0.1:5193";
  const cors = {
    "access-control-allow-origin": frontendOrigin,
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, x-csrf-token",
    "access-control-allow-credentials": "true",
  };
  await page.route(origin + "/api/**", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: local + url.pathname + url.search,
    });
    await route.fulfill({
      response,
      headers: { ...response.headers(), ...cors },
    });
  });
}

// Preview the exact Pages artifact under its HTTPS site so Secure/SameSite cookie
// behavior is exercised by every client suite, including consent on public routes.
export async function connectTestSite(page) {
  const base = process.env.BASE_URL || "http://127.0.0.1:5193";
  const site = process.env.API_ORIGIN
    ? `https://${process.env.APP_HOSTNAME || "moovit.joaocyrino.com"}`
    : base;
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
  return site;
}
