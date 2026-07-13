// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildHtmlDocument } from "./export-document";

describe("buildHtmlDocument", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.className = "theme-academic";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("embeds local font assets so the exported HTML is self-contained", async () => {
    const css = '@font-face { font-family: Test; src: url("/assets/test.woff2") format("woff2"); }';
    vi.spyOn(document, "styleSheets", "get").mockReturnValue([
      { cssRules: [{ cssText: css }], href: document.baseURI },
    ] as unknown as StyleSheetList);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([0, 1, 2, 255]).buffer,
    } as Response);

    const html = await buildHtmlDocument("<p>formula</p>", "Math");

    expect(fetchMock).toHaveBeenCalledWith(new URL("/assets/test.woff2", document.baseURI).href);
    expect(html).toContain('url("data:font/woff2;base64,AAEC/w==")');
    expect(html).not.toContain("/assets/test.woff2");
  });

  it("leaves non-font stylesheet URLs alone", async () => {
    const css = '.cover { background-image: url("/assets/cover.png"); }';
    vi.spyOn(document, "styleSheets", "get").mockReturnValue([
      { cssRules: [{ cssText: css }], href: document.baseURI },
    ] as unknown as StyleSheetList);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const html = await buildHtmlDocument("<p>content</p>", "Title");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(html).toContain("/assets/cover.png");
  });
});
