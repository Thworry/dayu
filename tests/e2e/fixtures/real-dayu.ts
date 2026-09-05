import { expect, type Page } from "@playwright/test";

export interface CreatedScan {
  jobId: string;
  stage: string;
}

export async function bootstrapSession(page: Page, user: "user-a" | "user-b"): Promise<{ csrfToken: string; githubUserId: number }> {
  await page.goto("/en");
  const session = await page.evaluate(async (selectedUser) => {
    const response = await fetch(`/api/__test/session?user=${encodeURIComponent(selectedUser)}`);
    if (!response.ok) throw new Error("test session bootstrap failed");
    return await response.json() as { csrfToken: string; githubUserId: number };
  }, user);
  return session;
}

export async function scanFromHome(page: Page, repository: string): Promise<CreatedScan> {
  const createdResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/scans" && response.request().method() === "POST";
  });
  await page.goto("/en");
  await page.getByLabel("GitHub repository").fill(repository);
  await page.getByRole("button", { name: "Analyze repository" }).click();
  const response = await createdResponse;
  expect(response.status()).toBe(202);
  const created = await response.json() as CreatedScan;
  return created;
}

export async function scanToReport(page: Page, repository: string): Promise<CreatedScan> {
  const created = await scanFromHome(page, repository);
  await expect(page.getByText("Rules-only Signal")).toBeVisible();
  return created;
}
