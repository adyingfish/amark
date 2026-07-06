import { describe, expect, it } from "vitest";
import { resolveLocalImagePath } from "./image-src";

const POSIX_BASE = "/home/user/notes";
const WINDOWS_BASE = "C:\\Users\\user\\notes";

describe("resolveLocalImagePath", () => {
  it("passes remote and data URLs through as non-local", () => {
    expect(resolveLocalImagePath("https://example.com/a.png", POSIX_BASE)).toBeNull();
    expect(resolveLocalImagePath("http://example.com/a.png", POSIX_BASE)).toBeNull();
    expect(resolveLocalImagePath("data:image/png;base64,AAAA", POSIX_BASE)).toBeNull();
    expect(resolveLocalImagePath("asset://localhost/x.png", POSIX_BASE)).toBeNull();
  });

  it("returns null for an empty src", () => {
    expect(resolveLocalImagePath("", POSIX_BASE)).toBeNull();
  });

  it("keeps absolute POSIX paths as-is", () => {
    expect(resolveLocalImagePath("/tmp/pic.png", POSIX_BASE)).toBe("/tmp/pic.png");
    expect(resolveLocalImagePath("/tmp/pic.png", null)).toBe("/tmp/pic.png");
  });

  it("treats a Windows drive prefix as a path, not a URL scheme", () => {
    expect(resolveLocalImagePath("C:\\pics\\a.png", null)).toBe("C:\\pics\\a.png");
    expect(resolveLocalImagePath("C:/pics/a.png", null)).toBe("C:/pics/a.png");
  });

  it("resolves relative paths against a POSIX base", () => {
    expect(resolveLocalImagePath("a.png", POSIX_BASE)).toBe("/home/user/notes/a.png");
    expect(resolveLocalImagePath("./assets/a.png", POSIX_BASE)).toBe(
      "/home/user/notes/assets/a.png",
    );
    expect(resolveLocalImagePath("../shared/a.png", POSIX_BASE)).toBe("/home/user/shared/a.png");
  });

  it("resolves relative paths against a Windows base", () => {
    expect(resolveLocalImagePath("assets\\a.png", WINDOWS_BASE)).toBe(
      "C:/Users/user/notes/assets/a.png",
    );
    expect(resolveLocalImagePath("../a.png", WINDOWS_BASE)).toBe("C:/Users/user/a.png");
  });

  it("clamps .. so the result never escapes the filesystem root", () => {
    expect(resolveLocalImagePath("../../../../../a.png", "/home/user")).toBe("/a.png");
  });

  it("returns null for a relative path when there is no base", () => {
    expect(resolveLocalImagePath("./a.png", null)).toBeNull();
  });

  it("resolves relative paths against a UNC base (WSL share on Windows)", () => {
    const uncBase = "\\\\wsl.localhost\\Ubuntu\\home\\user\\notes";
    expect(resolveLocalImagePath("./docs/a.png", uncBase)).toBe(
      "//wsl.localhost/Ubuntu/home/user/notes/docs/a.png",
    );
    expect(resolveLocalImagePath("../a.png", uncBase)).toBe(
      "//wsl.localhost/Ubuntu/home/user/a.png",
    );
  });

  it("clamps .. at the UNC share, never popping server or share", () => {
    expect(resolveLocalImagePath("../../../../a.png", "\\\\server\\share\\docs")).toBe(
      "//server/share/a.png",
    );
  });

  it("keeps absolute UNC paths as-is", () => {
    expect(resolveLocalImagePath("\\\\server\\share\\a.png", null)).toBe(
      "\\\\server\\share\\a.png",
    );
  });

  it("decodes percent-encoded names", () => {
    expect(resolveLocalImagePath("my%20image.png", POSIX_BASE)).toBe(
      "/home/user/notes/my image.png",
    );
  });

  it("keeps names with a literal % that fail to decode", () => {
    expect(resolveLocalImagePath("50%off.png", POSIX_BASE)).toBe("/home/user/notes/50%off.png");
  });
});
