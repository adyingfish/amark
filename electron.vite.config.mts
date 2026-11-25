import { defineConfig } from "electron-vite";
import { rendererConfig } from "./build/renderer-config";

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        input: { main: "electron/main.ts", "workspace-search": "electron/workspace-search.ts" },
        output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js" },
      },
    },
  },
  preload: {
    build: {
      rolldownOptions: { input: "electron/preload.ts", output: { entryFileNames: "preload.js" } },
    },
  },
  renderer: rendererConfig,
});
