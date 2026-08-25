import { readFile } from "node:fs/promises";

import { verifyProductionScoringData } from "./compose.js";
import { parseGoldenCaseSet, parseNormalizerSnapshot } from "./schema.js";

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")) as unknown;
}

const normalizer = parseNormalizerSnapshot(await json("../data/normalizer-v1.json"));
const golden = parseGoldenCaseSet(await json("../data/golden-cases-v1.json"));
process.stdout.write(`${verifyProductionScoringData(golden, normalizer)}\n`);
