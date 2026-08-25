import { execFileSync } from "node:child_process";
import process from "node:process";

const output = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], { encoding: "utf8" });
const licenses = JSON.parse(output);
const approvedSpdx = new Set(["Apache-2.0", "BSD-3-Clause", "BlueOak-1.0.0", "CC-BY-4.0", "ISC", "MIT", "MPL-2.0"]);
const reviewedCopilotRuntime = new Set([
  "@github/copilot@1.0.80",
  "@github/copilot-darwin-arm64@1.0.80",
  "@github/copilot-darwin-x64@1.0.80",
  "@github/copilot-linux-arm64@1.0.80",
  "@github/copilot-linux-x64@1.0.80",
  "@github/copilot-linuxmusl-arm64@1.0.80",
  "@github/copilot-linuxmusl-x64@1.0.80",
  "@github/copilot-win32-arm64@1.0.80",
  "@github/copilot-win32-x64@1.0.80",
]);

const failures = [];
for (const [license, packages] of Object.entries(licenses)) {
  if (approvedSpdx.has(license)) continue;
  if (license === "Unknown") {
    for (const item of packages) {
      for (const version of item.versions) {
        const identity = `${item.name}@${version}`;
        if (!reviewedCopilotRuntime.has(identity)) failures.push(`unreviewed unknown license: ${identity}`);
      }
    }
    continue;
  }
  failures.push(`unapproved or missing license group: ${license || "<missing>"}`);
}

if (failures.length > 0) {
  process.stderr.write(`License compatibility gate failed:\n${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`License gate passed (${String(Object.keys(licenses).length)} production license groups; exact Copilot runtime review enforced).\n`);
}
