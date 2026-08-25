import type { Evidence } from "@dayu/evidence-schema";
import { ZodError } from "zod";

import {
  copilotAnalysisSchema,
  type AiDimension,
  type AiFinding,
  type CopilotAnalysis,
  type RubricId,
  type Verdict,
} from "./schema.js";

export type EvidenceIndex = ReadonlyMap<string, Evidence>;

const DIMENSION_BY_RUBRIC: Readonly<Record<RubricId, AiDimension>> = {
  "substance.artifact": "substance",
  "maintenance.status": "maintenance",
  "community.claim": "community",
  "claims.install": "claims",
  "claims.badge": "claims",
  "claims.roadmap": "claims",
};

const COMPLETE_SCOPE_REQUIRED = new Set<RubricId>([
  "substance.artifact",
  "claims.install",
  "claims.badge",
  "claims.roadmap",
]);
const RAW_URL = /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.)\S+|\b(?:data|file|javascript|mailto):|\b(?:[a-z0-9-]+\.)+(?:ai|app|cn|co|com|dev|info|io|me|net|org)(?:\/[^\s]*)?/i;
const RAW_MARKUP = /<\/?(?:[a-z][^>]*|svg)(?:>|\s)|<svg\b|javascript:/i;
const ABSOLUTE_ACCUSATION = /\b(?:artificial engagement|manufactured popularity|fake|faked|fabricated|falsified|fraud|fraudulent|scam|manipulated|purchased|botted)(?:\s+(?:activity|data|engagement|popularity|repo(?:sitory)?|stars?))?\b|\b(?:bought|botted|fake|purchased)\s+stars?\b|(?:假|伪造|虚假|操纵|买量|买星|刷量|刷星|水军|诈骗|欺诈|造假)/i;
const ABSOLUTE_EXONERATION = /\b(?:the\s+)?repo(?:sitory)?\s+is\s+(?:legitimate|authentic|genuine)\b|\b(?:clearly|definitely|proven|certainly|completely)\s+(?:(?:not\s+(?:fake|fabricated|falsified|fraudulent|manipulated))|legitimate|authentic|genuine)|\bno\s+(?:evidence\s+of\s+)?(?:fraud|manipulation|fake stars?)\b|\b(?:guaranteed|proven)\s+(?:authentic|genuine|legitimate)\b|(?:绝无造假|完全真实|保证真实|绝对可信|确保真实|项目真实可信)/i;
const CJK = /[\u3400-\u9fff]/;
const VERDICT_MARKERS: Readonly<Record<Verdict, { zh: string; en: string }>> = {
  supported: { zh: "[支持]", en: "[SUPPORTED]" },
  mixed: { zh: "[部分]", en: "[MIXED]" },
  contradicted: { zh: "[矛盾]", en: "[CONTRADICTED]" },
  unverifiable: { zh: "[无法验证]", en: "[UNVERIFIABLE]" },
  not_applicable: { zh: "[不适用]", en: "[NOT_APPLICABLE]" },
};

export function indexEvidence(evidence: readonly Evidence[]): Map<string, Evidence> {
  if (new Set(evidence.map((item) => item.id)).size !== evidence.length) fail("duplicate_input_evidence_id");
  return new Map(evidence.map((item) => [item.id, item]));
}

function fail(code: string): never {
  throw new Error(code);
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function validateText(zh: string, en: string, verdict: Verdict): void {
  const combined = `${zh}\n${en}`;
  if (RAW_URL.test(combined) || RAW_MARKUP.test(combined)) fail("unsafe_output_content");
  if (ABSOLUTE_ACCUSATION.test(combined) || ABSOLUTE_EXONERATION.test(combined)) fail("absolute_claim_rejected");
  if (!CJK.test(zh) || CJK.test(en) || !/[A-Za-z]/.test(en)) fail("inconsistent_bilingual_pair");
  const markers = VERDICT_MARKERS[verdict];
  if (!zh.startsWith(markers.zh) || !en.startsWith(markers.en)) fail("inconsistent_bilingual_pair");
  const zhBody = zh.slice(markers.zh.length);
  const enBody = en.slice(markers.en.length);
  const conflicting = verdict === "supported"
    ? /(?:矛盾|不一致|不支持|缺失)/.test(zhBody) || /\b(?:contradict|mismatch|unsupported|missing|absent)/i.test(enBody)
    : verdict === "contradicted"
      ? /(?:得到支持|证据支持|相符)/.test(zhBody) || /\b(?:supported|consistent|aligns?|matches)\b/i.test(enBody)
      : false;
  if (conflicting) fail("inconsistent_bilingual_pair");
}

function localCopy(finding: { rubricId: RubricId; verdict: Verdict; evidenceIds: string[]; counterEvidenceIds: string[] }): { zh: string; en: string } {
  const marker = VERDICT_MARKERS[finding.verdict];
  const rubricZh: Record<RubricId, string> = {
    "substance.artifact": "交付物与项目内容",
    "maintenance.status": "维护状态",
    "community.claim": "社区声明",
    "claims.install": "安装声明",
    "claims.badge": "徽章声明",
    "claims.roadmap": "路线图声明",
  };
  const rubricEn: Record<RubricId, string> = {
    "substance.artifact": "Artifact and repository substance",
    "maintenance.status": "Maintenance status",
    "community.claim": "Community claim",
    "claims.install": "Installation claim",
    "claims.badge": "Badge claim",
    "claims.roadmap": "Roadmap claim",
  };
  return {
    zh: `${marker.zh} ${rubricZh[finding.rubricId]}：引用 ${String(finding.evidenceIds.length)} 条主证据和 ${String(finding.counterEvidenceIds.length)} 条反证。`,
    en: `${marker.en} ${rubricEn[finding.rubricId]}: ${String(finding.evidenceIds.length)} primary and ${String(finding.counterEvidenceIds.length)} counter-evidence citation(s).`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function declaresCompleteScope(value: unknown): boolean {
  if (value === true || value === "complete") return true;
  if (!isRecord(value)) return false;
  if (value.truncated === true || value.apiTruncated === true || value.sampled === true || value.restricted === true) return false;
  return value.complete === true || value.completeForNegativeEvidence === true || (
    value.coverage === "complete"
  );
}

function isCompleteScopeEvidence(item: Evidence | undefined): boolean {
  if (item?.status !== "complete") return false;
  if (!/(?:^|\.)(?:file_?tree|files?_?scope|inventory|search|tree)(?:$|\.)/i.test(item.fact.metric)) return false;
  if (item.limitations.some((limitation) => /truncat|sampl|restrict|partial|incomplete|bounded/i.test(limitation))) return false;
  return declaresCompleteScope(item.fact.value) || declaresCompleteScope(item.value);
}

function riskFor(verdict: Verdict): 0 | 50 | 100 | null {
  if (verdict === "supported") return 0;
  if (verdict === "mixed") return 50;
  if (verdict === "contradicted") return 100;
  return null;
}

function validateCitations(finding: {
  rubricId: RubricId;
  verdict: Verdict;
  evidenceIds: string[];
  counterEvidenceIds: string[];
}, evidenceIndex: EvidenceIndex): void {
  const citations = [...finding.evidenceIds, ...finding.counterEvidenceIds];
  if (hasDuplicates(finding.evidenceIds) || hasDuplicates(finding.counterEvidenceIds)) fail("duplicate_evidence_id");
  if (finding.evidenceIds.some((id) => finding.counterEvidenceIds.includes(id))) fail("duplicate_evidence_id");
  if (citations.some((id) => !evidenceIndex.has(id))) fail("unknown_evidence_id");

  if (finding.verdict === "supported" && finding.evidenceIds.length === 0) fail("evidence_required");
  if (finding.verdict === "mixed" && (finding.evidenceIds.length === 0 || finding.counterEvidenceIds.length === 0)) {
    fail("counterevidence_required");
  }
  if (finding.verdict !== "contradicted") return;
  if (finding.evidenceIds.length === 0 || finding.counterEvidenceIds.length === 0) fail("counterevidence_required");
  if (COMPLETE_SCOPE_REQUIRED.has(finding.rubricId)) {
    const counterEvidence = finding.counterEvidenceIds.map((id) => evidenceIndex.get(id));
    if (!counterEvidence.some(isCompleteScopeEvidence)) fail("complete_scope_required");
  }
}

export function adjudicateCopilotOutput(raw: unknown, evidenceIndex: EvidenceIndex): AiFinding[] {
  let parsed;
  try {
    parsed = copilotAnalysisSchema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) fail("invalid_copilot_output");
    throw error;
  }

  const rubricIds = parsed.findings.map((finding) => finding.rubricId);
  if (hasDuplicates(rubricIds)) fail("duplicate_rubric_id");

  return parsed.findings.map((finding): AiFinding => {
    validateCitations(finding, evidenceIndex);
    validateText(finding.zh, finding.en, finding.verdict);
    const copy = localCopy(finding);
    return {
      ...finding,
      ...copy,
      dimension: DIMENSION_BY_RUBRIC[finding.rubricId],
      risk: riskFor(finding.verdict),
    };
  });
}

export function adjudicateCopilotAnalysis(raw: unknown, evidenceIndex: EvidenceIndex): CopilotAnalysis {
  return { findings: adjudicateCopilotOutput(raw, evidenceIndex) };
}
