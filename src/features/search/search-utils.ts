import type { TextMatch } from "./search-types";

/**
 * Find non-overlapping literal matches and return JavaScript UTF-16 offsets,
 * which can be passed directly to textarea selection APIs. Iterating by
 * Unicode code point keeps offsets correct around surrogate pairs.
 */
export function findTextMatches(text: string, query: string, caseSensitive: boolean): TextMatch[] {
  if (query.length === 0) return [];

  const textChars = Array.from(text);
  const queryChars = Array.from(query);
  if (queryChars.length > textChars.length) return [];

  const offsets = Array.from({ length: textChars.length + 1 }, () => 0);
  let utf16Offset = 0;
  for (let index = 0; index < textChars.length; index++) {
    offsets[index] = utf16Offset;
    utf16Offset += textChars[index].length;
  }
  offsets[textChars.length] = utf16Offset;

  const normalizedQuery = caseSensitive ? query : query.toLocaleLowerCase();
  const matches: TextMatch[] = [];
  for (let index = 0; index <= textChars.length - queryChars.length; ) {
    const candidate = textChars.slice(index, index + queryChars.length).join("");
    const normalizedCandidate = caseSensitive ? candidate : candidate.toLocaleLowerCase();
    if (normalizedCandidate === normalizedQuery) {
      matches.push({ start: offsets[index], end: offsets[index + queryChars.length] });
      index += queryChars.length;
    } else {
      index += 1;
    }
  }
  return matches;
}

export function normalizeMatchIndex(index: number, matchCount: number): number {
  if (matchCount === 0) return 0;
  return ((index % matchCount) + matchCount) % matchCount;
}

export function findClosestMatchIndex(matches: TextMatch[], targetStart: number): number {
  if (matches.length === 0) return 0;

  let closestIndex = 0;
  let closestDistance = Math.abs(matches[0].start - targetStart);
  for (let index = 1; index < matches.length; index++) {
    const distance = Math.abs(matches[index].start - targetStart);
    if (distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  }
  return closestIndex;
}
