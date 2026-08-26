const maliciousText = `</strong><img src=x onerror="window.__dayuPwned=true"><script>window.__dayuPwned=true</script><svg onload="window.__dayuPwned=true"></svg>`;

const evidence = {
  fact: { metric: "repository.metadata", value: { description: maliciousText } },
  id: "ev_aaaaaaaaaaaaaaaaaaaaaaaa",
  kind: "metadata",
  limitations: [],
  observedAt: "2026-08-25T00:00:00.000Z",
  repository: { fullName: "owner/reality-check", id: 1024 },
  schemaVersion: "1",
  source: { endpoint: "/repos/owner/reality-check", kind: "api", queryHash: "public-v1" },
  status: "complete",
  summary: maliciousText,
  value: { description: maliciousText },
} as const;

export const maliciousRepositoryReport = {
  baseScore: 18,
  collectorVersion: "collector-v1",
  confidence: 82,
  createdAt: "2026-08-25T00:00:00.000Z",
  dataStatus: "complete",
  dimensionScores: { claims: 12, community: 16, maintenance: 20, popularity: 22, substance: 14 },
  evidence: [evidence],
  evidenceIndex: { [evidence.id]: evidence },
  expiresAt: "2099-08-25T00:30:00.000Z",
  findings: [],
  locale: "en",
  missingSignals: [],
  positiveSignals: [],
  reportVersion: "1",
  researchPreview: {
    calibrationStatus: "uncalibrated",
    normalizerKind: "synthetic_reference",
    normalizerVersion: "normalizer-v1",
    releaseStage: "pre_beta",
  },
  repository: { defaultBranch: "main", fullName: "owner/reality-check", id: 1024 },
  repositoryType: "software",
  rulesVersion: "rules-v1",
  score: 18,
  scoreKind: "rules_only",
  sourceCommit: "abcdef1234567",
} as const;

export { maliciousText };
