import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

// app/ holds the entry (index.html + main.tsx); everything else is feature
// folders (ui/, products/<name>/, styles/). Build output is dist/, which the
// Bun server serves — run `bun run web:build` after web changes.
export default defineConfig({
  plugins: [preact()],
  root: "app",
  server: {
    port: 7743,
    proxy: {
      "/api": "http://127.0.0.1:7742",
      "/photos": "http://127.0.0.1:7742",
    },
  },
  build: { outDir: "../dist" },
});
