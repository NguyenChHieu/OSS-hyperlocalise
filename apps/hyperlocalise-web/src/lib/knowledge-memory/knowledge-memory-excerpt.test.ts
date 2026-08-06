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

  it("favors a discriminative rule match over a generic term that matches several bullets", () => {
    // Regression for a Codex finding: raw integer scoring gave the generic "commonword" term the
    // same weight per match as the specific "tailmarker" term. With "commonword" appearing in two
    // bullets and "tailmarker" in one, the old flat scoring left all three bullets tied at 1, and
    // ties broke by document order — the oversized, commonword-only bullet won and hid the
    // tailmarker rule entirely. Weighting by 1/(matching unit count) makes "tailmarker" (rarer,
    // more discriminative) outscore either "commonword" bullet.
    const bulletSegment = segment({
      kind: "bullet_group",
      segmentText: [
        "- The commonword flow must render every step in order across every locale and screen for every commonword session, with substantial padding here to push this bullet's length well past what a tight budget window can hold in this test.",
        "- The commonword should always show the order total above the shipping address.",
        "- Never translate the tailmarker identifier.",
      ].join("\n"),
    });

    const excerpt = buildSegmentExcerpt({
      segment: bulletSegment,
      queryTokens: tokens("commonword", "tailmarker"),
      maxChars: 120,
    });

    expect(excerpt).toContain("tailmarker");
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

  it("reserves body space instead of letting a long heading consume the whole budget", () => {
    const deeplyNestedSegment = segment({
      headingPath: [
        "Memory.md",
        "A very long section heading that eats most of the budget",
        "An equally verbose subsection name",
        "de-DE",
      ],
      segmentText: "Never translate the routingtoken internal identifier under any circumstances.",
    });

    const excerpt = buildSegmentExcerpt({
      segment: deeplyNestedSegment,
      queryTokens: tokens("routingtoken"),
      maxChars: 80,
    });

    expect(excerpt.length).toBeLessThanOrEqual(80);
  });

  it("keeps the opening rule for a heading-driven match instead of only an incidental body match", () => {
    // Regression for a Codex finding: the segment is selected because "routingtoken" is in its
    // heading, not because that word appears in its body. Its body's only literal query overlap
    // is an incidental locale mention near the end, unrelated to the actual rule at the start.
    const routingSegment = segment({
      headingPath: ["Memory.md", "routingtoken"],
      segmentText: [
        "Never translate the internal identifier under any circumstances.",
        "This section applies broadly across checkout flows.",
        "This guidance also applies to the de-DE locale rollout.",
      ].join(" "),
    });

    const excerpt = buildSegmentExcerpt({
      segment: routingSegment,
      queryTokens: tokens("routingtoken", "de-DE"),
      maxChars: 200,
    });

    expect(excerpt).toContain("Never translate the internal identifier");
  });

  it("includes the parser-level neighbour when a rule's action lives in the next segment", () => {
    // Regression for a Codex finding: a condition/action pair can be split across two parsed
    // segments (e.g. a bullet followed by a paragraph), not just across sentences within one.
    // That context lives in previousNeighbourText/nextNeighbourText, outside segmentText.
    const bulletSegment = segment({
      kind: "bullet_group",
      segmentText: "- Never translate the discountcode identifier.",
      nextNeighbourText: "Always apply the promostyling guide to that label regardless of locale.",
    });

    const excerpt = buildSegmentExcerpt({
      segment: bulletSegment,
      queryTokens: tokens("discountcode"),
      maxChars: 300,
    });

    expect(excerpt).toContain("discountcode");
    expect(excerpt).toContain("promostyling");
  });

  it("does not pull in neighbour context when there is no budget left for it", () => {
    const bulletSegment = segment({
      kind: "bullet_group",
      segmentText: "- Never translate the discountcode identifier.",
      nextNeighbourText: "Always apply the promostyling guide to that label regardless of locale.",
    });

    const excerpt = buildSegmentExcerpt({
      segment: bulletSegment,
      queryTokens: tokens("discountcode"),
      maxChars: 60,
    });

    expect(excerpt.length).toBeLessThanOrEqual(60);
    expect(excerpt).toContain("discountcode");
    expect(excerpt).not.toContain("promostyling");
  });

  it("centers on the real token occurrence, not a false-positive substring match", () => {
    // Regression for a Codex finding: a plain substring search for "cart" would match inside
    // "cartography" first, centering the excerpt there and discarding the real "cart" rule later
    // in the same oversized unit.
    const longSentence =
      `A cartography reference guide is unrelated filler text repeated to push this single ` +
      `sentence well past the character budget so it must be truncated around a match. ${"padding word ".repeat(6)}Never abbreviate the cart label in checkout under any circumstances whatsoever here.`;

    const excerpt = buildSegmentExcerpt({
      segment: segment({ segmentText: longSentence }),
      queryTokens: tokens("cart"),
      maxChars: 80,
    });

    expect(excerpt).toContain("cart label");
  });

  it("does not let an appended neighbour separator push the excerpt past bodyBudget", () => {
    // Regression for a Codex finding: appending `separator + suffix` after truncating the
    // suffix to the full remaining budget overruns bodyBudget by separator.length.
    const bulletSegment = segment({
      kind: "bullet_group",
      segmentText: "- Never translate the discountcode identifier.",
      nextNeighbourText: "Always apply the promostyling guide to that label regardless of locale.",
    });

    const maxChars = 120;
    const excerpt = buildSegmentExcerpt({
      segment: bulletSegment,
      queryTokens: tokens("discountcode"),
      maxChars,
    });

    expect(excerpt.length).toBeLessThanOrEqual(maxChars);
  });

  it("splits sentences that start with an accented capital instead of merging them", () => {
    // Regression for a Codex finding: the sentence-boundary regex only recognized ASCII
    // A-Z/0-9 after the terminator, so a sentence starting with an accented capital (É, Ç, ...)
    // never counted as a new sentence. A paragraph under the 400-char oversized-unit cutoff, with
    // an unrelated filler sentence between two rule sentences, then collapsed into one giant unit.
    // The single-window truncateAroundMatch centers on the earliest match and can't reach a second
    // rule far past its window, even though splitting would let packing keep both rule sentences
    // and drop only the irrelevant filler between them.
    const padding =
      "Écrivez toujours des notes générales sans importance ici pour combler cet espace. ".repeat(
        3,
      );
    const paragraph = [
      "Évitez toujours le mot firstrule dans le texte.",
      padding.trim(),
      "Étudiez toujours la règle secondrule avant de valider.",
    ].join(" ");

    const excerpt = buildSegmentExcerpt({
      segment: segment({ segmentText: paragraph }),
      queryTokens: tokens("firstrule", "secondrule"),
      maxChars: 150,
    });

    expect(excerpt).toContain("firstrule");
    expect(excerpt).toContain("secondrule");
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
