import type { Evidence } from "@dayu/evidence-schema";

export function evidenceFixture(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "ev_aaaaaaaaaaaaaaaaaaaaaaaa",
    schemaVersion: "1",
    kind: "file",
    repository: { id: 1, fullName: "dayu/example" },
    source: { kind: "file", commitSha: "abcdef1234567890", path: "README.md" },
    observedAt: "2026-08-25T00:00:00.000Z",
    status: "complete",
    summary: "The README contains an installation claim.",
    value: { excerpt: "Install with pnpm." },
    fact: { metric: "readme.install", value: true },
    limitations: [],
    ...overrides,
  };
}

export function outputFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rubricId: "claims.install",
    verdict: "supported",
    evidenceIds: ["ev_aaaaaaaaaaaaaaaaaaaaaaaa"],
    counterEvidenceIds: [],
    zh: "[支持] 安装说明得到证据支持。",
    en: "[SUPPORTED] The installation claim is supported by the cited evidence.",
    ...overrides,
  };
}
