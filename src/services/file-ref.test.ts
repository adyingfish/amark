import { describe, expect, it } from "vitest";
import {
  findFileRefAtPosition,
  isBareAllCapsRef,
  looksLikeMarkdownRef,
  splitFileRefMatch,
} from "./file-ref";

describe("findFileRefAtPosition", () => {
  it("finds a file reference clicked anywhere within it", () => {
    const text = "see @docs/notes.md for details";
    const pos = text.indexOf("notes");
    expect(findFileRefAtPosition(text, pos)).toBe("docs/notes.md");
  });

  it("finds a deeply nested relative reference", () => {
    const text = "check @src/features/editor/milkdown-adapter.ts closely";
    const pos = text.indexOf("milkdown");
    expect(findFileRefAtPosition(text, pos)).toBe("src/features/editor/milkdown-adapter.ts");
  });

  it("supports parent-relative paths", () => {
    const text = "@../shared/types.ts";
    expect(findFileRefAtPosition(text, 2)).toBe("../shared/types.ts");
  });

  it("strips trailing sentence punctuation from the match", () => {
    const text = "see @docs/notes.md.";
    expect(findFileRefAtPosition(text, 5)).toBe("docs/notes.md");
  });

  it("ignores a plain @mention with no slash", () => {
    const text = "cc @someone about this";
    expect(findFileRefAtPosition(text, 4)).toBeNull();
  });

  it("ignores the userinfo @ inside a bare URL", () => {
    const text = "https://user@example.com/path";
    const pos = text.indexOf("example");
    expect(findFileRefAtPosition(text, pos)).toBeNull();
  });

  it("returns null when the click is outside any reference", () => {
    const text = "see @docs/notes.md here";
    expect(findFileRefAtPosition(text, text.indexOf("here"))).toBeNull();
  });

  it("finds a bare ALL-CAPS project file with no extension", () => {
    const text = "read @README first";
    expect(findFileRefAtPosition(text, text.indexOf("README"))).toBe("README");
  });

  it("finds a bare filename with an extension", () => {
    expect(findFileRefAtPosition("see @AGENTS.md", 6)).toBe("AGENTS.md");
    expect(findFileRefAtPosition("see @package.json", 6)).toBe("package.json");
  });

  it("finds a bare filename with multiple extensions", () => {
    expect(findFileRefAtPosition("check @next.config.mjs", 8)).toBe("next.config.mjs");
  });

  it("supports yaml/toml/txt-style extensions generically", () => {
    expect(findFileRefAtPosition("@config.yaml", 1)).toBe("config.yaml");
    expect(findFileRefAtPosition("@Cargo.toml", 1)).toBe("Cargo.toml");
    expect(findFileRefAtPosition("@notes.txt", 1)).toBe("notes.txt");
  });

  it("finds a home-directory-rooted reference", () => {
    const text = "see @~/.claude/personal-rules.md";
    expect(findFileRefAtPosition(text, text.indexOf("personal"))).toBe(
      "~/.claude/personal-rules.md",
    );
  });

  it("does not swallow a trailing sentence period off a multi-dot filename", () => {
    expect(findFileRefAtPosition("open @next.config.mjs.", 6)).toBe("next.config.mjs");
  });
});

describe("splitFileRefMatch", () => {
  it("returns the path unchanged when there is no trailing punctuation", () => {
    expect(splitFileRefMatch("docs/notes.md")).toEqual({ path: "docs/notes.md", trailing: "" });
  });

  it("separates trailing punctuation from the path", () => {
    expect(splitFileRefMatch("docs/notes.md,")).toEqual({
      path: "docs/notes.md",
      trailing: ",",
    });
  });

  it("returns null when the match is punctuation only", () => {
    expect(splitFileRefMatch(".")).toBeNull();
  });
});

describe("isBareAllCapsRef", () => {
  it("matches a bare ALL-CAPS word with no slash and no extension", () => {
    expect(isBareAllCapsRef("README")).toBe(true);
    expect(isBareAllCapsRef("LICENSE")).toBe(true);
  });

  it("rejects a slash-path, even if the tail is ALL-CAPS", () => {
    expect(isBareAllCapsRef("docs/README")).toBe(false);
  });

  it("rejects anything with an extension", () => {
    expect(isBareAllCapsRef("AGENTS.md")).toBe(false);
  });

  it("rejects lowercase or mixed-case bare words", () => {
    expect(isBareAllCapsRef("someone")).toBe(false);
    expect(isBareAllCapsRef("Readme")).toBe(false);
  });
});

describe("looksLikeMarkdownRef", () => {
  it("accepts known Markdown extensions", () => {
    expect(looksLikeMarkdownRef("docs/notes.md")).toBe(true);
    expect(looksLikeMarkdownRef("notes.markdown")).toBe(true);
  });

  it("optimistically accepts a bare ALL-CAPS reference", () => {
    expect(looksLikeMarkdownRef("README")).toBe(true);
  });

  it("rejects a non-Markdown extension", () => {
    expect(looksLikeMarkdownRef("package.json")).toBe(false);
    expect(looksLikeMarkdownRef("config.yaml")).toBe(false);
  });

  it("rejects an extensionless slash-path tail (not a bare reference)", () => {
    expect(looksLikeMarkdownRef("docs/README")).toBe(false);
  });
});
