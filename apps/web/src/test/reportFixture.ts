import type { Evidence, ReportSnapshot } from "@dayu/evidence-schema";

const evidenceId = "ev_aaaaaaaaaaaaaaaaaaaaaaaa";

const evidence = {
  fact: { metric: "repository.stargazers_count", unit: "count", value: 42 },
  id: evidenceId,
  kind: "metadata",
  limitations: [],
  observedAt: "2026-08-25T00:00:00.000Z",
  repository: { fullName: "facebook/react", id: 1024 },
  schemaVersion: "1",
  source: { endpoint: "/repos/facebook/react", kind: "api", queryHash: "public-v1" },
  status: "complete",
  summary: "Public repository metadata",
  value: 42,
} satisfies Evidence;

export const reportFixture = {
  baseScore: 18,
  collectorVersion: "collector-v1",
  confidence: 82,
  createdAt: "2026-08-25T00:00:00.000Z",
  dataStatus: "partial",
  dimensionScores: { claims: 12, community: 16, maintenance: 20, popularity: 22, substance: 14 },
  evidence: [evidence],
  evidenceIndex: { [evidenceId]: evidence },
  expiresAt: "2099-08-25T00:30:00.000Z",
  findings: [],
  locale: "en",
  missingSignals: ["releases"],
  positiveSignals: [],
  reportVersion: "1",
  repository: { defaultBranch: "main", fullName: "facebook/react", id: 1024 },
  repositoryType: "software",
  rulesVersion: "rules-v1",
  score: 18,
  scoreKind: "rules_only",
  sourceCommit: "abcdef1234567",
} satisfies ReportSnapshot;
