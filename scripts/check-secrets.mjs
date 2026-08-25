import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const privateKeyBegin = ["-----BEGIN PRIVATE", "KEY-----"].join(" ");
const privateKeyEnd = ["-----END PRIVATE", "KEY-----"].join(" ");
const allowedFakeValues = new Set([
  "ghu_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
  "AKIAABCDEFGHIJKLMNOP",
  "github-user-token-secret",
  "ghu_user_owned_secret",
  [privateKeyBegin, "abc", privateKeyEnd].join("\n"),
  `${privateKeyBegin}\\nabc\\n${privateKeyEnd}`,
]);
const detectors = [
  ...["", "RSA ", "EC ", "OPENSSH "].map((type) => ({
    label: "private key",
    pattern: new RegExp(`-----BEGIN ${type}PRIVATE KEY-----[\\s\\S]{0,8192}?-----END ${type}PRIVATE KEY-----`, "gu"),
  })),
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/gu },
  { label: "GitHub fine-grained token", pattern: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/gu },
  { label: "AWS access key", pattern: /\bAKIA[A-Z0-9]{16}\b/gu },
  {
    label: "OAuth client secret",
    pattern: /\b(?:oauth|github|copilot)[_.-]?(?:client[_.-]?)?secret\b\s*(?::|=)\s*["'`]?([A-Za-z0-9._~+/=-]{20,})/giu,
    valueIndex: 1,
  },
  {
    label: "bearer credential",
    pattern: /\bbearer\s+([A-Za-z0-9._~+/=-]{20,})\b/giu,
    valueIndex: 1,
  },
  {
    label: "secret assignment",
    pattern: /\b(?:access[_-]?token|refresh[_-]?token|github[_-]?token|copilot[_-]?(?:token|credential|secret|api[_-]?key)|api[_-]?key|secret[_-]?key|signing[_-]?key|vault[_-]?(?:key|secret)|encryption[_-]?(?:key|secret)|password|passwd|database[_-]?url)\b\s*(?::|=)\s*["'`]?([A-Za-z0-9._~+/=@:-]{20,})/giu,
    valueIndex: 1,
  },
];

const findings = [];
function scan(label, text) {
  for (const detector of detectors) {
    detector.pattern.lastIndex = 0;
    for (const match of text.matchAll(detector.pattern)) {
      const value = match[detector.valueIndex ?? 0] ?? match[0];
      if (allowedFakeValues.has(value)) continue;
      findings.push(`${label}: ${detector.label}`);
    }
  }
}
for (const file of files) {
  const content = readFileSync(file);
  scan(file, content.toString("latin1"));
}

const reachable = execFileSync("git", ["rev-list", "--objects", "--all"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean);
const objectPaths = new Map(reachable.map((line) => {
  const separator = line.indexOf(" ");
  return separator === -1 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)];
}));
const objectIds = [...objectPaths.keys()];
const objectTypes = execFileSync("git", ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
  encoding: "utf8",
  input: `${objectIds.join("\n")}\n`,
  maxBuffer: 64 * 1_024 * 1_024,
});
let historicalBlobs = 0;
for (const line of objectTypes.trim().split("\n")) {
  const [objectId, type] = line.split(" ");
  if (objectId === undefined || type !== "blob") continue;
  const content = execFileSync("git", ["cat-file", "blob", objectId], { encoding: "buffer", maxBuffer: 64 * 1_024 * 1_024 });
  scan(`git-object:${objectId}:${objectPaths.get(objectId) ?? ""}`, content.toString("latin1"));
  historicalBlobs += 1;
}
if (findings.length > 0) {
  process.stderr.write(`Potential committed secrets:\n${findings.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Secret scan passed (${String(files.length)} tracked files and ${String(historicalBlobs)} reachable Git blobs, including binary contents; exact fake fixtures only).\n`);
}
