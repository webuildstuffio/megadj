import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 7743,
    proxy: {
      "/api": "http://127.0.0.1:7742",
      "/photos": "http://127.0.0.1:7742",
    },
  },
  build: { outDir: "dist" },
});
