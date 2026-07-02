import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://tauri.app/reference/config/#devurl
export default defineConfig({
  plugins: [react(), tailwindcss()],
  staged: {
    "**/*.{css,html,js,json,jsx,md,mdx,ts,tsx,yaml,yml}": "vp check --fix",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // tell vite to ignore watching src-tauri
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15",
    // don't minify for debug builds
    minify: !process.env.TAURI_ENV_DEBUG ? "oxc" : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
