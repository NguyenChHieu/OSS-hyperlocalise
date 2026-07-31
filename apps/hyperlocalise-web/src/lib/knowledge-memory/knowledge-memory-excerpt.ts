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
  let earliest: number | null = null;
  for (const token of queryTokens) {
    const match = new RegExp(`\\b${escapeRegExp(token)}`, "i").exec(text);
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

const sentenceBoundary = /(?<=[.!?])\s+(?=[A-Z0-9"'(])/;

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

function scoreUnit(unit: ExcerptUnit, queryTokens: Set<string>): number {
  const unitTokens = expandKnowledgeMemoryTokens(unit.text);
  let score = 0;
  for (const token of queryTokens) {
    if (unitTokens.has(token)) {
      score += 1;
    }
  }
  return score;
}

function rankMatchingUnits(units: ExcerptUnit[], queryTokens: Set<string>): ExcerptUnit[] {
  if (queryTokens.size === 0) {
    return [];
  }

  return units
    .map((unit) => ({ unit, score: scoreUnit(unit, queryTokens) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.unit.offset - b.unit.offset))
    .map((scored) => scored.unit);
}

function packUnitsWithinBudget(rankedUnits: ExcerptUnit[], budget: number, separator: string) {
  const chosen: ExcerptUnit[] = [];
  let used = 0;
  for (const unit of rankedUnits) {
    const additional = (chosen.length > 0 ? separator.length : 0) + unit.text.length;
    if (used + additional <= budget) {
      chosen.push(unit);
      used += additional;
    }
  }
  return chosen.sort((a, b) => a.offset - b.offset);
}

/**
 * Builds the text sent to the prompt for a single selected segment. Unlike the parser's
 * precomputed `compactPromptText` (a query-independent prefix slice), this picks the sentences
 * or bullets that actually match the query, wherever they sit in the segment, then re-emits them
 * in original document order so condition/action pairs stay coupled.
 *
 * When nothing in the segment's own text matches the query — e.g. it was selected because its
 * heading matched, not its body — this falls back to the parser's prefix preview, so that path
 * stays consistent with today's behaviour.
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

  const headingPrefix = `${segment.headingPath.join(" > ")} -> `;
  const separator = segment.kind === "bullet_group" ? "; " : " ";
  const bodyBudget = Math.max(0, maxChars - headingPrefix.length);

  const chosen = packUnitsWithinBudget(ranked, bodyBudget, separator);
  const body =
    chosen.length > 0
      ? chosen.map((unit) => unit.text).join(separator)
      : truncateAroundMatch(ranked[0]!.text, bodyBudget, queryTokens);

  return `${headingPrefix}${body}`;
}
