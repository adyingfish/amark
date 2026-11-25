import { defineConfig } from "vite-plus";
import { rendererConfig } from "./build/renderer-config";

export default defineConfig({
  ...rendererConfig,
  test: { include: ["src/**/*.test.{ts,tsx}", "build/**/*.test.ts"] },
  staged: {
    "**/*.{css,html,js,json,jsx,md,mdx,mts,ts,tsx,yaml,yml}": "vp check --fix",
  },
});
