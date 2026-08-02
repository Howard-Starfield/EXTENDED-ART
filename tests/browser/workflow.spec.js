import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
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
  return pngFromRows(width, height, rows);
}

function pngFromRows(width, height, rows) {
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

function syntheticGridPng(width, height) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  const colors = [
    [38, 116, 130, 255], [242, 99, 69, 255], [116, 214, 154, 255],
    [242, 211, 77, 255], [23, 26, 31, 255], [94, 231, 242, 255],
    [176, 116, 214, 255], [214, 154, 116, 255], [116, 154, 214, 255],
  ];
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      const color = colors[Math.floor(y / (height / 3)) * 3 + Math.floor(x / (width / 3))];
      const pixelOffset = rowOffset + 1 + x * 4;
      rows.set(color, pixelOffset);
    }
  }
  return pngFromRows(width, height, rows);
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

  const sampleImage = syntheticGridPng(1000, 880);
  const cardImage = solidPng(630, 880);

  await page.locator("label.mode-card").first().click();
  await page.getByRole("button", { name: "Continue to sheet" }).click();
  await page.locator("label.paper-card").first().click();
  await page.getByRole("button", { name: "Open alignment studio" }).click();
  await expect(page.locator("#autoAlignButton")).toBeDisabled();

  await page.setInputFiles("#artInput", {
    name: "synthetic-3x3-scene.png",
    mimeType: "image/png",
    buffer: sampleImage,
  });
  const progressVisible = page.locator("#alignmentProgress").waitFor({ state: "visible" });
  await page.setInputFiles("#cardInput", {
    name: "card.png",
    mimeType: "image/png",
    buffer: cardImage,
  });
  await progressVisible;
  await expect(page.locator(".studio-shell")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".studio-shell")).toHaveAttribute("inert", "");
  await expect(page.locator("#autoAlignButton")).toBeDisabled();
  await page.locator("#gridToggle").click({ force: true });
  await page.locator("#letterPaperTool").click({ force: true });
  await page.locator("#includeCard").click({ force: true });
  await page.locator("#includePieces").click({ force: true });
  await expect(page.locator("#gridToggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#letterPaperTool")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#includeCard")).not.toBeChecked();
  await expect(page.locator("#includePieces")).not.toBeChecked();

  await expect(page.locator("#proofButton")).toBeEnabled({ timeout: 5000 });
  await expect(page.locator("#alignmentProgress")).toBeHidden();
  await expect(page.locator("#progressJob")).toHaveText(/JOB \d{4}/);
  await expect(page.locator("#progressBar")).toHaveCSS("width", "100%");
    await expect(page.locator("#autoAlignStatus")).toHaveAttribute(
      "data-alignment-status",
      "NO_RELIABLE_MATCH",
    );
    await expect(page.locator("#autoAlignStatus")).toContainText("No reliable automatic match");
  await expect(page.locator("#includeCard")).not.toBeChecked();

  await page.locator("#canvasShell").focus();
  await page.locator("#canvasShell").press("ArrowRight");
  await expect(page.locator("#offsetValue")).toHaveText("X 1 / Y 0");
  await page.locator("#canvasShell").dispatchEvent("keydown", {
    key: "ArrowLeft",
    shiftKey: true,
  });
  await expect(page.locator("#offsetValue")).toHaveText("X -9 / Y 0");
  const canvasBox = await page.locator("#canvasShell").boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 16, canvasBox.y + canvasBox.height / 2 + 8);
  await page.mouse.up();
  await expect(page.locator("#offsetValue")).not.toHaveText("X -9 / Y 0");
  await page.locator("#resetButton").click();
  await expect(page.locator("#offsetValue")).toHaveText("X 0 / Y 0");

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
