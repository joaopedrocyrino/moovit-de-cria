import { isMain, runCli } from "./lib/runtime.mjs";

export async function main(urls = process.argv.slice(2)) {
  if (!urls.length) throw new Error("Provide at least one health endpoint.");
  for (const url of urls) {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    await response.body?.cancel();
    if (!response.ok)
      throw new Error("Health endpoint returned HTTP " + response.status);
  }
}
if (isMain(import.meta.url)) await runCli(main);
