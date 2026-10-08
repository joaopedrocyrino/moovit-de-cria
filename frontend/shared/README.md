# @cria/shared

Private React/TypeScript library consumed by client and admin. Each app's Vite
build compiles the source directly; the library has no separate deployment.

```text
src/
  components/   Function components + adjacent .module.css files
  layout/       Page layouts + adjacent .module.css files
  hooks/        React hooks (no styles)
  api/          API helpers and tests (no styles)
  pages/        Page components + adjacent .module.css files
  types.ts      API/journey contracts
  format.ts     BRL and Rio time formatting
  index.ts      Pure helpers, type exports and application name
```

Import UI and hooks through their individual package paths:

```tsx
import { Heading } from "@cria/shared/components/Heading";
import { PageLayout } from "@cria/shared/layout/PageLayout";
import { useDocumentTitle } from "@cria/shared/hooks/useDocumentTitle";
import { apiBaseUrl } from "@cria/shared/api/apiUrl";
import { WelcomePage } from "@cria/shared/pages/WelcomePage";
import { APP_NAME, brl } from "@cria/shared";
import type { Plan, Place } from "@cria/shared";
```

`@cria/shared/api-url` remains available for existing imports. The admin uses
`WelcomePage`, `PageLayout`, `Heading` and `useDocumentTitle` as a working example.

## Adding a component

Create `src/components/MyCard.tsx` and `src/components/MyCard.module.css`:

```tsx
import styles from "./MyCard.module.css";

export function MyCard() {
  return <section className={styles.card}>Content</section>;
}
```

```css
.card {
  padding: 1rem;
  border-radius: 0.75rem;
}
```

Consume it with `import { MyCard } from "@cria/shared/components/MyCard"`.
The wildcard exports already cover new files in these folders. CSS is imported
automatically; consumers don't import a separate stylesheet. Use the same pattern
for layouts and pages.

## Production bundles

- ESM exports allow unused JavaScript exports to be removed during production builds.
- Individual UI imports keep unrelated components and CSS outside the import graph.
  Keep the root `index.ts` for pure helpers/types; avoid a barrel exporting every styled component.
- `sideEffects: ["**/*.css"]` preserves styles of components that are used.
- CSS Modules scope class names. They do **not** remove unused selectors within an imported
  module. Statically imported components include their styles even when a render doesn't display them.
- For a page that should load on demand, use a dynamic import. Vite's CSS code splitting
  loads the page's CSS with its JavaScript chunk:

```tsx
import { lazy, Suspense } from "react";

const WelcomePage = lazy(() =>
  import("@cria/shared/pages/WelcomePage").then((module) => ({
    default: module.WelcomePage,
  })),
);

// <Suspense fallback={<p>Loading…</p>}><WelcomePage title="Hello world" /></Suspense>
```

`npm run test:shared-build` verifies real production bundles: helpers bring no UI
CSS, a single component excludes unrelated components/styles, and lazy page CSS
stays out of the initial HTML. CI runs this with the frontend tests.

Install from the repository root (`npm ci`). `npm run build:web` type-checks shared
and builds client/admin. See [Vite CSS Modules](https://vite.dev/guide/features.html#css-modules).
