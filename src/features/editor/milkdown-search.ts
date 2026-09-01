import { prosePluginsCtx } from "@milkdown/kit/core";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Ctx } from "@milkdown/kit/ctx";
import { findTextMatches } from "../search/search-utils";
import type { TextMatch } from "../search/search-types";

export interface ProseMirrorSearchRange extends TextMatch {
  from: number;
  to: number;
}

interface SearchDecorationAction {
  ranges: ProseMirrorSearchRange[];
  activeIndex: number;
}

export const searchDecorationKey = new PluginKey<DecorationSet>("AMARK_SEARCH_DECORATIONS");

const searchDecorationPlugin = new Plugin<DecorationSet>({
  key: searchDecorationKey,
  state: {
    init: () => DecorationSet.empty,
    apply(transaction, decorations) {
      const action = transaction.getMeta(searchDecorationKey) as SearchDecorationAction | undefined;
      if (action) {
        return DecorationSet.create(
          transaction.doc,
          action.ranges.map((range, index) =>
            Decoration.inline(range.from, range.to, {
              class:
                index === action.activeIndex ? "search-match search-match-active" : "search-match",
            }),
          ),
        );
      }
      // Query results are recomputed by the app after document changes. Clear
      // immediately so stale highlights never drift onto unrelated text.
      return transaction.docChanged ? DecorationSet.empty : decorations;
    },
  },
  props: {
    decorations(state) {
      return searchDecorationKey.getState(state) ?? DecorationSet.empty;
    },
  },
});

export function configureSearchPlugin(ctx: Ctx): void {
  ctx.update(prosePluginsCtx, (plugins) => [...plugins, searchDecorationPlugin]);
}

/**
 * Flatten visible ProseMirror text while retaining a UTF-16-index-to-document
 * position map. A sentinel between non-contiguous nodes prevents a query from
 * crossing block or atom boundaries; adjacent marked text remains searchable.
 */
export function findProseMirrorMatches(
  doc: ProseMirrorNode,
  query: string,
  caseSensitive: boolean,
): ProseMirrorSearchRange[] {
  let searchableText = "";
  const positions: number[] = [];
  let previousTextEnd: number | null = null;

  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    if (previousTextEnd !== null && position !== previousTextEnd) {
      searchableText += "\0";
      positions.push(-1);
    }
    searchableText += node.text;
    for (let offset = 0; offset < node.text.length; offset++) {
      positions.push(position + offset);
    }
    previousTextEnd = position + node.nodeSize;
  });

  return findTextMatches(searchableText, query, caseSensitive).flatMap((match) => {
    const from = positions[match.start];
    const lastPosition = positions[match.end - 1];
    if (from === undefined || lastPosition === undefined || from < 0 || lastPosition < 0) return [];
    return [{ ...match, from, to: lastPosition + 1 }];
  });
}

export function setSearchDecorations(
  view: import("@milkdown/kit/prose/view").EditorView,
  ranges: ProseMirrorSearchRange[],
  activeIndex: number,
): void {
  const transaction = view.state.tr.setMeta(searchDecorationKey, { ranges, activeIndex });
  const active = ranges[activeIndex];
  if (active) {
    transaction.setSelection(TextSelection.create(transaction.doc, active.from, active.to));
    transaction.scrollIntoView();
  }
  view.dispatch(transaction);
}
