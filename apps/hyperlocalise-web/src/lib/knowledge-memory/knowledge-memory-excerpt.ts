/*
 * Copyright (c) 2026 Hyperlocalise Pty Ltd
 *
 * Use of this software is governed by the Business Source License 1.1
 * included in this application's LICENSE file.
 *
 * Change Date: Four years after publication of the applicable version.
 *
 * On the Change Date, in accordance with the Business Source License, use
 * of this software will be governed by the GNU General Public License
 * Version 2.0 or later.
 */
import { expandKnowledgeMemoryTokens } from "./knowledge-memory-lexical-retriever";
import type { KnowledgeMemorySegment } from "./knowledge-memory-selection.types";

type ExcerptUnit = {
  text: string;
  offset: number;
};

// ponytail: fixed word-count chunking for oversized/unpunctuated units — good enough to avoid
// dropping a matching rule entirely; upgrade to clause-aware splitting if multi-rule single
// sentences turn out to be common in real memory documents.
const fallbackChunkWordCount = 25;
const oversizedSentenceChars = 400;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncateToBudget(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function findEarliestMatchOffset(text: string, queryTokens: Set<string>): number | null {
  // Lookaround on \p{L}\p{N}- instead of \b: \b is ASCII-only and would silently return null
  // (falling back to a plain prefix cut) for CJK/other non-ASCII tokens, which this needs to
  // handle correctly. The boundary set matches tokenize()'s split pattern in
  // knowledge-memory-lexical-retriever.ts, so "cart" won't match inside "cartography" and center
  // the excerpt on the wrong occurrence.
  let earliest: number | null = null;
  for (const token of queryTokens) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}-])${escapeRegExp(token)}(?![\\p{L}\\p{N}-])`,
      "iu",
    );
    const match = pattern.exec(text);
    if (match && (earliest === null || match.index < earliest)) {
      earliest = match.index;
    }
  }
  return earliest;
}

/**
 * Truncates text that's still too long even after unit splitting/packing. A plain prefix cut
 * would reintroduce the exact bug this module exists to fix (one level down, inside a single
 * oversized unit), so this centers the kept window on the query match instead of the start.
 */
function truncateAroundMatch(text: string, maxChars: number, queryTokens: Set<string>) {
  if (text.length <= maxChars || maxChars <= 0) {
    return truncateToBudget(text, maxChars);
  }

  const matchOffset = findEarliestMatchOffset(text, queryTokens);
  if (matchOffset === null) {
    return truncateToBudget(text, maxChars);
  }

  const leadChars = Math.floor(maxChars / 4);
  const start = Math.max(0, matchOffset - leadChars);
  const hasPrefix = start > 0;
  const hasSuffix = start + maxChars < text.length;
  const prefixMarker = hasPrefix ? "..." : "";
  const suffixMarker = hasSuffix ? "..." : "";
  const bodyChars = Math.max(0, maxChars - prefixMarker.length - suffixMarker.length);

  return `${prefixMarker}${text.slice(start, start + bodyChars)}${suffixMarker}`;
}

function chunkByWords(text: string, wordsPerChunk: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= wordsPerChunk) {
    return [text];
  }

  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += wordsPerChunk) {
    chunks.push(words.slice(index, index + wordsPerChunk).join(" "));
  }
  return chunks;
}

// \p{Lu}\p{Nd} instead of A-Z0-9: an ASCII-only class doesn't recognize an accented capital
// (É, Ñ, Ö, ...) as a sentence start, so a sub-400-char paragraph with several rules — one per
// sentence, each beginning with an accented letter — gets treated as a single oversized unit
// instead of being split and ranked separately.
const sentenceBoundary = /(?<=[.!?])\s+(?=[\p{Lu}\p{Nd}"'(])/u;

function splitIntoSentences(normalized: string): string[] {
  const sentences = normalized
    .split(sentenceBoundary)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.length > 0 ? sentences : [normalized];
}

function splitParagraphUnits(segmentText: string): ExcerptUnit[] {
  const normalized = segmentText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const units: ExcerptUnit[] = [];
  let offset = 0;
  for (const sentence of splitIntoSentences(normalized)) {
    const needsFallbackChunking =
      sentence.length > oversizedSentenceChars || !/[.!?]$/.test(sentence);
    const pieces = needsFallbackChunking
      ? chunkByWords(sentence, fallbackChunkWordCount)
      : [sentence];
    for (const piece of pieces) {
      units.push({ text: piece, offset: offset++ });
    }
  }
  return units;
}

function splitBulletUnits(segmentText: string): ExcerptUnit[] {
  return segmentText
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")
        .trim(),
    )
    .filter(Boolean)
    .map((text, offset) => ({ text, offset }));
}

/**
 * Per-token weight of 1 / (number of units that token matches). A token that shows up in most
 * bullets (a generic word like "checkout") contributes little to any single unit's score; a token
 * that shows up in exactly one bullet (a protected identifier) contributes a full point there.
 * Without this, equal integer scores fall back to document order in rankMatchingUnits, so an early
 * bullet that only matches the generic term can outrank — and, if oversized, fully hide — a later
 * bullet that's the actual reason the query matched anything at all.
 */
function computeTokenWeights(units: ExcerptUnit[], queryTokens: Set<string>): Map<string, number> {
  const weights = new Map<string, number>();
  for (const token of queryTokens) {
    const matchingUnitCount = units.filter((unit) =>
      expandKnowledgeMemoryTokens(unit.text).has(token),
    ).length;
    weights.set(token, matchingUnitCount > 0 ? 1 / matchingUnitCount : 0);
  }
  return weights;
}

function scoreUnit(
  unit: ExcerptUnit,
  queryTokens: Set<string>,
  tokenWeights: Map<string, number>,
): number {
  const unitTokens = expandKnowledgeMemoryTokens(unit.text);
  let score = 0;
  for (const token of queryTokens) {
    if (unitTokens.has(token)) {
      score += tokenWeights.get(token) ?? 0;
    }
  }
  return score;
}

function rankMatchingUnits(units: ExcerptUnit[], queryTokens: Set<string>): ExcerptUnit[] {
  if (queryTokens.size === 0) {
    return [];
  }

  const tokenWeights = computeTokenWeights(units, queryTokens);

  return units
    .map((unit) => ({ unit, score: scoreUnit(unit, queryTokens, tokenWeights) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.unit.offset - b.unit.offset))
    .map((scored) => scored.unit);
}

/**
 * Whether the segment's own heading vocabulary overlaps the query — a signal that retrieval may
 * have picked this segment for its heading rather than its body. When that's true, the opening
 * unit is where a heading-associated rule is most likely to live (mirrors how the old prefix
 * preview always started at the beginning), so it's worth keeping even if it has no token overlap
 * of its own — see forcedFirstUnit below.
 */
function headingMatchesQuery(segment: KnowledgeMemorySegment, queryTokens: Set<string>): boolean {
  const headingTokens = expandKnowledgeMemoryTokens(segment.headingPath.join(" "));
  for (const token of queryTokens) {
    if (headingTokens.has(token)) {
      return true;
    }
  }
  return false;
}

function packUnitsWithinBudget(
  rankedUnits: ExcerptUnit[],
  unitsByOffset: Map<number, ExcerptUnit>,
  budget: number,
  separator: string,
  forcedFirstUnit: ExcerptUnit | undefined,
) {
  const chosen = new Map<number, ExcerptUnit>();
  let used = 0;

  const tryAdd = (unit: ExcerptUnit) => {
    if (chosen.has(unit.offset)) {
      return true;
    }
    const additional = (chosen.size > 0 ? separator.length : 0) + unit.text.length;
    if (used + additional > budget) {
      return false;
    }
    chosen.set(unit.offset, unit);
    used += additional;
    return true;
  };

  if (forcedFirstUnit) {
    tryAdd(forcedFirstUnit);
  }

  for (const unit of rankedUnits) {
    if (!tryAdd(unit)) {
      continue;
    }

    // Pull in the immediate neighbours so a rule split across adjacent sentences/bullets — e.g.
    // "When the source contains X" followed by "translate it as Y" — doesn't lose its other half
    // just because that half alone has no query-token overlap. The prefix preview this replaces
    // kept both as long as they fit within budget; this restores that for the units that matched.
    const previous = unitsByOffset.get(unit.offset - 1);
    if (previous) {
      tryAdd(previous);
    }
    const next = unitsByOffset.get(unit.offset + 1);
    if (next) {
      tryAdd(next);
    }
  }

  return [...chosen.values()].sort((a, b) => a.offset - b.offset);
}

/**
 * Appends parser-level neighbour context (text from the adjacent segment) when packing touched
 * the very start or end of this segment and budget remains. A condition/action pair can be split
 * across two parsed segments — e.g. a bullet followed by a paragraph — not just across sentences
 * within one; those live outside `segment.segmentText` entirely, in `previousNeighbourText` /
 * `nextNeighbourText`, which the old prefix preview included but per-unit packing otherwise can't
 * reach. Best-effort: skipped whenever there's no budget left or the tail is too thin to be useful.
 */
function withNeighbourContext(input: {
  body: string;
  segment: KnowledgeMemorySegment;
  touchesStart: boolean;
  touchesEnd: boolean;
  separator: string;
  bodyBudget: number;
}): string {
  const minUsefulChars = 12;
  let result = input.body;

  if (input.touchesStart && input.segment.previousNeighbourText) {
    // Reserve the separator's own length before truncating: the separator is appended in
    // addition to this truncated text, so leaving it out of the truncation budget lets the
    // result overrun bodyBudget by separator.length.
    const remaining = input.bodyBudget - result.length - input.separator.length;
    if (remaining >= minUsefulChars) {
      const prefix = truncateToBudget(input.segment.previousNeighbourText, remaining);
      result = `${prefix}${input.separator}${result}`;
    }
  }

  if (input.touchesEnd && input.segment.nextNeighbourText) {
    const remaining = input.bodyBudget - result.length - input.separator.length;
    if (remaining >= minUsefulChars) {
      const suffix = truncateToBudget(input.segment.nextNeighbourText, remaining);
      result = `${result}${input.separator}${suffix}`;
    }
  }

  return result;
}

/**
 * Builds the text sent to the prompt for a single selected segment. Unlike the parser's
 * precomputed `compactPromptText` (a query-independent prefix slice), this picks the sentences
 * or bullets that actually match the query, wherever they sit in the segment, then re-emits them
 * in original document order so condition/action pairs stay coupled.
 *
 * When nothing in the segment's own text matches the query — e.g. it was selected because its
 * heading matched, not its body — this falls back to the parser's prefix preview, so that path
 * stays consistent with today's behaviour. When the heading matches but the body also has an
 * incidental, unrelated match (e.g. a locale code near the end of an otherwise irrelevant
 * segment), the segment's opening unit is kept alongside that match rather than dropped, since
 * that's the most likely place a heading-associated rule lives.
 */
export function buildSegmentExcerpt(input: {
  segment: KnowledgeMemorySegment;
  queryTokens: Set<string>;
  maxChars: number;
}): string {
  const { segment, queryTokens, maxChars } = input;

  const units =
    segment.kind === "bullet_group"
      ? splitBulletUnits(segment.segmentText)
      : splitParagraphUnits(segment.segmentText);

  const ranked = rankMatchingUnits(units, queryTokens);
  if (ranked.length === 0) {
    return truncateToBudget(segment.compactPromptText, maxChars);
  }

  const rawHeadingPrefix = `${segment.headingPath.join(" > ")} -> `;
  // Reserve at least a sliver of body space even when the heading path is long relative to
  // maxChars (the 80-char minimum used for balanced multi-locale excerpts makes this easy to
  // hit): otherwise a long heading alone could consume the entire per-segment budget, returning
  // heading + "..." with none of the matched rule, and — when the heading alone is >= maxChars —
  // exceeding maxChars outright.
  const minBodyReserve = Math.min(20, Math.floor(maxChars / 4));
  const headingPrefix = truncateToBudget(rawHeadingPrefix, Math.max(0, maxChars - minBodyReserve));
  const separator = segment.kind === "bullet_group" ? "; " : " ";
  const bodyBudget = Math.max(0, maxChars - headingPrefix.length);

  const topMatch = ranked[0]!;
  if (topMatch.text.length > bodyBudget) {
    // The single best match doesn't fit on its own. Truncate it around the query match rather
    // than falling through to pack whichever weaker, shorter units happen to fit — otherwise the
    // strongest match gets silently dropped in favour of less relevant ones.
    return `${headingPrefix}${truncateAroundMatch(topMatch.text, bodyBudget, queryTokens)}`;
  }

  const unitsByOffset = new Map(units.map((unit) => [unit.offset, unit]));
  const firstUnit = unitsByOffset.get(0);
  const forcedFirstUnit =
    firstUnit && !ranked.includes(firstUnit) && headingMatchesQuery(segment, queryTokens)
      ? firstUnit
      : undefined;
  const chosen = packUnitsWithinBudget(
    ranked,
    unitsByOffset,
    bodyBudget,
    separator,
    forcedFirstUnit,
  );
  const body = withNeighbourContext({
    body: chosen.map((unit) => unit.text).join(separator),
    segment,
    touchesStart: chosen[0]?.offset === 0,
    touchesEnd: chosen[chosen.length - 1]?.offset === units.length - 1,
    separator,
    bodyBudget,
  });

  return `${headingPrefix}${body}`;
}
