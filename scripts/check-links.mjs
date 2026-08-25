import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

const files = [
  "README.md",
  "README.zh-CN.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/methodology.md",
  "docs/privacy.md",
  "docs/self-hosting.md",
];
const failures = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const links = [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
  for (const link of links) {
    if (link === undefined || /^(?:https?:|mailto:|#)/u.test(link)) continue;
    const withoutFragment = decodeURIComponent(link.split("#", 1)[0] ?? "");
    if (withoutFragment === "" || !existsSync(resolve(dirname(file), withoutFragment))) failures.push(`${file}: missing ${link}`);
  }
}
if (failures.length > 0) {
  process.stderr.write(`Documentation link gate failed:\n${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Documentation link gate passed (${String(files.length)} files).\n`);
}
