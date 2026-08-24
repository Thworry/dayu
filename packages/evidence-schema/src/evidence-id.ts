import { createHash } from "node:crypto";

export interface EvidenceIdInput {
  repoId: number;
  commitSha: string;
  kind: string;
  path: string;
}

export function createEvidenceId(input: EvidenceIdInput): string {
  const canonical = [input.repoId, input.commitSha, input.kind, input.path];
  return `ev_${createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 24)}`;
}
