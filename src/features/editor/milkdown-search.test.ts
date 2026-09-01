import { Schema } from "@milkdown/kit/prose/model";
import { describe, expect, it } from "vitest";
import { findProseMirrorMatches } from "./milkdown-search";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  },
  marks: {
    strong: {},
  },
});

describe("findProseMirrorMatches", () => {
  it("matches across adjacent text nodes split by formatting marks", () => {
    const strong = schema.marks.strong.create();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Ag"), schema.text("ent", [strong])]),
    ]);

    const matches = findProseMirrorMatches(doc, "Agent", true);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ from: 1, to: 6 });
  });

  it("does not allow a literal query to cross block boundaries", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("first")),
      schema.node("paragraph", null, schema.text("second")),
    ]);

    expect(findProseMirrorMatches(doc, "firstsecond", true)).toEqual([]);
  });

  it("keeps ProseMirror positions correct around surrogate pairs", () => {
    const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("😀Agent"))]);

    const matches = findProseMirrorMatches(doc, "Agent", true);
    expect(matches[0]).toMatchObject({ from: 3, to: 8 });
  });
});
