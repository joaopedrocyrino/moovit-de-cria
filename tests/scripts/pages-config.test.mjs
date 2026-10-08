import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPagesConfig } from "../../scripts/check-pages-config.mjs";
function environment() {
  const env = Object.fromEntries(
    [
      "DEPLOY_HOST",
      "DEPLOY_USER",
      "DEPLOY_SSH_KEY",
      "DEPLOY_SSH_KNOWN_HOSTS",
      "GHCR_USERNAME",
      "GHCR_TOKEN",
      "CLOUDFLARE_API_TOKEN",
    ].map((key) => [key, "test-value"]),
  );
  return { ...env, CLOUDFLARE_ACCOUNT_ID: "a".repeat(32) };
}
const response = (branch) =>
  new Response(
    JSON.stringify({ success: true, result: { production_branch: branch } }),
  );
test("both main Pages projects are accepted", async () => {
  const requests = [];
  await checkPagesConfig(environment(), async (url, options) => {
    requests.push(url);
    assert.equal(options.headers.Authorization, "Bearer test-value");
    return response("main");
  });
  assert.deepEqual(
    requests,
    ["moovit-de-cria", "moovit-de-cria-admin"].map(
      (project) =>
        `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/pages/projects/${project}`,
    ),
  );
});
test("missing secret fails before any network request", async () => {
  const env = environment();
  delete env.CLOUDFLARE_API_TOKEN;
  await assert.rejects(
    checkPagesConfig(env, () => assert.fail("Unexpected network request")),
    /Missing production secret: CLOUDFLARE_API_TOKEN/,
  );
});
test("wrong production branch is rejected", async () => {
  await assert.rejects(
    checkPagesConfig(environment(), async () => response("staging")),
    /production branch main/,
  );
});
test("provider errors never expose response contents or tokens", async () => {
  for (const request of [
    async () => {
      throw new Error("test-value");
    },
    async () => new Response("test-value", { status: 403 }),
    async () => new Response("test-value"),
  ]) {
    await assert.rejects(checkPagesConfig(environment(), request), (error) => {
      assert.ok(!error.message.includes("test-value"));
      assert.match(error.message, /Cannot access the Pages project/);
      return true;
    });
  }
});
test("missing admin project blocks the deployment preflight", async () => {
  let count = 0;
  await assert.rejects(
    checkPagesConfig(environment(), async () => {
      if (count++ === 0) return response("main");
      throw new Error("provider failure");
    }),
    /Cannot access the Pages project moovit-de-cria-admin/,
  );
});
test("apps cannot overwrite the same Pages project", async () => {
  await assert.rejects(
    checkPagesConfig(
      { ...environment(), CLOUDFLARE_ADMIN_PAGES_PROJECT: "moovit-de-cria" },
      () => assert.fail("Unexpected request"),
    ),
    /different Pages projects/,
  );
});
