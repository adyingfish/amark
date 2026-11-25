import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { UserConfig } from "vite";
import { katexWoff2OnlyPlugin } from "./katex-woff2-only";

export const rendererConfig = {
  root: ".",
  plugins: [katexWoff2OnlyPlugin(), react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/electron/**",
        "**/dist-electron/**",
        "**/out/**",
        "**/release/**",
        "**/local/**",
      ],
    },
  },
  build: { target: "chrome150", minify: true, rolldownOptions: { input: "index.html" } },
} satisfies UserConfig;
