import type { MarkdownOutlineItem } from "../features/outline/markdown-outline";
import type { EditorViewMode } from "../ui/view-mode-switch";

interface OutlineNavigationOptions {
  heading: MarkdownOutlineItem;
  mode: EditorViewMode;
  source: HTMLTextAreaElement | null;
  richHost: HTMLElement | null;
}

function scrollSourceToHeading(source: HTMLTextAreaElement, heading: MarkdownOutlineItem): void {
  source.focus();
  source.setSelectionRange(heading.offset, heading.offset);
  const styles = window.getComputedStyle(source);
  const fontSize = Number.parseFloat(styles.fontSize) || 16;
  const lineHeight = Number.parseFloat(styles.lineHeight) || fontSize * 1.5;
  source.scrollTo({
    top: Math.max(0, (heading.line - 1) * lineHeight - source.clientHeight * 0.2),
    behavior: "smooth",
  });
}

function scrollRichViewToHeading(richHost: HTMLElement, heading: MarkdownOutlineItem): void {
  const richSurface =
    richHost.querySelector<HTMLElement>(".ProseMirror.amark-typeset-mirror") ??
    richHost.querySelector<HTMLElement>(".ProseMirror:not(.amark-typeset-mirror)");
  const renderedHeading =
    richSurface?.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")[heading.headingIndex];
  renderedHeading?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function navigateToOutlineHeading({
  heading,
  mode,
  source,
  richHost,
}: OutlineNavigationOptions): void {
  if ((mode === "source" || mode === "split") && source) {
    scrollSourceToHeading(source, heading);
  }

  if (mode !== "source" && richHost) {
    scrollRichViewToHeading(richHost, heading);
  }
}
