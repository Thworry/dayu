import { expect, test } from "@playwright/test";

import { scanToReport } from "./fixtures/real-dayu.js";
import { openReportDetail } from "./fixtures/report-details.js";

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

test("the dedicated readiness probe identifies the DAYU production static server", async ({ baseURL, request }) => {
  const response = await request.get(`${baseURL ?? ""}/__dayu/ready`);
  expect(response.ok()).toBe(true);
  expect(response.headers()["x-dayu-app"]).toBe("repo-reality-check");
  await expect(response.json()).resolves.toEqual({ app: "DAYU", ready: true, server: "production-static" });
});

test("production static serving has safe SPA fallback, MIME, caching, and traversal behavior", async ({ baseURL, request }) => {
  const shell = await request.get(`${baseURL ?? ""}/en`, { headers: { accept: "text/html" } });
  expect(shell.headers()["content-type"]).toContain("text/html");
  expect(shell.headers()["cache-control"]).toBe("no-store");
  const html = await shell.text();
  const assetPath = /(?:src|href)="(\/assets\/[^"]+)"/u.exec(html)?.[1];
  expect(assetPath).toBeDefined();
  const asset = await request.get(`${baseURL ?? ""}${assetPath ?? ""}`);
  expect(asset.ok()).toBe(true);
  expect(asset.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect(asset.headers()["content-type"]).toMatch(/(?:javascript|text\/css)/u);

  const missing = await request.get(`${baseURL ?? ""}/missing.json`, { headers: { accept: "application/json" } });
  expect(missing.status()).toBe(404);
  await expect(missing.json()).resolves.toEqual({ error: { code: "not_found" } });
  expect(missing.headers()["content-security-policy"]).toBe(CSP);

  const traversal = await request.get(`${baseURL ?? ""}/assets/%2e%2e%2f%2e%2e%2fpackage.json`, { headers: { accept: "application/json" } });
  expect(traversal.status()).toBeGreaterThanOrEqual(400);
  expect(await traversal.text()).not.toContain('"name": "dayu"');
});

test("production app and fallback routes emit the complete browser security policy", async ({ baseURL, request }) => {
  for (const path of ["/en", "/not-a-real-route"]) {
    const response = await request.get(`${baseURL ?? ""}${path}`, { headers: { accept: "text/html" } });
    expect(response.headers()).toMatchObject({
      "content-security-policy": CSP,
      "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
      "referrer-policy": "no-referrer",
      "strict-transport-security": "max-age=31536000; includeSubDomains",
      "x-content-type-options": "nosniff",
      "x-dayu-app": "repo-reality-check",
    });
  }
});

test("evidence source links are fixed HTTPS GitHub destinations with opener isolation", async ({ page }) => {
  await scanToReport(page, "owner/reality-check");
  await expect(page.locator("[style]")).toHaveCount(0);
  await openReportDetail(page, "evidence");
  const source = page.getByRole("link", { name: "Open public GitHub API endpoint" }).first();
  await expect(source).toHaveAttribute("href", "https://api.github.com/repos/owner/reality-check");
  await expect(source).toHaveAttribute("rel", "noreferrer");
  await expect(source).toHaveAttribute("target", "_blank");
});
