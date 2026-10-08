// Route the production artifact's API hostname to the disposable local API.
// Registered first so individual provider fixtures can override it afterwards.
export async function connectTestApi(page) {
  const origin = process.env.API_ORIGIN;
  if (!origin) return;
  const local = process.env.API_TEST_URL || "http://127.0.0.1:5193";
  const cors = {
    "access-control-allow-origin": new URL(process.env.BASE_URL).origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
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
