import { ChevronDown, Plus, X } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useI18n } from "../../features/i18n/i18n-context";
import type { TabInfo } from "../../features/tabs/tabs-types";
import { clampMenuPosition } from "../app-utils";

let savedTabsScrollLeft = 0;
let revealTabPath: string | null = null;
const DRAG_THRESHOLD = 4;

export function TabsBarView({
  tabs,
  onTabClick,
  onTabClose,
  onTabsClose,
  onTabReorder,
  onNewFile,
}: {
  tabs: TabInfo[];
  onTabClick: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
  onTabsClose: (filePaths: string[]) => void;
  onTabReorder: (fromIndex: number, toIndex: number) => void;
  onNewFile: () => void;
}): ReactElement {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tabsListRef = useRef<HTMLDivElement | null>(null);
  const tabElsRef = useRef<HTMLElement[]>([]);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [overflowMenu, setOverflowMenu] = useState<{
    top: number;
    right: number;
    hiddenTabs: TabInfo[];
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tab: TabInfo } | null>(
    null,
  );

  tabElsRef.current = [];

  const updateOverflow = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    setHasOverflow(scroll.scrollWidth - scroll.clientWidth > 1);
  }, []);

  // Scroll listener and overflow observer only need to exist once for this
  // container's lifetime — re-creating them on every tab change (open/close/
  // switch) tears down and re-attaches the ResizeObserver far more often than
  // necessary and was a source of flaky overflow-state timing.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    const onScroll = () => {
      savedTabsScrollLeft = scroll.scrollLeft;
      updateOverflow();
    };

    scroll.addEventListener("scroll", onScroll);
    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(scroll);
    return () => {
      scroll.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  }, [updateOverflow]);

  // Restoring scroll position and revealing a just-picked tab, however, must
  // re-run whenever the tab list actually changes.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    requestAnimationFrame(() => {
      scroll.scrollLeft = savedTabsScrollLeft;
      updateOverflow();
      if (revealTabPath) {
        const target = tabElsRef.current.find((el) => el.dataset.path === revealTabPath);
        revealTabPath = null;
        target?.scrollIntoView({ inline: "nearest", block: "nearest" });
      }
    });
  }, [tabs, updateOverflow]);

  useEffect(() => {
    if (!overflowMenu && !contextMenu) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(".tabs-overflow-menu, .tabs-overflow, .tab-context-menu")) return;
      setOverflowMenu(null);
      setContextMenu(null);
    };
    const timer = window.setTimeout(() => document.addEventListener("mousedown", close), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", close);
    };
  }, [contextMenu, overflowMenu]);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const scroll = scrollRef.current;
    if (!scroll || scroll.scrollWidth <= scroll.clientWidth) return;
    const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (delta === 0) return;
    scroll.scrollLeft += delta;
    event.preventDefault();
  }, []);

  const openOverflowMenu = useCallback(
    (button: HTMLButtonElement): void => {
      if (overflowMenu) {
        setOverflowMenu(null);
        return;
      }
      const scroll = scrollRef.current;
      if (!scroll) return;

      const viewLeft = scroll.scrollLeft;
      const viewRight = viewLeft + scroll.clientWidth;
      const hiddenTabs = tabs.filter((_tab, i) => {
        const el = tabElsRef.current[i];
        if (!el) return false;
        const left = el.offsetLeft;
        const right = left + el.offsetWidth;
        return left < viewLeft - 1 || right > viewRight + 1;
      });

      const rect = button.getBoundingClientRect();
      setOverflowMenu({
        top: rect.bottom,
        right: window.innerWidth - rect.right,
        hiddenTabs,
      });
    },
    [overflowMenu, tabs],
  );

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, fromIndex: number): void => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest(".tab-close")) return;
      const tabEl = event.currentTarget;
      const tabsList = tabsListRef.current;
      if (!tabsList) return;

      const startX = event.clientX;
      const path = tabEl.dataset.path ?? "";
      let dragging = false;
      let targetIndex = fromIndex;
      let rects: { left: number; width: number; center: number }[] = [];
      let contentWidth = 0;
      let dragWidth = 0;
      let dragLeft = 0;

      const begin = () => {
        dragging = true;
        rects = tabElsRef.current.map((el) => {
          const left = el.offsetLeft;
          const width = el.offsetWidth;
          return { left, width, center: left + width / 2 };
        });
        contentWidth = tabsList.scrollWidth;
        dragWidth = rects[fromIndex].width;
        dragLeft = rects[fromIndex].left;

        tabEl.classList.add("dragging");
        tabsList.classList.add("reordering");
        tabElsRef.current.forEach((el) => {
          if (el !== tabEl) el.style.transition = "transform 0.18s ease";
        });
      };

      const update = (dx: number) => {
        const minDx = -dragLeft;
        const maxDx = contentWidth - dragWidth - dragLeft;
        const clamped = Math.max(minDx, Math.min(maxDx, dx));
        const draggedCenter = rects[fromIndex].center + clamped;

        let t = 0;
        for (let i = 0; i < rects.length; i++) {
          if (i === fromIndex) continue;
          if (rects[i].center < draggedCenter) t++;
        }
        targetIndex = t;

        tabEl.style.transform = `translateX(${clamped}px)`;

        tabElsRef.current.forEach((el, i) => {
          if (i === fromIndex) return;
          let shift = 0;
          if (fromIndex < targetIndex && i > fromIndex && i <= targetIndex) {
            shift = -dragWidth;
          } else if (fromIndex > targetIndex && i >= targetIndex && i < fromIndex) {
            shift = dragWidth;
          }
          el.style.transform = shift ? `translateX(${shift}px)` : "";
        });
      };

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        if (!dragging) {
          if (Math.abs(dx) < DRAG_THRESHOLD) return;
          begin();
        }
        update(dx);
      };

      const cleanup = () => {
        tabEl.classList.remove("dragging");
        tabsList.classList.remove("reordering");
        tabElsRef.current.forEach((el) => {
          el.style.transition = "";
          el.style.transform = "";
        });
      };

      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);

        if (!dragging) {
          onTabClick(path);
          return;
        }

        cleanup();
        if (targetIndex !== fromIndex) onTabReorder(fromIndex, targetIndex);
      };

      const onCancel = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
        if (dragging) cleanup();
      };

      try {
        tabEl.setPointerCapture(event.pointerId);
      } catch {
        // ignore — capture is a best-effort guard against the OS stealing the gesture
      }
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
    },
    [onTabClick, onTabReorder],
  );

  if (tabs.length === 0) {
    savedTabsScrollLeft = 0;
    return (
      <div className="tabs-bar tabs-bar-empty">
        <button
          type="button"
          className="tabs-new-file"
          title={t("tabs.newFile")}
          onClick={onNewFile}
        >
          <Plus className="lucide-icon" size={16} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("tabs-bar", hasOverflow && "has-overflow")}
      onWheel={handleWheel}
    >
      <div ref={scrollRef} className="tabs-scroll">
        <div ref={tabsListRef} className="tabs-list">
          {tabs.map((tab, index) => (
            <div
              key={tab.filePath}
              ref={(node) => {
                if (node) tabElsRef.current[index] = node;
              }}
              className={cn("tab", tab.isActive && "active", tab.isDirty && "dirty")}
              data-path={tab.filePath}
              title={tab.filePath}
              onPointerDown={(event) => startDrag(event, index)}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ x: event.clientX, y: event.clientY, tab });
                setOverflowMenu(null);
              }}
            >
              <span className="tab-name">{tab.fileName}</span>
              <span className="tab-indicator" />
              <span
                className="tab-close"
                onClick={(event) => {
                  event.stopPropagation();
                  onTabClose(tab.filePath);
                }}
              >
                <X className="lucide-icon" size={14} aria-hidden="true" />
              </span>
            </div>
          ))}
          <button
            type="button"
            className="tabs-new-file tabs-new-file-inline"
            title={t("tabs.newFile")}
            onClick={onNewFile}
          >
            <Plus className="lucide-icon" size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <button
        type="button"
        className="tabs-new-file tabs-new-file-pinned"
        title={t("tabs.newFile")}
        onClick={onNewFile}
      >
        <Plus className="lucide-icon" size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="tabs-overflow"
        title={t("tabs.showHidden")}
        onClick={(event) => {
          event.stopPropagation();
          openOverflowMenu(event.currentTarget);
        }}
      >
        <ChevronDown className="lucide-icon" size={16} aria-hidden="true" />
      </button>
      {overflowMenu
        ? createPortal(
            <TabsOverflowMenu
              {...overflowMenu}
              onSelect={(path) => {
                revealTabPath = path;
                setOverflowMenu(null);
                onTabClick(path);
              }}
            />,
            document.body,
          )
        : null}
      {contextMenu
        ? createPortal(
            <TabContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              tab={contextMenu.tab}
              tabs={tabs}
              onClose={() => setContextMenu(null)}
              onTabClose={onTabClose}
              onTabsClose={onTabsClose}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

function TabsOverflowMenu({
  top,
  right,
  hiddenTabs,
  onSelect,
}: {
  top: number;
  right: number;
  hiddenTabs: TabInfo[];
  onSelect: (path: string) => void;
}): ReactElement {
  const { t } = useI18n();
  return (
    <div className="tabs-overflow-menu" style={{ top, right }}>
      {hiddenTabs.length === 0 ? (
        <div className="tabs-overflow-empty">{t("tabs.noHidden")}</div>
      ) : (
        hiddenTabs.map((tab) => (
          <button
            key={tab.filePath}
            type="button"
            className={cn("tabs-overflow-item", tab.isActive && "active", tab.isDirty && "dirty")}
            title={tab.filePath}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(tab.filePath);
            }}
          >
            <span className="tabs-overflow-dot" />
            <span className="tabs-overflow-label">{tab.fileName}</span>
          </button>
        ))
      )}
    </div>
  );
}

function TabContextMenu({
  x,
  y,
  tab,
  tabs,
  onClose,
  onTabClose,
  onTabsClose,
}: {
  x: number;
  y: number;
  tab: TabInfo;
  tabs: TabInfo[];
  onClose: () => void;
  onTabClose: (filePath: string) => void;
  onTabsClose: (filePaths: string[]) => void;
}): ReactElement {
  const { t } = useI18n();
  const others = tabs.filter((tb) => tb.filePath !== tab.filePath).map((tb) => tb.filePath);
  const unmodified = tabs.filter((tb) => !tb.isDirty).map((tb) => tb.filePath);
  const all = tabs.map((tb) => tb.filePath);
  const items = [
    { label: t("tabs.close"), disabled: false, run: () => onTabClose(tab.filePath) },
    { label: t("tabs.closeOthers"), disabled: others.length === 0, run: () => onTabsClose(others) },
    { label: t("tabs.closeAll"), disabled: all.length === 0, run: () => onTabsClose(all) },
    {
      label: t("tabs.closeUnmodified"),
      disabled: unmodified.length === 0,
      run: () => onTabsClose(unmodified),
    },
  ];

  return (
    <div className="tab-context-menu" style={clampMenuPosition(x, y)}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className="tab-context-item"
          disabled={item.disabled}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
            item.run();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
