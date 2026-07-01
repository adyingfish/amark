// main.ts - Entry point for AMark Phase 2
// Tailwind/shadcn tokens load first so the app's own theme CSS still wins on conflicts.
import "./styles/globals.css";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { I18nProvider } from "./features/i18n/i18n-context";
import "./themes/base.css";
import "./themes/workspace.css";

const rootEl = document.getElementById("app");
if (!rootEl) throw new Error("App container not found");

createRoot(rootEl).render(createElement(I18nProvider, null, createElement(App)));
