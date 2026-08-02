import { expect, test } from "@playwright/test";

test("opens the local setup gate", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("ExtendedArt Alignment Studio");
  await expect(page.getByRole("heading", { name: "What are we making today?" })).toBeVisible();
  await expect(page.getByText("Browser local").first()).toBeVisible();
  await expect(page.locator('input[name="profile"]:checked')).toHaveCount(0);
  await page.locator("label.mode-card").first().click();
  await expect(page.getByRole("heading", { name: "Choose your paper size" })).toBeVisible();
  await expect(page.locator('input[name="paper"]:checked')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open alignment studio" })).toBeDisabled();
});

test("keeps the object and paper choices on the same centered axis", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/");
  const objectChoices = await page.locator(".mode-grid").boundingBox();
  expect(objectChoices).not.toBeNull();

  await page.locator("label.mode-card").first().click();
  await expect(page.locator(".paper-options")).toBeVisible();
  await expect(page.locator("#setupSummarySheet")).toHaveText("A4 / 210 × 297 mm");
  await page.locator("label.paper-card").nth(1).click();
  await expect(page.locator("#setupSummarySheet")).toHaveText("US Letter / 215.9 × 279.4 mm");
  const paperChoices = await page.locator(".paper-options").boundingBox();
  expect(paperChoices).not.toBeNull();
  expect(Math.abs((objectChoices.x + objectChoices.width / 2) - (paperChoices.x + paperChoices.width / 2))).toBeLessThanOrEqual(2);
  const a4Shape = await page.locator(".a4-paper").boundingBox();
  const letterShape = await page.locator(".letter-paper").boundingBox();
  expect(a4Shape.width / a4Shape.height).toBeCloseTo(210 / 297, 2);
  expect(letterShape.width / letterShape.height).toBeCloseTo(215.9 / 279.4, 2);
});

test("keeps a narrow laptop viewport free of persistent horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
