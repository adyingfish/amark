const themes: Record<string, string> = {
  light: "theme-light",
  dark: "theme-dark",
  literary: "theme-literary",
  newsprint: "theme-newsprint",
  academic: "theme-academic",
};

let customStyleEl: HTMLStyleElement | null = null;

export function applyTheme(name: string, customCSS?: string): void {
  const body = document.body;

  Object.values(themes).forEach((cls) => body.classList.remove(cls));
  body.classList.remove("theme-custom");

  if (customStyleEl) {
    customStyleEl.remove();
    customStyleEl = null;
  }

  if (customCSS || name.startsWith("custom:")) {
    if (customCSS) {
      customStyleEl = document.createElement("style");
      customStyleEl.textContent = customCSS;
      document.head.appendChild(customStyleEl);
    }
    body.classList.add("theme-custom");
  } else if (themes[name]) {
    body.classList.add(themes[name]);
  }

  localStorage.setItem("amark-theme", name);
}

export function loadSavedTheme(): string {
  return localStorage.getItem("amark-theme") || "literary";
}
