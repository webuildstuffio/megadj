# deck/web — deliberately isolated dependency universe

`bun.lock` in this directory is **intentional**; do not fold `src/deck/web` into the root `workspaces` glob.

## Why isolated

- This package is **Preact** (`preact`, `@tanstack/preact-table`, `lucide-preact`); the root and `src/deck/src` tree carries no React at all. A shared workspace lock would drag two component ecosystems into one resolution graph for no shared gain.
- The web app is built by its own Vite config (`bun run web:build` from the root) and ships a self-contained bundle; its dependency versions never link into server code. The one shared surface — `src/deck/shared/types.ts`, the import leaf — is a **type-only** import, so version skew cannot bite at runtime.
- The bundle is **code-split** (#552): the entry chunk carries only the shell (~27 KB gz — rail, header, jobs dock, welcome); the five product canvases and the ⌘K palette load as async chunks on first navigation. The split is census-pinned (`test/app-lazy-chunks-census.test.tsx`); the shell imports `products/shared/product-meta` directly because the shared barrel re-exports beat-sync, whose table graph would drag the tanstack table back into first paint.

## The trade-off being accepted

Two lockfiles can drift. Accepted because resolution universes are disjoint (preact-here, nothing-there) and the shared leaf is compile-time only. If the web app ever imports server runtime code, revisit this.

## Formatting

`oxfmt --check` from the root gate covers this tree, including `styles/*.css` (oxfmt's directory walk includes CSS).
