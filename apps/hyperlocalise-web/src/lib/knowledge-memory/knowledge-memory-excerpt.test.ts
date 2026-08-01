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
import { describe, expect, it } from "vite-plus/test";

import { buildSegmentExcerpt } from "./knowledge-memory-excerpt";
import { expandKnowledgeMemoryTokens } from "./knowledge-memory-lexical-retriever";
import type { KnowledgeMemorySegment } from "./knowledge-memory-selection.types";

function segment(overrides: Partial<KnowledgeMemorySegment> & { segmentText: string }) {
  const headingPath = overrides.headingPath ?? ["Memory.md", "Section"];
  const compactPromptText =
    overrides.compactPromptText ??
    `${headingPath.join(" > ")} -> ${overrides.segmentText.slice(0, 40)}`;

  const base: KnowledgeMemorySegment = {
    id: "segment-1",
    kind: "paragraph",
    headingPath,
    segmentText: overrides.segmentText,
    parentSectionPreview: null,
    previousNeighbourText: null,
    nextNeighbourText: null,
    startLine: 1,
    endLine: 1,
    startOffset: 0,
    endOffset: overrides.segmentText.length,
    searchText: overrides.segmentText,
    compactPromptText,
  };

  return { ...base, ...overrides };
}

function tokens(...values: string[]) {
  return expandKnowledgeMemoryTokens(values.join(" "));
}

describe("buildSegmentExcerpt", () => {
  it("picks the matching sentence out of a paragraph regardless of its position", () => {
    const longParagraph = [
      "The alignmentwidget must stay left aligned on every checkout step across every locale.",
      "This is unrelated filler prose about generic checkout localisation practices repeated to add length.".repeat(
        8,
      ),
      "The confirmpanel must always show the order total above the shipping address on the screen.",
    ].join(" ");

    const excerpt = buildSegmentExcerpt({
      segment: segment({ segmentText: longParagraph, kind: "paragraph" }),
      queryTokens: tokens("confirmpanel"),
      maxChars: 200,
    });

    expect(excerpt).toContain("confirmpanel");
    expect(excerpt).not.toContain("alignmentwidget");
  });

  it("emits multiple matching bullets in original document order, not score order", () => {
    const bulletSegment = segment({
      kind: "bullet_group",
      segmentText: [
        "- Keep the firstmarker token unchanged in every locale.",
        "- This bullet is unrelated filler about shipping timelines.",
        "- Keep the secondmarker token unchanged and never pluralise it.",
      ].join("\n"),
    });

    const excerpt = buildSegmentExcerpt({
      segment: bulletSegment,
      queryTokens: tokens("secondmarker", "firstmarker"),
      maxChars: 1000,
    });

    const firstIndex = excerpt.indexOf("firstmarker");
    const secondIndex = excerpt.indexOf("secondmarker");
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });

  it("falls back to the precomputed prefix preview when nothing in the segment text matches", () => {
    const fallbackSegment = segment({
      segmentText: "Some unrelated body text that shares no vocabulary with the query at all.",
      compactPromptText: "Memory.md > Section -> Some unrelated body text preview",
    });

    const excerpt = buildSegmentExcerpt({
      segment: fallbackSegment,
      queryTokens: tokens("nomatchingtoken"),
      maxChars: 1000,
    });

    expect(excerpt).toBe(fallbackSegment.compactPromptText);
  });

  it("falls back to the prefix preview when queryTokens is empty", () => {
    const fallbackSegment = segment({
      segmentText: "Body text that would otherwise match a query.",
      compactPromptText: "Memory.md > Section -> Body text preview",
    });

    const excerpt = buildSegmentExcerpt({
      segment: fallbackSegment,
      queryTokens: new Set(),
      maxChars: 1000,
    });

    expect(excerpt).toBe(fallbackSegment.compactPromptText);
  });

  it("respects the character budget even when a match is found", () => {
    const bulletSegment = segment({
      kind: "bullet_group",
      segmentText: Array.from(
        { length: 20 },
        (_, index) => `- Padding bullet number ${index + 1} about generic checkout wording.`,
      )
        .concat("- Keep the targetmarker token unchanged in every locale and never translate it.")
        .join("\n"),
    });

    const excerpt = buildSegmentExcerpt({
      segment: bulletSegment,
      queryTokens: tokens("targetmarker"),
      maxChars: 120,
    });

    expect(excerpt.length).toBeLessThanOrEqual(120);
    expect(excerpt).toContain("targetmarker");
  });

  it("hard-truncates a single oversized matching unit rather than dropping it", () => {
    const longSentence =
      "The onlymarker token must remain exactly as written across every single locale and screen and must never be reworded, abbreviated, translated, or otherwise altered by any translator or automated tool under any circumstances whatsoever.";

    const excerpt = buildSegmentExcerpt({
      segment: segment({ segmentText: longSentence }),
      queryTokens: tokens("onlymarker"),
      maxChars: 80,
    });

    expect(excerpt.length).toBeLessThanOrEqual(80);
    expect(excerpt).toContain("onlymarker");
  });

  it("chunks a punctuation-free oversized unit by words instead of returning it whole", () => {
    const punctuationFree =
      Array.from(
        { length: 20 },
        (_, index) => `identifierBatch${index + 1} inventorySync releaseGate`,
      ).join(" ") + " tailmarker resolvesInventoryDrift";

    const excerpt = buildSegmentExcerpt({
      segment: segment({ segmentText: punctuationFree }),
      queryTokens: tokens("tailmarker"),
      maxChars: 200,
    });

    expect(excerpt).toContain("tailmarker");
    expect(excerpt.length).toBeLessThanOrEqual(200);
  });

  it("includes the adjacent unit for a rule split across a condition and its action", () => {
    const paragraph = [
      "When the source text contains a discountcode marker, treat it as a promotional string.",
      "Always apply the promostyling guide to that label regardless of locale.",
    ].join(" ");

    const excerpt = buildSegmentExcerpt({
      segment: segment({ segmentText: paragraph }),
      queryTokens: tokens("discountcode"),
      maxChars: 200,
    });

    expect(excerpt).toContain("discountcode");
    expect(excerpt).toContain("promostyling");
  });

  it("keeps the highest-ranked oversized match instead of a smaller weaker one that fits", () => {
    const bulletSegment = segment({
      kind: "bullet_group",
      segmentText: [
        "- Keep the onlysmallword token unchanged and mention extramarker here.",
        "- The bigmarker rule applies broadly and also involves extramarker handling across every locale and screen, with a great deal of additional padding text included here purely to push this bullet's total length well past what fits inside a tight one hundred and twenty character budget window used for this test.",
      ].join("\n"),
    });

    const excerpt = buildSegmentExcerpt({
      segment: bulletSegment,
      queryTokens: tokens("bigmarker", "extramarker"),
      maxChars: 120,
    });

    expect(excerpt).toContain("bigmarker");
    expect(excerpt).not.toContain("onlysmallword");
  });

  it("locates a match for CJK query tokens without relying on ASCII word boundaries", () => {
    const padding =
      "これは一般的な説明文であり詳細な背景情報を含みますがここでは重要ではありません".repeat(6);
    const segmentText = `${padding} 特別コード は翻訳せずそのまま残してください`;

    const excerpt = buildSegmentExcerpt({
      segment: segment({ segmentText }),
      queryTokens: tokens("特別コード"),
      maxChars: 80,
    });

    expect(excerpt).toContain("特別コード");
  });

  it("is deterministic across repeated calls with the same input", () => {
    const longParagraph = [
      "The firstrule token applies at the start of this paragraph for every locale.",
      "This is unrelated filler prose about generic checkout localisation practices repeated to add length.".repeat(
        6,
      ),
      "The secondrule token applies near the end of this same paragraph for every locale.",
    ].join(" ");

    const input = {
      segment: segment({ segmentText: longParagraph }),
      queryTokens: tokens("firstrule", "secondrule"),
      maxChars: 250,
    };

    expect(buildSegmentExcerpt(input)).toBe(buildSegmentExcerpt(input));
  });
});
