import { describe, expect, it } from "vitest";
import { findClosestMatchIndex, findTextMatches, normalizeMatchIndex } from "./search-utils";

describe("findTextMatches", () => {
  it("finds non-overlapping literal matches", () => {
    expect(findTextMatches("Agent agent agentic", "agent", false)).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 },
      { start: 12, end: 17 },
    ]);
  });

  it("respects case-sensitive searches", () => {
    expect(findTextMatches("Agent agent", "Agent", true)).toEqual([{ start: 0, end: 5 }]);
  });

  it("returns UTF-16 offsets around emoji", () => {
    expect(findTextMatches("😀Agent😀Agent", "Agent", true)).toEqual([
      { start: 2, end: 7 },
      { start: 9, end: 14 },
    ]);
  });

  it("handles Chinese text and empty queries", () => {
    expect(findTextMatches("搜索功能搜索", "搜索", false)).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 6 },
    ]);
    expect(findTextMatches("text", "", false)).toEqual([]);
  });
});

describe("search navigation", () => {
  it("wraps match indexes in both directions", () => {
    expect(normalizeMatchIndex(3, 3)).toBe(0);
    expect(normalizeMatchIndex(-1, 3)).toBe(2);
    expect(normalizeMatchIndex(5, 0)).toBe(0);
  });

  it("chooses the result nearest to a requested source offset", () => {
    const matches = [
      { start: 3, end: 5 },
      { start: 20, end: 22 },
      { start: 50, end: 52 },
    ];
    expect(findClosestMatchIndex(matches, 18)).toBe(1);
    expect(findClosestMatchIndex(matches, 45)).toBe(2);
  });
});
