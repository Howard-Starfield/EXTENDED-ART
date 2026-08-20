import { expect, test } from "@playwright/test";
import { TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import { PDFDocument } from "pdf-lib";
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

const FEATURE_CARD_WIDTH = 252;
const FEATURE_CARD_HEIGHT = 352;
const FEATURE_ART_WIDTH = 880;
const FEATURE_ART_HEIGHT = 1232;
const FEATURE_ARTWORK_REGION = { left: 24, top: 28, right: 228, bottom: 214 };

function featureNoise(x, y) {
  return ((x * 73856093 ^ y * 19349663 ^ (x * y * 83492791)) >>> 0) % 256;
}

function featureTexture(x, y, variant = 0) {
  const texture = variant === 0
    ? featureNoise(x, y) + featureNoise(x * 3, y * 5) + ((x * 17 + y * 11) % 97)
    : featureNoise(x * 5 + 19, y * 7 + 23) + featureNoise(x * 11 + 29, y * 2 + 31) + ((x * 7 + y * 19) % 113);
  return Math.round(15 + (texture % 256) * 0.82);
}

function featureCardPixel(x, y, variant = 0) {
  if (x >= FEATURE_ARTWORK_REGION.left && x < FEATURE_ARTWORK_REGION.right
    && y >= FEATURE_ARTWORK_REGION.top && y < FEATURE_ARTWORK_REGION.bottom) {
    return featureTexture(x, y, variant);
  }
  return 205 - ((x * 3 + y * 5) % 12);
}

function rgbaRows(width, height, pixelAt) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      const value = Math.max(0, Math.min(255, pixelAt(x, y)));
      const pixelOffset = rowOffset + 1 + x * 4;
      rows[pixelOffset] = value;
      rows[pixelOffset + 1] = value;
      rows[pixelOffset + 2] = value;
      rows[pixelOffset + 3] = 255;
    }
  }
  return rows;
}

function featureCardPng(variant = 0) {
  return pngFromRows(
    FEATURE_CARD_WIDTH,
    FEATURE_CARD_HEIGHT,
    rgbaRows(FEATURE_CARD_WIDTH, FEATURE_CARD_HEIGHT, (x, y) => featureCardPixel(x, y, variant)),
  );
}

function featureScenePng({
  width = FEATURE_ART_WIDTH,
  height = FEATURE_ART_HEIGHT,
  cardLeft = 270,
  cardTop = 370,
  cardScale = 0.98,
  sceneCardVariant = 0,
} = {}) {
  return pngFromRows(width, height, rgbaRows(width, height, (x, y) => {
    const sourceX = (x - cardLeft) / cardScale;
    const sourceY = (y - cardTop) / cardScale;
    if (sourceX >= FEATURE_ARTWORK_REGION.left && sourceX < FEATURE_ARTWORK_REGION.right
      && sourceY >= FEATURE_ARTWORK_REGION.top && sourceY < FEATURE_ARTWORK_REGION.bottom) {
      return featureTexture(Math.floor(sourceX), Math.floor(sourceY), sceneCardVariant);
    }
    return 30 + ((x * 9 + y * 7 + featureNoise(x >> 3, y >> 3)) % 40);
  }));
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
  await page.locator("label.paper-card").first().click();
  await page.getByRole("button", { name: "Open alignment studio" }).click();
  await expect(page.locator("#autoAlignButton")).toBeDisabled();
  await expect(page.locator("#paperContract")).toHaveText("A4 / 210 × 297 mm");
  await expect(page.locator("#a4Fit")).toContainText("mm");
  await expect(page.locator("#letterFit")).toContainText("mm");
  const a4Icon = await page.locator(".a4-icon").boundingBox();
  const letterIcon = await page.locator(".letter-icon").boundingBox();
  expect(a4Icon.width / a4Icon.height).toBeCloseTo(210 / 297, 2);
  expect(letterIcon.width / letterIcon.height).toBeCloseTo(215.9 / 279.4, 2);

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
  await expect(page.locator("#alignmentProgress")).toBeHidden({ timeout: 15_000 });
  await expect(page.locator("#autoAlignStatus")).toHaveAttribute("data-alignment-status", "MATCH_UNCERTAIN");
  await page.locator("#canvasShell").focus();
  await page.locator("#canvasShell").press("ArrowRight");
  await expect(page.locator("#offsetValue")).toHaveText("X 1 / Y 0");
  const retryProgress = page.locator("#alignmentProgress").waitFor({ state: "visible" });
  await page.locator("#autoAlignButton").click();
  await retryProgress;
  await page.locator("#cancelAlignmentButton").click();
  await expect(page.locator("#alignmentProgress")).toBeHidden();
  await expect(page.locator("#autoAlignStatus")).toHaveAttribute("data-alignment-status", "CANCELLED");
  await expect(page.locator("#offsetValue")).toHaveText("X 1 / Y 0");

  await page.locator("#autoAlignButton").click();
  await expect(page.locator("#alignmentProgress")).toBeHidden({ timeout: 5000 });
  await expect(page.locator("#autoAlignStatus")).toHaveAttribute("data-alignment-status", "MATCH_UNCERTAIN");
  await expect(page.locator("#offsetValue")).toHaveText("X 1 / Y 0");

  const completedJob = await page.locator("#progressJob").textContent();
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
      "MATCH_UNCERTAIN",
    );
  await expect(page.locator("#autoAlignStatus")).toContainText("inconclusive");
  await expect(page.locator("#includeCard")).not.toBeChecked();
  await page.locator("#letterPaperTool").click({ force: true });
  await expect(page.locator("#paperContract")).toHaveText("US Letter / 215.9 × 279.4 mm");
  await expect(page.locator("#progressJob")).toHaveText(completedJob);
  await page.locator("#a4PaperTool").click({ force: true });
  await expect(page.locator("#paperContract")).toHaveText("A4 / 210 × 297 mm");

  await page.locator("#canvasShell").focus();
  await page.locator("#canvasShell").press("ArrowRight");
  await expect(page.locator("#offsetValue")).toHaveText("X 2 / Y 0");
  await page.locator("#canvasShell").dispatchEvent("keydown", {
    key: "ArrowLeft",
    shiftKey: true,
  });
  await expect(page.locator("#offsetValue")).toHaveText("X -8 / Y 0");
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
  expect(proof.readUInt32BE(16)).toBe(2339);
  expect(proof.readUInt32BE(20)).toBe(3224);
  const phys = pngChunkData(proof, "pHYs");
  expect(phys.readUInt32BE(0)).toBe(11811);
  expect(phys.readUInt32BE(4)).toBe(11811);
  expect(phys[8]).toBe(1);

  const packageDownloadPromise = page.waitForEvent("download");
  await page.locator("#exportButton").click();
  const packageDownload = await packageDownloadPromise;
  expect(packageDownload.suggestedFilename()).toContain("_standard_a4_print_package_");
  const packagePath = await packageDownload.path();
  const packageBytes = readFileSync(packagePath);
  const zipReader = new ZipReader(new Uint8ArrayReader(packageBytes));
  const packageEntries = await zipReader.getEntries();
  expect(packageEntries.map((entry) => entry.filename)).toEqual([
    "manifest.json",
    "PRINT_INSTRUCTIONS.txt",
    "quality_report.json",
    "synthetic_3x3_scene_standard_a4_cut_ready.pdf",
    "synthetic_3x3_scene_standard_a4_print_guide.pdf",
  ]);
  expect(packageEntries.some((entry) => entry.filename.includes("card.png"))).toBe(false);
  expect(packageEntries.some((entry) => entry.filename.startsWith("pieces/"))).toBe(false);
  await zipReader.close();
  await expect(page.locator("#resultPanel")).toBeVisible();

  for (const selector of ["#includeSecondPaper", "#includePieces", "#includeMaster", "#includeFullArtPdf", "#includeWithCardPdf"]) {
    await page.locator(selector).check();
  }
  const optionalDownloadPromise = page.waitForEvent("download");
  await page.locator("#exportButton").click();
  const optionalDownload = await optionalDownloadPromise;
  const optionalPath = await optionalDownload.path();
  const optionalReader = new ZipReader(new Uint8ArrayReader(readFileSync(optionalPath)));
  const optionalEntries = await optionalReader.getEntries();
  const optionalNames = optionalEntries.map((entry) => entry.filename);
  expect(optionalNames.some((name) => name.endsWith("_master_300dpi.png"))).toBe(true);
  expect(optionalNames.some((name) => name.endsWith("_full_art_reference.pdf"))).toBe(true);
  expect(optionalNames.some((name) => name.endsWith("_with_card_reference.pdf"))).toBe(true);
  expect(optionalNames).toContain("synthetic_3x3_scene_standard_letter_cut_ready.pdf");
  expect(optionalNames).toContain("synthetic_3x3_scene_standard_letter_print_guide.pdf");
  expect(optionalNames).toContain("synthetic_3x3_scene_standard_letter_full_art_reference.pdf");
  expect(optionalNames).toContain("synthetic_3x3_scene_standard_letter_with_card_reference.pdf");
  const a4CutReady = optionalEntries.find((entry) => entry.filename === "synthetic_3x3_scene_standard_a4_cut_ready.pdf");
  const letterCutReady = optionalEntries.find((entry) => entry.filename === "synthetic_3x3_scene_standard_letter_cut_ready.pdf");
  const a4Page = (await PDFDocument.load(await a4CutReady.getData(new Uint8ArrayWriter()))).getPages()[0].getMediaBox();
  const letterPage = (await PDFDocument.load(await letterCutReady.getData(new Uint8ArrayWriter()))).getPages()[0].getMediaBox();
  expect(a4Page.width).toBeCloseTo(595.2755905, 5);
  expect(a4Page.height).toBeCloseTo(841.8897638, 5);
  expect(letterPage.width).toBeCloseTo(612, 5);
  expect(letterPage.height).toBeCloseTo(792, 5);
  const manifestEntry = optionalEntries.find((entry) => entry.filename === "manifest.json");
  const manifest = JSON.parse(await manifestEntry.getData(new TextWriter()));
  expect(manifest.paperSet.map((item) => item.name)).toEqual(["a4", "letter"]);
  expect(manifest.pageLayouts.map((item) => item.paper)).toEqual(["a4", "letter"]);
  expect(optionalNames.filter((name) => name.startsWith("pieces/")).length).toBe(8);
  const masterEntry = optionalEntries.find((entry) => entry.filename.endsWith("_master_300dpi.png"));
  const masterBytes = Buffer.from(await masterEntry.getData(new Uint8ArrayWriter()));
  expect(masterBytes.readUInt32BE(16)).toBe(2339);
  expect(masterBytes.readUInt32BE(20)).toBe(3224);
  const masterPhys = pngChunkData(masterBytes, "pHYs");
  expect(masterPhys.readUInt32BE(0)).toBe(11811);
  expect(masterPhys.readUInt32BE(4)).toBe(11811);
  expect(masterPhys[8]).toBe(1);
  const masterSrgb = pngChunkData(masterBytes, "sRGB");
  expect(masterSrgb[0]).toBe(0);
  const pieceEntry = optionalEntries.find((entry) => entry.filename.startsWith("pieces/"));
  const pieceBytes = Buffer.from(await pieceEntry.getData(new Uint8ArrayWriter()));
  expect(pieceBytes.readUInt32BE(16)).toBe(780);
  expect(pieceBytes.readUInt32BE(20)).toBe(1075);
  await optionalReader.close();
});

test("normalizes a padded card reference and keeps export available after an uncertain match", async ({ page }) => {
  await page.goto("/");

  await page.locator("label.mode-card").first().click();
  await page.locator("label.paper-card").first().click();
  await page.getByRole("button", { name: "Open alignment studio" }).click();

  await page.setInputFiles("#artInput", {
    name: "padded-scene.png",
    mimeType: "image/png",
    buffer: syntheticGridPng(1000, 880),
  });
  const progressVisible = page.locator("#alignmentProgress").waitFor({ state: "visible" });
  await page.setInputFiles("#cardInput", {
    name: "padded-card.png",
    mimeType: "image/png",
    buffer: solidPng(1000, 1000),
  });
  await progressVisible;
  await expect(page.locator("#alignmentProgress")).toBeHidden({ timeout: 15_000 });

  await expect(page.locator("#cardMeta")).toContainText("716 × 1000 px");
  await expect(page.locator("#qualityNotice")).toContainText("automatically center-cropped");
  await expect(page.locator("#qualityNotice")).not.toContainText("Card ratio is outside the expected");
  await expect(page.locator("#exportButton")).toBeEnabled();
});

test("worker v4 auto-applies a translated and scaled local-feature match", async ({ page }) => {
  await page.goto("/");
  await page.locator("label.mode-card").first().click();
  await page.locator("label.paper-card").first().click();
  await page.getByRole("button", { name: "Open alignment studio" }).click();

  await page.setInputFiles("#artInput", {
    name: "feature-scene.png",
    mimeType: "image/png",
    buffer: featureScenePng(),
  });
  const progressVisible = page.locator("#alignmentProgress").waitFor({ state: "visible" });
  await page.setInputFiles("#cardInput", {
    name: "feature-card.png",
    mimeType: "image/png",
    buffer: featureCardPng(),
  });
  await progressVisible;
  await expect(page.locator("#alignmentProgress")).toBeHidden({ timeout: 20_000 });
  await expect(page.locator("#autoAlignStatus")).toHaveAttribute(
    "data-alignment-status",
    "MATCH_APPLIED",
  );
  await expect(page.locator("#autoAlignStatus")).toContainText(
    "Local card-art features passed deterministic RANSAC",
  );
  await expect(page.locator("#proofButton")).toBeEnabled();

  const zoomPercent = Number((await page.locator("#zoomValue").textContent()).replace("%", ""));
  expect(zoomPercent).toBeGreaterThan(105);
  expect(zoomPercent).toBeLessThan(125);
  const offsetText = await page.locator("#offsetValue").textContent();
  expect(offsetText).toMatch(/^X -?\d+ \/ Y -?\d+$/);
  const [, xPixels, yPixels] = offsetText.match(/^X (-?\d+) \/ Y (-?\d+)$/);
  expect(Math.abs(Number(xPixels))).toBeGreaterThan(40);
  expect(Math.abs(Number(yPixels))).toBeGreaterThan(40);
});

test("keeps the baseline and gives actionable overscan guidance for an insufficient scene", async ({ page }) => {
  await page.goto("/");
  await page.locator("label.mode-card").first().click();
  await page.locator("label.paper-card").first().click();
  await page.getByRole("button", { name: "Open alignment studio" }).click();

  await expect(page.locator("#zoomValue")).toHaveText("100%");
  await expect(page.locator("#offsetValue")).toHaveText("X 0 / Y 0");
  await page.setInputFiles("#artInput", {
    name: "insufficient-feature-scene.png",
    mimeType: "image/png",
    buffer: featureScenePng({
      width: FEATURE_CARD_WIDTH,
      height: FEATURE_CARD_HEIGHT,
      cardLeft: 0,
      cardTop: 0,
      cardScale: 1,
    }),
  });
  const progressVisible = page.locator("#alignmentProgress").waitFor({ state: "visible" });
  await page.setInputFiles("#cardInput", {
    name: "insufficient-feature-card.png",
    mimeType: "image/png",
    buffer: featureCardPng(),
  });
  await progressVisible;
  await expect(page.locator("#alignmentProgress")).toBeHidden({ timeout: 20_000 });
  await expect(page.locator("#autoAlignStatus")).toHaveAttribute(
    "data-alignment-status",
    "MATCH_UNCERTAIN",
  );
  await expect(page.locator("#autoAlignStatus")).toContainText("needs more surrounding artwork");
  await expect(page.locator("#autoAlignStatus")).toContainText("current alignment was kept");
  await expect(page.locator("#autoAlignStatus")).toContainText("required surrounding canvas");
  await expect(page.locator("#zoomValue")).toHaveText("100%");
  await expect(page.locator("#offsetValue")).toHaveText("X 0 / Y 0");
});

test("uses the typed-pixel matcher fallback without bitmap worker APIs", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "createImageBitmap", { configurable: true, value: undefined });
    Object.defineProperty(window, "OffscreenCanvas", { configurable: true, value: undefined });
  });
  await page.goto("/");
  await page.locator("label.mode-card").first().click();
  await page.locator("label.paper-card").first().click();
  await page.getByRole("button", { name: "Open alignment studio" }).click();

  await page.setInputFiles("#artInput", {
    name: "fallback-scene.png",
    mimeType: "image/png",
    buffer: syntheticGridPng(1000, 880),
  });
  const progressVisible = page.locator("#alignmentProgress").waitFor({ state: "visible" });
  await page.setInputFiles("#cardInput", {
    name: "fallback-card.png",
    mimeType: "image/png",
    buffer: solidPng(630, 880),
  });
  await progressVisible;
  await expect(page.locator("#alignmentProgress")).toBeHidden({ timeout: 15_000 });
  await expect(page.locator("#autoAlignStatus")).toHaveAttribute(
    "data-alignment-status",
    "MATCH_UNCERTAIN",
  );
  await expect(page.locator("#autoAlignStatus")).not.toContainText("cannot prepare pixels");
});
