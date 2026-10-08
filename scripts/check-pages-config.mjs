import { isMain, runCli } from "./lib/runtime.mjs";

export async function checkPagesConfig(env = process.env, request = fetch) {
  for (const key of [
    "DEPLOY_HOST",
    "DEPLOY_USER",
    "DEPLOY_SSH_KEY",
    "DEPLOY_SSH_KNOWN_HOSTS",
    "GHCR_USERNAME",
    "GHCR_TOKEN",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
  ])
    if (!env[key]) throw new Error("Missing production secret: " + key);
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const projects = [
    env.CLOUDFLARE_PAGES_PROJECT || "moovit-de-cria",
    env.CLOUDFLARE_ADMIN_PAGES_PROJECT || "moovit-de-cria-admin",
  ];
  if (
    !/^[a-fA-F0-9]{32}$/.test(account) ||
    projects.some((project) => !/^[a-z0-9][a-z0-9-]*$/.test(project))
  )
    throw new Error("Invalid Cloudflare account ID or Pages project name.");
  if (new Set(projects).size !== projects.length)
    throw new Error("Client and admin must use different Pages projects.");
  for (const project of projects) {
    let data;
    try {
      const response = await request(
        `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}`,
        {
          headers: { Authorization: "Bearer " + env.CLOUDFLARE_API_TOKEN },
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!response.ok) throw new Error("Provider error");
      data = await response.json();
    } catch {
      throw new Error(
        `Cannot access the Pages project ${project}. Check its name, account and Pages Edit token.`,
      );
    }
    if (!data?.success || data.result?.production_branch !== "main")
      throw new Error(
        `Create the Direct Upload Pages project ${project} with production branch main first.`,
      );
  }
  console.log(
    "Production configuration present; client and admin Pages projects use main.",
  );
}
if (isMain(import.meta.url)) await runCli(checkPagesConfig);
