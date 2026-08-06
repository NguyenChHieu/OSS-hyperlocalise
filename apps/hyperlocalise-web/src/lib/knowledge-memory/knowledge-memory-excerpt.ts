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

function truncateToBudget(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

// Matches a run of letters/numbers/hyphens, optionally continuing through an internal apostrophe
// ("don't", "y'all") — the same word shape tokenize() in knowledge-memory-lexical-retriever.ts
// produces, just without discarding the apostrophe or the position. Matching whole runs (instead
// of searching for each token as a substring) also means "cart" can never match inside
// "cartography": matchAll only ever yields "cartography" as one run, never a "cart"-sized slice
// of it.
const wordPattern = /[\p{L}\p{N}-]+(?:['’][\p{L}\p{N}-]+)*/gu;

/**
 * Finds the offset of the highest-weighted query-token match, not just the first one. Weight
 * comes from the same 1/(matching-unit-count) scheme rankMatchingUnits uses: a generic word that
 * also matches other units in the segment (e.g. "checkout") is worth less than a rare one that
 * matches only this unit (e.g. a protected identifier). Without this, a query for both, appearing
 * early and late in one oversized unit, always centered on the earlier — usually more generic —
 * occurrence and lost the specific one the query actually cared about. Ties (equal weight) break
 * on earliest offset for determinism.
 *
 * One pass over the text via matchAll, not one regex scan per query token: the preview API allows
 * sourceText up to 100,000 characters, which can produce thousands of query tokens against a
 * single oversized (tens-of-thousands-of-characters) unit — scanning the whole text once per token
 * made that O(query tokens × text length) and measurably slow (seconds) at that scale.
 */
function findBestMatchOffset(
  text: string,
  queryTokens: Set<string>,
  tokenWeights: Map<string, number>,
): number | null {
  let best: { offset: number; weight: number } | null = null;
  for (const match of text.matchAll(wordPattern)) {
    const token = match[0].toLowerCase().replace(/['’]/g, "");
    if (!queryTokens.has(token)) {
      continue;
    }
    const weight = tokenWeights.get(token) ?? 1;
    if (!best || weight > best.weight) {
      best = { offset: match.index, weight };
    }
  }
  return best?.offset ?? null;
}

/**
 * Truncates text that's still too long even after unit splitting/packing. A plain prefix cut
 * would reintroduce the exact bug this module exists to fix (one level down, inside a single
 * oversized unit), so this centers the kept window on the query match instead of the start.
 */
function truncateAroundMatch(
  text: string,
  maxChars: number,
  queryTokens: Set<string>,
  tokenWeights: Map<string, number>,
) {
  if (text.length <= maxChars || maxChars <= 0) {
    return truncateToBudget(text, maxChars);
  }

  const matchOffset = findBestMatchOffset(text, queryTokens, tokenWeights);
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
//
// That alone still misses uncased scripts (Chinese, Japanese, Korean, Thai, ...): those have no
// uppercase/lowercase distinction, so requiring \p{Lu} rejects every one of their sentence starts.
// The (?!...)\p{L} branch accepts any letter that ISN'T part of a cased alphabet (not \p{Lu},
// \p{Ll}, or \p{Lt}) as a valid start too.
//
// The terminator side is split into two alternatives rather than one shared \s+: CJK sentences
// conventionally run with no space at all after 。！？ ("第一条。第二条。"), so requiring \s+
// there — even after adding the fullwidth punctuation itself — still failed to split them. ASCII
// .!? keeps requiring \s+ (a bare "3.5" or "e.g." shouldn't split); 。！？ allow a zero-width
// boundary immediately after, matching how those scripts are actually written.
//
// Both terminator branches also allow an optional closing quote ("'”’) between the terminator and
// the whitespace: a quoted rule like `"Keep X." "Keep Y."` puts the closing quote, not the
// terminator itself, immediately before the space, so the plain terminator-only lookbehind never
// matched there. The lookahead correspondingly accepts typographic opening quotes (“‘) alongside
// the straight ones, so a sentence that starts with one still counts as a valid boundary.
const sentenceBoundary =
  /(?:(?<=[.!?]["”’]?)\s+|(?<=[。！？]["”’]?)\s*)(?=[\p{Lu}\p{Nd}"“‘(]|(?:(?![\p{Ll}\p{Lu}\p{Lt}])\p{L}))/u;

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
 * Ranks units by a score weighted 1 / (number of units that token matches): a token that shows up
 * in most bullets (a generic word like "checkout") contributes little to any single unit's score;
 * a token that shows up in exactly one bullet (a protected identifier) contributes a full point
 * there. Without this, equal integer scores fall back to document order, so an early bullet that
 * only matches the generic term can outrank — and, if oversized, fully hide — a later bullet
 * that's the actual reason the query matched anything at all.
 *
 * Tokenizes each unit exactly once and reuses those cached sets for both the matching-unit counts
 * and the per-unit scores below, rather than re-tokenizing per query token — the previous version
 * did that inside a queryTokens loop, making this O(query tokens × units × unit length). The
 * preview API allows sourceText up to 100,000 characters and memories up to 50,000, which can
 * produce thousands of tokens and units; re-tokenizing per token pair made a single segment take
 * tens of seconds.
 */
function rankMatchingUnits(
  units: ExcerptUnit[],
  queryTokens: Set<string>,
): { ranked: ExcerptUnit[]; tokenWeights: Map<string, number> } {
  if (queryTokens.size === 0) {
    return { ranked: [], tokenWeights: new Map() };
  }

  const unitTokenSets = units.map((unit) => expandKnowledgeMemoryTokens(unit.text));

  const matchingUnitCounts = new Map<string, number>();
  for (const tokens of unitTokenSets) {
    for (const token of tokens) {
      if (queryTokens.has(token)) {
        matchingUnitCounts.set(token, (matchingUnitCounts.get(token) ?? 0) + 1);
      }
    }
  }

  // Exposed alongside the ranked units so callers that later need to center a truncation window
  // within a single oversized unit's text (findBestMatchOffset) can weigh those matches the same
  // way this scoring pass already does, instead of just taking whichever occurs first.
  const tokenWeights = new Map(
    [...matchingUnitCounts.entries()].map(([token, count]) => [token, 1 / count]),
  );

  const ranked = units
    .map((unit, index) => {
      let score = 0;
      for (const token of unitTokenSets[index]!) {
        const weight = tokenWeights.get(token);
        if (weight) {
          score += weight;
        }
      }
      return { unit, score };
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.unit.offset - b.unit.offset))
    .map((scored) => scored.unit);

  return { ranked, tokenWeights };
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
  queryTokens: Set<string>,
  tokenWeights: Map<string, number>,
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

  // Give every ranked match a fair share of what's actually left when its turn comes, rather than
  // a fixed share computed once up front — a unit that doesn't fit whole still gets truncated
  // instead of dropped outright (a partial rule beats no rule), but a share fixed in advance never
  // reclaims budget a short earlier unit left unused: with an 8-char first rule and a much longer
  // second rule, a fixed 60/60 split truncates the second rule well before the action it needs, even
  // though ~112 characters are actually free after the first rule's real (tiny) cost. Recomputing
  // the share from the units still to come each time — remaining budget divided by remaining
  // units — folds any earlier surplus into what's left for the rest automatically.
  const minTruncatedChars = 12;
  const tryAddRankedUnit = (unit: ExcerptUnit, isFirst: boolean, unitsRemaining: number) => {
    const remaining = budget - used - (chosen.size > 0 ? separator.length : 0);
    const projectedSeparators = unitsRemaining > 1 ? separator.length * (unitsRemaining - 1) : 0;
    const share = Math.max(0, Math.floor((remaining - projectedSeparators) / unitsRemaining));
    // Guarantee the top-ranked match a real shot at the full remaining budget when its share has
    // collapsed below usefulness: enough ranked units matching the same common token under a tight
    // budget (e.g. six "checkout" bullets in 80 characters) can make every unit's share land under
    // minTruncatedChars, rejecting them all and returning nothing but the heading — even though a
    // truncated top match alone would easily have fit.
    const cap = isFirst && share < minTruncatedChars ? remaining : Math.min(share, remaining);
    if (unit.text.length <= cap) {
      return tryAdd(unit);
    }
    if (cap < minTruncatedChars) {
      return false;
    }
    return tryAdd({
      text: truncateAroundMatch(unit.text, cap, queryTokens, tokenWeights),
      offset: unit.offset,
    });
  };

  // Place every ranked match first, before spending any budget on the heading-driven opener or
  // neighbour context: a match is the reason the segment was selected, so every one of them
  // outranks "nice to have" context for a shared, limited budget. Reserving room for only the
  // top-ranked match here isn't enough — with more than one ranked match, the opener could still
  // fit alongside the first but crowd out a later, independently-matching unit that all of them
  // together would otherwise have fit without it.
  const placed = rankedUnits.filter((unit, index) =>
    tryAddRankedUnit(unit, index === 0, rankedUnits.length - index),
  );

  if (forcedFirstUnit) {
    tryAdd(forcedFirstUnit);
  }

  for (const unit of placed) {
    // Pull in the immediate neighbours so a rule split across adjacent sentences/bullets — e.g.
    // "When the source contains X" followed by "translate it as Y" — doesn't lose its other half
    // just because that half alone has no query-token overlap. The prefix preview this replaces
    // kept both as long as they fit within budget; this restores that for the units that matched.
    // next before previous: a rule's condition is more often followed by its action ("When X...
    // Translate as Y") than preceded by one, so when only one neighbour fits, prefer the one more
    // likely to be the dependent half over unrelated prior context.
    const next = unitsByOffset.get(unit.offset + 1);
    if (next) {
      tryAdd(next);
    }
    const previous = unitsByOffset.get(unit.offset - 1);
    if (previous) {
      tryAdd(previous);
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

  // next before previous, same as packUnitsWithinBudget: a condition's action more often follows
  // it than precedes it, so when both parser-level neighbours are eligible but budget fits only
  // one, spend it on nextNeighbourText first rather than always taking previousNeighbourText.
  if (input.touchesEnd && input.segment.nextNeighbourText) {
    const remaining = input.bodyBudget - result.length - input.separator.length;
    if (remaining >= minUsefulChars) {
      const suffix = truncateToBudget(input.segment.nextNeighbourText, remaining);
      result = `${result}${input.separator}${suffix}`;
    }
  }

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

  const { ranked, tokenWeights } = rankMatchingUnits(units, queryTokens);
  if (ranked.length === 0) {
    return truncateToBudget(segment.compactPromptText, maxChars);
  }

  const rawHeadingPrefix = `${segment.headingPath.join(" > ")} -> `;
  // Reserve at least a sliver of body space even when the heading path is long relative to
  // maxChars (the 80-char minimum used for balanced multi-locale excerpts makes this easy to
  // hit): otherwise a long heading alone could consume the entire per-segment budget, returning
  // heading + "..." with none of the matched rule, and — when the heading alone is >= maxChars —
  // exceeding maxChars outright. A flat 20-char floor isn't actually enough on its own: up to 6 of
  // those go to truncateAroundMatch's own leading/trailing "..." markers, so a protected identifier
  // longer than ~14 characters (e.g. "routingtoken") could still get cut off mid-word. Size the
  // floor from the longest token actually being matched in this segment instead of a constant.
  const longestMatchedTokenLength = Math.max(0, ...[...tokenWeights.keys()].map((t) => t.length));
  const minBodyReserve = Math.min(
    Math.max(20, longestMatchedTokenLength + 10),
    Math.max(0, maxChars - 1),
  );
  const headingPrefix = truncateToBudget(rawHeadingPrefix, Math.max(0, maxChars - minBodyReserve));
  const separator = segment.kind === "bullet_group" ? "; " : " ";
  const bodyBudget = Math.max(0, maxChars - headingPrefix.length);

  // No special-case for an oversized top match: packUnitsWithinBudget's tryAddRankedUnit already
  // truncates any ranked unit that doesn't fit whole into whatever budget remains, the first one
  // included (remaining budget starts at the full bodyBudget when nothing's chosen yet). Special-
  // casing it here to bypass packing meant every other ranked unit was dropped outright, even a
  // short one that would fit alongside a truncated fragment of the top match.
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
    queryTokens,
    tokenWeights,
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
