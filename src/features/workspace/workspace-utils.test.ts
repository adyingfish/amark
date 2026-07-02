import { describe, expect, it } from "vitest";
import {
  isHomeRelativePath,
  resolveHomeRelativePath,
  resolveLocalFileReference,
  resolveLocalMarkdownLink,
} from "./workspace-utils";

describe("resolveLocalFileReference", () => {
  it("resolves a relative path against the base file's directory", () => {
    expect(resolveLocalFileReference("/root/docs/guide.md", "notes.md")).toBe(
      "/root/docs/notes.md",
    );
  });

  it("resolves a non-Markdown target, unlike resolveLocalMarkdownLink", () => {
    expect(resolveLocalFileReference("/root/docs/guide.md", "assets/logo.png")).toBe(
      "/root/docs/assets/logo.png",
    );
    expect(resolveLocalMarkdownLink("/root/docs/guide.md", "assets/logo.png")).toBeNull();
  });

  it("resolves a parent-relative path", () => {
    expect(resolveLocalFileReference("/root/docs/guide.md", "../src/main.ts")).toBe(
      "/root/src/main.ts",
    );
  });

  it("passes an absolute path through unchanged", () => {
    expect(resolveLocalFileReference("/root/docs/guide.md", "/etc/hosts")).toBe("/etc/hosts");
  });

  it("resolves a bare filename against the base file's directory", () => {
    expect(resolveLocalFileReference("/root/README", "AGENTS.md")).toBe("/root/AGENTS.md");
    expect(resolveLocalFileReference("/root/docs/guide.md", "package.json")).toBe(
      "/root/docs/package.json",
    );
  });

  it("returns null for a ~-rooted reference — callers must resolve those separately", () => {
    expect(
      resolveLocalFileReference("/root/docs/guide.md", "~/.claude/personal-rules.md"),
    ).toBeNull();
  });
});

describe("isHomeRelativePath / resolveHomeRelativePath", () => {
  it("recognizes ~ and ~/... as home-relative", () => {
    expect(isHomeRelativePath("~")).toBe(true);
    expect(isHomeRelativePath("~/.claude/personal-rules.md")).toBe(true);
  });

  it("does not treat a mid-string ~ as home-relative", () => {
    expect(isHomeRelativePath("docs/~backup/notes.md")).toBe(false);
  });

  it("expands a ~-rooted path against a resolved home directory", () => {
    expect(resolveHomeRelativePath("/home/alice", "~/.claude/personal-rules.md")).toBe(
      "/home/alice/.claude/personal-rules.md",
    );
  });

  it("expands bare ~ to the home directory itself", () => {
    expect(resolveHomeRelativePath("/home/alice", "~")).toBe("/home/alice");
  });

  it("trims a trailing separator off the home directory before joining", () => {
    expect(resolveHomeRelativePath("/home/alice/", "~/notes.md")).toBe("/home/alice/notes.md");
  });
});
