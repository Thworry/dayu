import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { evaluateReleaseGate } from "./evaluate.js";
import { createCalibrationReport } from "./report.js";
import { parseGoldenCaseSet, parseNormalizerSnapshot, parseReleaseEvidence } from "./schema.js";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")) as unknown;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`missing_${name.slice(2).replaceAll("-", "_")}`);
  return value;
}

async function main(): Promise<void> {
  const normalizer = parseNormalizerSnapshot(await readJson("../data/normalizer-v1.json"));
  const golden = parseGoldenCaseSet(await readJson("../data/golden-cases-v1.json"));
  const releaseEvidencePath = option("--release-evidence") ?? process.env.DAYU_RELEASE_EVIDENCE_PATH;
  const releaseEvidence = parseReleaseEvidence(releaseEvidencePath === undefined
    ? await readJson("../data/release-evidence-v1.json")
    : JSON.parse(await readFile(resolve(releaseEvidencePath), "utf8")) as unknown);
  const protectedRuntime = process.env.GITHUB_ACTIONS === "true"
    ? { commitSha: process.env.GITHUB_SHA, source: "github_actions_protected_environment", workflowRunId: process.env.GITHUB_RUN_ID }
    : undefined;
  const gate = evaluateReleaseGate(normalizer, golden, releaseEvidence, protectedRuntime);
  process.stdout.write(`${JSON.stringify(createCalibrationReport({ gate, golden, normalizer }), null, 2)}\n`);
  if (process.argv.includes("--require-beta") && gate.status !== "beta_ready") process.exitCode = 1;
}

await main();
