import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "../../features/i18n/i18n-context";
import { languageStore } from "../../features/i18n/language-store";
import type { Locale } from "../../features/i18n/translations";
import { getShowHiddenFiles } from "../../features/workspace/workspace-preferences";
import { runMenuAction } from "../../ui/menu-bar";

interface MenuItemDef {
  kind: "item";
  label: string;
  shortcut?: string;
  run: () => void;
}

interface SeparatorDef {
  kind: "separator";
}

interface MenuDef {
  label: string;
  items: () => Array<MenuItemDef | SeparatorDef> | Promise<Array<MenuItemDef | SeparatorDef>>;
}

export function MenuBar(): ReactElement {
  const { locale, t } = useI18n();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [items, setItems] = useState<Array<MenuItemDef | SeparatorDef>>([]);
  const [left, setLeft] = useState(0);
  const barRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const setLocale = useCallback((next: Locale) => languageStore.setLocale(next), []);

  const menus = useMemo<MenuDef[]>(
    () => [
      {
        label: t("menu.file"),
        items: () => [
          {
            kind: "item",
            label: t("menu.file.new"),
            shortcut: "Ctrl+N",
            run: () => runMenuAction("new"),
          },
          {
            kind: "item",
            label: t("menu.file.open"),
            shortcut: "Ctrl+O",
            run: () => runMenuAction("menu-open"),
          },
          {
            kind: "item",
            label: t("menu.file.openFolder"),
            shortcut: "Ctrl+Shift+O",
            run: () => runMenuAction("menu-open-folder"),
          },
          {
            kind: "item",
            label: t("menu.file.openFolderByPath"),
            run: () => runMenuAction("menu-open-folder-path"),
          },
          { kind: "separator" },
          {
            kind: "item",
            label: t("menu.file.save"),
            shortcut: "Ctrl+S",
            run: () => runMenuAction("menu-save"),
          },
          {
            kind: "item",
            label: t("menu.file.saveAs"),
            shortcut: "Ctrl+Shift+S",
            run: () => runMenuAction("menu-save-as"),
          },
          { kind: "separator" },
          {
            kind: "item",
            label: t("menu.file.exportPdf"),
            run: () => runMenuAction("menu-export-pdf"),
          },
          {
            kind: "item",
            label: t("menu.file.exportHtml"),
            run: () => runMenuAction("menu-export-html"),
          },
          { kind: "separator" },
          { kind: "item", label: t("menu.file.close"), run: () => void getCurrentWindow().close() },
        ],
      },
      {
        label: t("menu.edit"),
        items: () => [
          {
            kind: "item",
            label: t("menu.edit.undo"),
            shortcut: "Ctrl+Z",
            run: () => document.execCommand("undo"),
          },
          {
            kind: "item",
            label: t("menu.edit.redo"),
            shortcut: "Ctrl+Shift+Z",
            run: () => document.execCommand("redo"),
          },
          { kind: "separator" },
          {
            kind: "item",
            label: t("menu.edit.cut"),
            shortcut: "Ctrl+X",
            run: () => document.execCommand("cut"),
          },
          {
            kind: "item",
            label: t("menu.edit.copy"),
            shortcut: "Ctrl+C",
            run: () => document.execCommand("copy"),
          },
          {
            kind: "item",
            label: t("menu.edit.paste"),
            shortcut: "Ctrl+V",
            run: () => document.execCommand("paste"),
          },
          {
            kind: "item",
            label: t("menu.edit.selectAll"),
            shortcut: "Ctrl+A",
            run: () => document.execCommand("selectAll"),
          },
        ],
      },
      {
        label: t("menu.view"),
        items: () => [
          {
            kind: "item",
            label: t("menu.view.zoomIn"),
            shortcut: "Ctrl+=",
            run: () => runMenuAction("view-zoom-in"),
          },
          {
            kind: "item",
            label: t("menu.view.zoomOut"),
            shortcut: "Ctrl+-",
            run: () => runMenuAction("view-zoom-out"),
          },
          {
            kind: "item",
            label: t("menu.view.actualSize"),
            shortcut: "Ctrl+0",
            run: () => runMenuAction("view-zoom-reset"),
          },
          { kind: "separator" },
          {
            kind: "item",
            label: t("menu.view.fullscreen"),
            shortcut: "F11",
            run: () => runMenuAction("view-fullscreen"),
          },
          { kind: "separator" },
          {
            kind: "item",
            label: `${getShowHiddenFiles() ? "✓ " : ""}${t("menu.view.showHidden")}`,
            run: () => runMenuAction("view-toggle-hidden-files"),
          },
          { kind: "separator" },
          {
            kind: "item",
            label: `${locale === "zh" ? "✓ " : ""}中文`,
            run: () => setLocale("zh"),
          },
          {
            kind: "item",
            label: `${locale === "en" ? "✓ " : ""}English`,
            run: () => setLocale("en"),
          },
        ],
      },
      {
        label: t("menu.theme"),
        items: async () => {
          const built: Array<MenuItemDef | SeparatorDef> = [
            { kind: "item", label: t("menu.theme.light"), run: () => runMenuAction("theme-light") },
            { kind: "item", label: t("menu.theme.dark"), run: () => runMenuAction("theme-dark") },
            {
              kind: "item",
              label: t("menu.theme.literary"),
              run: () => runMenuAction("theme-literary"),
            },
            {
              kind: "item",
              label: t("menu.theme.newsprint"),
              run: () => runMenuAction("theme-newsprint"),
            },
            {
              kind: "item",
              label: t("menu.theme.academic"),
              run: () => runMenuAction("theme-academic"),
            },
          ];

          const custom = await invoke<string[]>("list_custom_themes").catch(() => [] as string[]);
          if (custom.length > 0) {
            built.push({ kind: "separator" });
            for (const fileName of custom) {
              const label = fileName.replace(/\.css$/, "");
              built.push({
                kind: "item",
                label,
                run: () => runMenuAction(`theme-custom:${fileName}`),
              });
            }
          }

          built.push({ kind: "separator" });
          built.push({
            kind: "item",
            label: t("menu.theme.import"),
            run: () => runMenuAction("menu-import-theme"),
          });
          return built;
        },
      },
    ],
    [locale, setLocale, t],
  );

  const closeMenu = useCallback(() => {
    setOpenIndex(null);
    setItems([]);
  }, []);

  const openMenu = useCallback((index: number): void => {
    const button = buttonRefs.current[index];
    setOpenIndex(index);
    setLeft(button?.offsetLeft ?? 0);
  }, []);

  useEffect(() => {
    if (openIndex === null) return;
    let cancelled = false;
    Promise.resolve(menus[openIndex].items()).then((nextItems) => {
      if (!cancelled) setItems(nextItems);
    });
    return () => {
      cancelled = true;
    };
  }, [menus, openIndex]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (openIndex !== null && !barRef.current?.contains(event.target as Node)) closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && openIndex !== null) closeMenu();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeMenu, openIndex]);

  return (
    <div ref={barRef} className="menu-bar">
      {menus.map((menu, index) => (
        <button
          key={menu.label}
          ref={(node) => {
            buttonRefs.current[index] = node;
          }}
          type="button"
          className={cn("menu-button", openIndex === index && "open")}
          onClick={() => {
            if (openIndex === index) {
              closeMenu();
            } else {
              openMenu(index);
            }
          }}
          onMouseEnter={() => {
            if (openIndex !== null && openIndex !== index) openMenu(index);
          }}
        >
          {menu.label}
        </button>
      ))}
      <div className="menu-dropdown" hidden={openIndex === null} style={{ left }}>
        {items.map((item, index) =>
          item.kind === "separator" ? (
            <div key={`sep-${index}`} className="menu-separator" />
          ) : (
            <button
              key={`${item.label}-${index}`}
              type="button"
              className="menu-entry"
              onClick={() => {
                closeMenu();
                item.run();
              }}
            >
              <span className="menu-entry-label">{item.label}</span>
              {item.shortcut ? <span className="menu-entry-shortcut">{item.shortcut}</span> : null}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
