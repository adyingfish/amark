import { describe, expect, it } from "vitest";
import { formatDisplayPath } from "./app-utils";

describe("formatDisplayPath", () => {
  it("shows the file relative to the workspace root, using the workspace name", () => {
    expect(formatDisplayPath("/home/u/notes/a.md", "/home/u/notes", "notes")).toBe("notes/a.md");
    expect(formatDisplayPath("/home/u/notes/sub/b.md", "/home/u/notes", "notes")).toBe(
      "notes/sub/b.md",
    );
  });

  it("falls back to the root basename when no workspace name is given", () => {
    expect(formatDisplayPath("/home/u/notes/a.md", "/home/u/notes", null)).toBe("notes/a.md");
  });

  it("normalizes backslashes to forward slashes for files outside the workspace", () => {
    expect(formatDisplayPath("C:\\standalone.md", null, null)).toBe("C:/standalone.md");
  });

  // Regression: launch-file paths come from `std::fs::canonicalize`, which on
  // Windows prepends the `\\?\` verbatim prefix. Without stripping it the path
  // misses the workspace-root prefix test and the trailing `\`→`/` pass turns
  // `\\?\` into the `//?/` garbage the user reported in the status bar.
  it("strips the Windows verbatim drive prefix before matching the root", () => {
    const filePath = "\\\\?\\E:\\Desktop\\残差\\残差的尽头是序列建模.md";
    expect(formatDisplayPath(filePath, "E:\\Desktop\\残差", "残差")).toBe(
      "残差/残差的尽头是序列建模.md",
    );
  });

  it("strips the Windows UNC verbatim prefix (WSL share) before matching the root", () => {
    const filePath = "\\\\?\\UNC\\wsl.localhost\\Ubuntu\\home\\u\\notes\\a.md";
    const rootPath = "\\\\wsl.localhost\\Ubuntu\\home\\u\\notes";
    expect(formatDisplayPath(filePath, rootPath, "notes")).toBe("notes/a.md");
  });

  it("strips the verbatim prefix even for files outside any workspace", () => {
    expect(formatDisplayPath("\\\\?\\E:\\Desktop\\loose.md", null, null)).toBe(
      "E:/Desktop/loose.md",
    );
  });
});
