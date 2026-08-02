import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, body, checksum]);
}

function solidPng(width, height) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunkData(bytes, typeName) {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === typeName) return bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
  }
  return null;
}

test("auto-aligns after both required images decode", async ({ page }) => {
  await page.goto("/");

  const projectRoot = resolve(import.meta.dirname, "../..");
  const sampleImage = resolve(
    projectRoot,
    "reference/assets/branding/extendedart-icon.png",
  );
  const cardImage = solidPng(630, 880);

  await page.locator("label.mode-card").first().click();
  await page.getByRole("button", { name: "Continue to sheet" }).click();
  await page.locator("label.paper-card").first().click();
  await page.getByRole("button", { name: "Open alignment studio" }).click();
  await expect(page.locator("#autoAlignButton")).toBeDisabled();

  await page.setInputFiles("#artInput", sampleImage);
  await page.setInputFiles("#cardInput", {
    name: "card.png",
    mimeType: "image/png",
    buffer: cardImage,
  });

  await expect(page.locator("#proofButton")).toBeEnabled({ timeout: 5000 });
  await expect(page.locator("#alignmentProgress")).toBeHidden();
  await expect(page.locator("#progressJob")).toHaveText(/JOB \d{4}/);
  await expect(page.locator("#progressBar")).toHaveCSS("width", "100%");
  await expect(page.locator("#autoAlignStatus")).toHaveAttribute(
    "data-alignment-status",
    "CENTERED_NOT_MATCHED",
  );
  await expect(page.locator("#autoAlignStatus")).toContainText("Centered only");
  await expect(page.locator("#includeCard")).not.toBeChecked();

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#proofButton").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("_standard_alignment_proof_300dpi.png");
  const downloadPath = await download.path();
  const proof = readFileSync(downloadPath);
  expect(proof.readUInt32BE(16)).toBe(2232);
  expect(proof.readUInt32BE(20)).toBe(3118);
  const phys = pngChunkData(proof, "pHYs");
  expect(phys.readUInt32BE(0)).toBe(11811);
  expect(phys.readUInt32BE(4)).toBe(11811);
  expect(phys[8]).toBe(1);
});
