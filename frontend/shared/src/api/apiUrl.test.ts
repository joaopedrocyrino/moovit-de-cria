import { test } from "node:test";
import assert from "node:assert/strict";
import { apiBaseUrl } from "./apiUrl.ts";

test("local development uses Vite proxy", () =>
  assert.equal(apiBaseUrl(), "/api"));
test("Pages calls the Cloudflare API origin", () => {
  assert.equal(
    apiBaseUrl("https://moovit-api.joaocyrino.com"),
    "https://moovit-api.joaocyrino.com/api",
  );
  assert.equal(
    apiBaseUrl("https://moovit-api.joaocyrino.com/"),
    "https://moovit-api.joaocyrino.com/api",
  );
});
test("invalid origins fail instead of leaking requests to insecure endpoints", () => {
  for (const origin of [
    "http://example.com",
    "/api",
    "https://example.com/api",
    "https://user:pass@example.com",
    "https://example.com?token=secret",
    "https://example.com#fragment",
  ])
    assert.throws(() => apiBaseUrl(origin));
});
