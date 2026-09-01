const TEXTAREA_MIRROR_PROPERTIES = [
  "font",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "padding",
  "tabSize",
  "textAlign",
  "textIndent",
  "textTransform",
  "whiteSpace",
  "wordBreak",
  "overflowWrap",
] as const;

/** Scroll a textarea to a UTF-16 offset using its rendered, wrapped layout. */
export function scrollTextareaOffsetIntoView(textarea: HTMLTextAreaElement, offset: number): void {
  const document = textarea.ownerDocument;
  const styles = document.defaultView?.getComputedStyle(textarea);
  if (!document.body || !styles) return;

  const mirror = document.createElement("div");
  mirror.dataset.searchTextareaMirror = "true";
  mirror.style.position = "fixed";
  mirror.style.left = "-100000px";
  mirror.style.top = "0";
  mirror.style.boxSizing = "border-box";
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.height = "auto";
  mirror.style.border = "0";
  mirror.style.overflow = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.visibility = "hidden";

  for (const property of TEXTAREA_MIRROR_PROPERTIES) {
    mirror.style[property] = styles[property];
  }

  mirror.textContent = textarea.value.slice(
    0,
    Math.max(0, Math.min(offset, textarea.value.length)),
  );
  const marker = document.createElement("span");
  marker.dataset.searchTextareaMarker = "true";
  marker.style.display = "inline-block";
  marker.style.width = "0";
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const target = marker.offsetTop - textarea.clientHeight * 0.3;
  const maxScrollTop = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
  textarea.scrollTop = Math.max(0, Math.min(target, maxScrollTop));
  mirror.remove();
}
