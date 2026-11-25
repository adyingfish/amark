import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { katexWoff2OnlyPlugin } from "./build/katex-woff2-only";

export default defineConfig({
  plugins: [katexWoff2OnlyPlugin(), react(), tailwindcss()],
  test: { include: ["src/**/*.test.{ts,tsx}", "build/**/*.test.ts"] },
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
      ignored: ["**/electron/**", "**/release/**", "**/local/**"],
    },
  },
  build: { target: "chrome150" },
});
