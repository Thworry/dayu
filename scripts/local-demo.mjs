import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const LOOPBACK = "127.0.0.1";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const smoke = process.argv.includes("--smoke");
const children = new Set();
let stopping = false;

function portFromEnvironment(name) {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1024 and 65535`);
  }
  return port;
}

async function availablePort(preferred) {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (reason) => {
      if (reason.code !== "EADDRINUSE") {
        reject(reason);
        return;
      }
      server.listen({ host: LOOPBACK, port: 0 });
    });
    server.once("listening", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not reserve a local demo port"));
        return;
      }
      server.close((reason) => {
        if (reason === undefined) resolvePort(address.port);
        else reject(reason);
      });
    });
    server.listen({ host: LOOPBACK, port: preferred });
  });
}

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...options.environment },
    stdio: "inherit",
  });
  children.add(child);
  child.once("exit", () => { children.delete(child); });
  return child;
}

async function runToCompletion(command, args) {
  const child = run(command, args);
  const code = await new Promise((resolveCode, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (signal !== null) reject(new Error(`${command} stopped by ${signal}`));
      else resolveCode(exitCode ?? 1);
    });
  });
  if (code !== 0) throw new Error(`${command} exited with status ${code}`);
}

async function waitForReady(url, child, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} stopped before becoming ready`);
    try {
      const response = await globalThis.fetch(url, { headers: { accept: "application/json" }, signal: globalThis.AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The process is still starting. Retry until the bounded deadline.
    }
    await new Promise((resolveWait) => { globalThis.setTimeout(resolveWait, 150); });
  }
  throw new Error(`${label} did not become ready within 30 seconds`);
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => { child.once("exit", resolveExit); }),
    new Promise((resolveWait) => { globalThis.setTimeout(resolveWait, 3_000); }),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled([...children].map(stopChild));
}

async function assertSmokeChecks(webOrigin, apiOrigin) {
  const [webReady, apiReady, authCapability] = await Promise.all([
    globalThis.fetch(`${webOrigin}/__dayu/ready`, { headers: { accept: "application/json" } }),
    globalThis.fetch(`${apiOrigin}/health`, { headers: { accept: "application/json" } }),
    globalThis.fetch(`${webOrigin}/api/auth/session`, { headers: { accept: "application/json" } }),
  ]);
  if (!webReady.ok || !apiReady.ok) throw new Error("Local demo readiness check failed");
  const authBody = await authCapability.json();
  if (authCapability.status !== 503 || authBody?.error?.code !== "oauth_unavailable") {
    throw new Error("Rules-only demo did not expose the expected OAuth-unavailable capability state");
  }
}

async function waitUntilStopped(api, web) {
  await new Promise((resolveStop, reject) => {
    const onSignal = () => { resolveStop(); };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    for (const [child, label] of [[api, "API"], [web, "web server"]]) {
      child.once("exit", (code, signal) => {
        if (!stopping) reject(new Error(`${label} stopped unexpectedly (${signal ?? code ?? "unknown"})`));
      });
    }
  });
}

try {
  const requestedWebPort = portFromEnvironment("DAYU_DEMO_WEB_PORT");
  const requestedApiPort = portFromEnvironment("DAYU_DEMO_API_PORT");
  const webPort = requestedWebPort ?? await availablePort(4173);
  const apiPort = requestedApiPort ?? await availablePort(webPort === 4174 ? 4175 : 4174);
  if (webPort === apiPort) throw new Error("DAYU demo web and API ports must be different");

  process.stdout.write("Building the DAYU web app…\n");
  await runToCompletion("pnpm", ["--filter", "@dayu/web", "build"]);

  const api = run("pnpm", ["--filter", "@dayu/api", "start"], {
    environment: { API_HOST: LOOPBACK, API_PORT: String(apiPort), API_TRUSTED_PROXIES: "" },
  });
  const apiOrigin = `http://${LOOPBACK}:${apiPort}`;
  await waitForReady(`${apiOrigin}/health`, api, "DAYU API");

  const web = run("pnpm", ["--filter", "@dayu/web", "start"], {
    environment: { DAYU_API_ORIGIN: apiOrigin, DAYU_WEB_PORT: String(webPort) },
  });
  const webOrigin = `http://${LOOPBACK}:${webPort}`;
  await waitForReady(`${webOrigin}/__dayu/ready`, web, "DAYU web server");

  process.stdout.write([
    "",
    "DAYU local demo is ready / 大禹治水本地演示已就绪",
    `中文：${webOrigin}/zh`,
    `English: ${webOrigin}/en`,
    "Boundary / 边界：public repositories only; rules-only by default; no OAuth or Copilot is configured.",
    "仅分析公开仓库；默认只运行规则分析；本地演示未配置 OAuth 或 Copilot。",
    "A result reports public-signal risk and inconsistency—not proof of bought engagement, fraud, or intent.",
    "结果只报告公开信号风险与不协调，不能证明买量、造假或主观意图。",
    "",
  ].join("\n"));

  if (smoke) {
    await assertSmokeChecks(webOrigin, apiOrigin);
    process.stdout.write("DAYU demo smoke checks passed / 本地演示冒烟检查通过\n");
  } else {
    process.stdout.write("Press Ctrl+C to stop / 按 Ctrl+C 停止\n");
    await waitUntilStopped(api, web);
  }
} catch (reason) {
  const message = reason instanceof Error ? reason.message : "unknown local demo failure";
  process.stderr.write(`DAYU local demo failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  await shutdown();
}
