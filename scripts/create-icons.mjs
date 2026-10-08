import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const svg = await readFile("frontend/client/public/icon.svg", "utf8");
  for (const size of [192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%}svg{width:100%;height:100%;display:block}</style>${svg}`,
    );
    await page.screenshot({ path: `frontend/client/public/icon-${size}.png` });
  }
} finally {
  await browser.close();
}
