import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const repository = fileURLToPath(new URL("../", import.meta.url));
const fixture = await realpath(
  await mkdtemp(path.join(tmpdir(), "cria-shared-build-")),
);
try {
  await symlink(
    path.join(repository, "node_modules"),
    path.join(fixture, "node_modules"),
    "dir",
  );
  await writeFile(path.join(fixture, "package.json"), '{"type":"module"}');
  await writeFile(
    path.join(fixture, "index.html"),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>',
  );

  async function bundle(source) {
    await writeFile(path.join(fixture, "main.tsx"), source);
    const result = await build({
      configFile: false,
      root: fixture,
      logLevel: "silent",
      esbuild: { jsx: "automatic" },
      build: { write: false, cssCodeSplit: true },
    });
    assert.ok(!Array.isArray(result) && "output" in result);
    return result.output;
  }

  const styles = (output) =>
    output.filter(
      (item) => item.type === "asset" && item.fileName.endsWith(".css"),
    );
  const modules = (output) =>
    output.flatMap((item) =>
      item.type === "chunk" ? Object.keys(item.modules) : [],
    );
  const html = (output) =>
    String(
      output.find(
        (item) => item.type === "asset" && item.fileName === "index.html",
      ).source,
    );

  const helpers = await bundle(`
    import { apiBaseUrl } from "@cria/shared";
    document.getElementById("root").textContent = apiBaseUrl();
  `);
  assert.equal(
    styles(helpers).length,
    0,
    "API-only consumers must not load shared UI styles.",
  );
  assert.ok(
    !modules(helpers).some((name) =>
      /shared\/src\/(components|layout|pages)\//.test(name),
    ),
  );

  const heading = await bundle(`
    import { createRoot } from "react-dom/client";
    import { Heading } from "@cria/shared/components/Heading";
    createRoot(document.getElementById("root")).render(<Heading>Hello world</Heading>);
  `);
  assert.ok(
    modules(heading).some((name) => name.endsWith("/components/Heading.tsx")),
  );
  assert.ok(
    !modules(heading).some((name) =>
      /shared\/src\/(layout|pages)\//.test(name),
    ),
    "Unused layouts/pages must be excluded.",
  );
  assert.equal(
    styles(heading).length,
    1,
    "Used component styles must be preserved.",
  );
  const headingCss = String(styles(heading)[0].source);
  assert.match(headingCss, /clamp\(2rem,\s*8vw,\s*4rem\)/);
  assert.ok(
    !headingCss.includes("100dvh"),
    "Unused layout CSS must be excluded.",
  );

  const lazy = await bundle(`
    window.loadWelcomePage = () => import("@cria/shared/pages/WelcomePage");
  `);
  assert.ok(
    lazy.some((item) => item.type === "chunk" && item.isDynamicEntry),
    "The page must have a separate JavaScript chunk.",
  );
  assert.ok(styles(lazy).length > 0, "The lazy page must retain its styles.");
  assert.doesNotMatch(
    html(lazy),
    /rel="stylesheet"/,
    "Lazy page CSS must not be loaded by the initial HTML.",
  );
  assert.ok(
    styles(lazy).some((item) => String(item.source).includes("100dvh")),
  );

  console.log(
    "Shared production bundles passed: helpers have no UI CSS, component imports exclude unused UI/CSS, lazy page CSS loads separately.",
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}
