import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import sample from "../../apps/web/src/data/dayu-sample.json" with { type: "json" };

let previewServer: Server | undefined;
let previewOrigin: string;

test.beforeAll(async () => {
  await promisify(execFile)("pnpm", ["--filter", "@dayu/web", "build:preview"], { cwd: process.cwd() });
  const output = resolve("apps/web/dist-preview");
  // Serve only emitted Pages files on an isolated ephemeral loopback port.
  // No CSP response header: the test must exercise the policy embedded for Pages.
  const server = createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const asset = /^\/dayu\/assets\/([a-zA-Z0-9._-]+\.(?:js|css))$/u.exec(pathname);
      const file = pathname === "/dayu/" ? "index.html" : asset?.[1] === undefined ? undefined : `assets/${asset[1]}`;
      if (file === undefined) { response.writeHead(404); response.end(); return; }
      try {
        const contents = await readFile(resolve(output, file));
        response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.end(contents);
      } catch { response.writeHead(404); response.end(); }
    })();
  });
  previewServer = server;
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { resolveReady(); });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No preview port allocated");
  previewOrigin = `http://127.0.0.1:${String(address.port)}`;
});

test.afterAll(async () => {
  const server = previewServer;
  if (server === undefined) return;
  await new Promise<void>((resolveClosed, reject) => {
    server.close((error) => { if (error === undefined) resolveClosed(); else reject(error); });
  });
});

test("both local sample routes are accessible and perform no scan or session requests", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });
  for (const locale of ["en", "zh"] as const) {
    await page.goto(`/${locale}/sample`);
    await expect(page.getByRole("heading", { name: "Thworry/dayu" })).toBeVisible();
    await expect(page.getByTestId("precise-score")).toHaveCount(0);
    await page.getByRole("searchbox", { name: locale === "zh" ? "搜索证据" : "Search evidence" }).fill("does-not-exist");
    await expect(page.locator(".evidence-explorer li")).toHaveCount(0);
    await page.getByRole("searchbox").clear();
    await expect(page.locator(".evidence-explorer li")).toHaveCount(sample.evidence.length);
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(accessibility.violations.filter((item) => item.impact === "serious" || item.impact === "critical")).toEqual([]);
  }
  expect(apiRequests).toEqual([]);
});

test("Pages preview keeps evidence navigation local and blocks network connections with its embedded CSP", async ({ page }) => {
  const connections: string[] = [];
  const scriptErrors: string[] = [];
  page.on("request", (request) => {
    if (["fetch", "xhr", "websocket"].includes(request.resourceType())) connections.push(request.url());
  });
  page.on("pageerror", (error) => { scriptErrors.push(error.message); });
  await page.goto(`${previewOrigin}/dayu/?lang=en`);
  await expect(page.getByText("Public self-check · saved snapshot")).toBeVisible();
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(policy).toContain("connect-src 'none'");
  expect(policy).toContain("form-action 'none'");
  const evidenceLink = page.locator('.findings-section a[href^="#evidence-"]').first();
  const hash = await evidenceLink.getAttribute("href");
  expect(hash).toBeTruthy();
  await evidenceLink.click();
  expect(new URL(page.url()).hash).toBe(hash);
  await page.locator(".locale-switch").click();
  expect(new URL(page.url()).pathname).toBe("/dayu/");
  expect(new URL(page.url()).search).toBe("?lang=zh");
  expect(new URL(page.url()).hash).toBe(hash);
  await expect(page.getByText("公开自检样例 · 历史快照")).toBeVisible();
  if (hash === null) throw new Error("Missing evidence hash");
  await expect(page.locator(hash)).toBeVisible();
  await expect(page.locator('a[href^="/api/"], a[href^="/en/r/"], a[href^="/zh/r/"]')).toHaveCount(0);
  expect(connections).toEqual([]);
  expect(scriptErrors).toEqual([]);

  // An explicit probe confirms that the meta policy is enforced, not just present.
  const connectionBlocked = await page.evaluate(async () => {
    try { await fetch("/api/preview-csp-probe"); return false; } catch { return true; }
  });
  expect(connectionBlocked).toBe(true);
});

test("Pages preview downloads the exact saved JSON and a valid PNG without an API", async ({ page }) => {
  const connections: string[] = [];
  page.on("request", (request) => {
    if (["fetch", "xhr"].includes(request.resourceType())) connections.push(request.url());
  });
  await page.goto(`${previewOrigin}/dayu/?lang=en`);
  const jsonEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download evidence JSON" }).click();
  const json = await jsonEvent;
  const jsonPath = await json.path();
  expect(json.suggestedFilename()).toBe("Thworry-dayu-dayu.json");
  expect(JSON.parse(await readFile(jsonPath, "utf8"))).toEqual(sample);

  const pngEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download share card" }).click();
  const png = await pngEvent;
  const pngPath = await png.path();
  const bytes = await readFile(pngPath);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.length).toBeGreaterThan(1_000);
  expect(png.suggestedFilename()).toBe("Thworry-dayu-dayu.png");
  expect(connections).toEqual([]);
});
