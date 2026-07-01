import { describe, expect, it } from "vitest";
import { findLinkAtPosition } from "./external-link";

describe("findLinkAtPosition", () => {
  it("finds the target of a Markdown inline link clicked anywhere in it", () => {
    const text = "see [the docs](https://example.com/docs) for more";
    const pos = text.indexOf("docs]"); // inside the link text
    expect(findLinkAtPosition(text, pos)).toBe("https://example.com/docs");
  });

  it("ignores a Markdown link title and only returns the URL", () => {
    const text = '[x](https://example.com "Title")';
    expect(findLinkAtPosition(text, 1)).toBe("https://example.com");
  });

  it("finds a bare URL spanning the click", () => {
    const text = "visit https://example.com today";
    const pos = text.indexOf("example");
    expect(findLinkAtPosition(text, pos)).toBe("https://example.com");
  });

  it("strips the brackets from an autolink", () => {
    const text = "<https://example.com>";
    expect(findLinkAtPosition(text, 5)).toBe("https://example.com");
  });

  it("returns null when the click is not on a link", () => {
    const text = "just some [text](https://example.com) here";
    const pos = text.indexOf("here");
    expect(findLinkAtPosition(text, pos)).toBeNull();
  });

  it("ignores non-http schemes the backend would reject", () => {
    const text = "[file](file:///etc/passwd)";
    expect(findLinkAtPosition(text, 1)).toBeNull();
  });
});
