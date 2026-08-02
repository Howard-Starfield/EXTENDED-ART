import { expect, test } from "@playwright/test";

test("opens the local setup gate", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("ExtendedArt Alignment Studio");
  await expect(page.getByRole("heading", { name: "What are we making today?" })).toBeVisible();
  await expect(page.getByText("Browser local").first()).toBeVisible();
  await expect(page.locator('input[name="profile"]:checked')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue to sheet" })).toBeDisabled();
  await page.locator("label.mode-card").first().click();
  await expect(page.getByRole("button", { name: "Continue to sheet" })).toBeEnabled();
  await page.getByRole("button", { name: "Continue to sheet" }).click();
  await expect(page.getByRole("heading", { name: "Choose your paper size" })).toBeVisible();
  await expect(page.locator('input[name="paper"]:checked')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open alignment studio" })).toBeDisabled();
});

test("keeps a narrow laptop viewport free of persistent horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
