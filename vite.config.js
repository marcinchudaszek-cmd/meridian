import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Wersja web: https://beagleapps.pl/apps/meridian/ (`npm run build:web` → dist-web/, z service workerem).
// Android: `npm run build:android` → dist/ (bez service workera — pliki są w APK).
export default defineConfig(({ mode }) => ({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    outDir: mode === "web" ? "dist-web" : "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5190, strictPort: true },
}));
