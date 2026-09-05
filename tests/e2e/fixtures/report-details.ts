import { expect, type Page } from "@playwright/test";

/** Follow the same explicit disclosure action available to a report reader. */
export async function openReportDetail(page: Page, section: "analysis" | "evidence" | "details"): Promise<void> {
  const disclosure = page.locator(`#report-${section}`);
  await expect(disclosure).toBeAttached();
  if (await disclosure.getAttribute("open") === null) {
    await disclosure.locator(":scope > summary").click();
  }
  await expect(disclosure).toHaveJSProperty("open", true);
}
