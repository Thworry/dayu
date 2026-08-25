import { describe, expect, it } from "vitest";

import { adjudicateCopilotOutput, indexEvidence } from "./adjudicate.js";
import { evidenceFixture, outputFixture } from "./test-fixtures.js";

describe("Copilot output adjudication", () => {
  it("maps allowed verdicts to local risk and dimension", () => {
    const evidence = evidenceFixture();
    const result = adjudicateCopilotOutput({ findings: [outputFixture()] }, indexEvidence([evidence]));
    expect(result).toEqual([
      expect.objectContaining({ dimension: "claims", risk: 0, rubricId: "claims.install" }),
    ]);
  });

  it.each([
    ["mixed", 50, "[部分] 证据表现为部分一致。", "[MIXED] The evidence is mixed."],
    ["contradicted", 100, "[矛盾] 声明与证据不一致。", "[CONTRADICTED] The claim is contradicted by the evidence."],
    ["unverifiable", null, "[无法验证] 现有证据无法验证该声明。", "[UNVERIFIABLE] The claim is unverifiable from this evidence."],
    ["not_applicable", null, "[不适用] 该规则不适用。", "[NOT_APPLICABLE] This rubric is not applicable."],
  ] as const)("maps %s locally", (verdict, risk, zh, en) => {
    const claim = evidenceFixture();
    const counter = evidenceFixture({
      id: "ev_bbbbbbbbbbbbbbbbbbbbbbbb",
      source: { kind: "api", endpoint: "/repos/dayu/example/git/trees/abc", queryHash: "tree" },
      summary: "The complete tree contains no installation artifact.",
      fact: { metric: "repository.tree", value: { completeForNegativeEvidence: true } },
      value: { completeForNegativeEvidence: true },
    });
    const finding = outputFixture({
      verdict,
      counterEvidenceIds: verdict === "mixed" || verdict === "contradicted" ? [counter.id] : [],
      zh,
      en,
    });
    expect(adjudicateCopilotOutput({ findings: [finding] }, indexEvidence([claim, counter]))[0]?.risk).toBe(risk);
  });

  it("rejects an unknown Evidence ID", () => {
    const raw = { findings: [outputFixture({ evidenceIds: ["ev_cccccccccccccccccccccccc"] })] };
    expect(() => adjudicateCopilotOutput(raw, indexEvidence([evidenceFixture()]))).toThrow("unknown_evidence_id");
  });

  it("requires both claim evidence and counterevidence for contradicted", () => {
    const raw = { findings: [outputFixture({ verdict: "contradicted", counterEvidenceIds: [] })] };
    expect(() => adjudicateCopilotOutput(raw, indexEvidence([evidenceFixture()]))).toThrow("counterevidence_required");
  });

  it("requires complete scope for absence-based contradictions", () => {
    const claim = evidenceFixture();
    const partial = evidenceFixture({
      id: "ev_bbbbbbbbbbbbbbbbbbbbbbbb",
      status: "partial",
      fact: { metric: "repository.tree", value: { completeForNegativeEvidence: false } },
      value: { completeForNegativeEvidence: false },
      limitations: ["github_tree_truncated"],
    });
    const raw = { findings: [outputFixture({
      verdict: "contradicted",
      counterEvidenceIds: [partial.id],
      zh: "[矛盾] 声明与证据不一致。",
      en: "[CONTRADICTED] The claim is contradicted by the evidence.",
    })] };
    expect(() => adjudicateCopilotOutput(raw, indexEvidence([claim, partial]))).toThrow("complete_scope_required");
  });

  it("does not accept an unrelated complete item as complete negative scope", () => {
    const claim = evidenceFixture();
    const unrelated = evidenceFixture({ id: "ev_bbbbbbbbbbbbbbbbbbbbbbbb", fact: { metric: "repository.stars", value: 10 } });
    const finding = outputFixture({
      verdict: "contradicted",
      counterEvidenceIds: [unrelated.id],
      zh: "[矛盾] 声明与证据不一致。",
      en: "[CONTRADICTED] The claim is contradicted by the evidence.",
    });
    expect(() => adjudicateCopilotOutput({ findings: [finding] }, indexEvidence([claim, unrelated]))).toThrow("complete_scope_required");
  });

  it.each([
    { extra: true },
    { rubricId: "claims.unknown" },
    { verdict: "fake" },
    { evidenceIds: Array.from({ length: 7 }, () => "ev_aaaaaaaaaaaaaaaaaaaaaaaa") },
    { zh: "中".repeat(241) },
    { en: "e".repeat(301) },
  ])("rejects schema violations: %o", (overrides) => {
    expect(() => adjudicateCopilotOutput({ findings: [outputFixture(overrides)] }, indexEvidence([evidenceFixture()]))).toThrow(
      "invalid_copilot_output",
    );
  });

  it("rejects duplicate rubrics and duplicate or overlapping citations", () => {
    const evidence = evidenceFixture();
    expect(() => adjudicateCopilotOutput({ findings: [outputFixture(), outputFixture()] }, indexEvidence([evidence]))).toThrow(
      "duplicate_rubric_id",
    );
    expect(() => adjudicateCopilotOutput({ findings: [outputFixture({ evidenceIds: [evidence.id, evidence.id] })] }, indexEvidence([evidence]))).toThrow(
      "duplicate_evidence_id",
    );
    expect(() => adjudicateCopilotOutput({ findings: [outputFixture({ counterEvidenceIds: [evidence.id] })] }, indexEvidence([evidence]))).toThrow(
      "duplicate_evidence_id",
    );
  });

  it.each([
    { en: "See https://example.com for proof." },
    { en: "See ftp://example.com for proof." },
    { en: "[SUPPORTED] See github.com/acme/proof." },
    { en: "<strong>Supported</strong>." },
    { en: "<svg onload=alert(1)>bad</svg>" },
    { en: "This repository bought stars." },
    { en: "[SUPPORTED] This repository contains fabricated data." },
    { en: "[SUPPORTED] These stars were botted." },
    { en: "[SUPPORTED] The popularity is manufactured popularity." },
    { en: "[SUPPORTED] This is artificial engagement." },
    { en: "[SUPPORTED] The repository is legitimate." },
    { en: "This repository is definitely legitimate." },
    { zh: "这个项目绝无造假。" },
    { zh: "[支持] 这个项目包含虚假数据。" },
  ])("rejects unsafe or absolute copy: %o", (overrides) => {
    expect(() => adjudicateCopilotOutput({ findings: [outputFixture(overrides)] }, indexEvidence([evidenceFixture()]))).toThrow();
  });

  it("rejects inconsistent bilingual pairing", () => {
    expect(() => adjudicateCopilotOutput(
      { findings: [outputFixture({ zh: "Supported.", en: "支持。" })] },
      indexEvidence([evidenceFixture()]),
    )).toThrow("inconsistent_bilingual_pair");
  });

  it("requires exact matching verdict markers in both languages", () => {
    expect(() => adjudicateCopilotOutput(
      { findings: [outputFixture({ zh: "安装说明得到支持。" })] },
      indexEvidence([evidenceFixture()]),
    )).toThrow("inconsistent_bilingual_pair");
    expect(() => adjudicateCopilotOutput(
      { findings: [outputFixture({ en: "[MIXED] The installation claim is supported." })] },
      indexEvidence([evidenceFixture()]),
    )).toThrow("inconsistent_bilingual_pair");
  });

  it("replaces model-authored prose with local bilingual copy", () => {
    const finding = outputFixture({
      zh: "[支持] 模型自行撰写的句子。",
      en: "[SUPPORTED] Model-authored prose that must not survive.",
    });
    const [result] = adjudicateCopilotOutput({ findings: [finding] }, indexEvidence([evidenceFixture()]));
    expect(result?.en).toContain("1 primary and 0 counter-evidence");
    expect(result?.en).not.toContain("must not survive");
    expect(result?.zh).not.toContain("模型自行撰写");
  });

  it("rejects prose that conflicts with its structured verdict", () => {
    const finding = outputFixture({
      zh: "[支持] 证据与声明矛盾。",
      en: "[SUPPORTED] The evidence contradicts the claim.",
    });
    expect(() => adjudicateCopilotOutput({ findings: [finding] }, indexEvidence([evidenceFixture()]))).toThrow("inconsistent_bilingual_pair");
  });
});
