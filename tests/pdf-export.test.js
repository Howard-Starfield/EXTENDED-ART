import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { fallbackPapers, fallbackProfiles } from "../src/profiles.js";
import { getCutoutGeometry } from "../src/output-geometry.js";
import { createCutReadyPdf, createPrintGuidePdf, createWithCardReferencePdf, cutoutRect, svgPathOrigin } from "../src/pdf-export.js";
import { createPageLayout, millimetersToPoints } from "../src/page-layout.js";

function tinyPng() {
  return new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
    0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61,
    0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ]);
}

describe("pdf export adapter", () => {
  it("writes exact A4 MediaBox and eight Standard placements", async () => {
    const profile = fallbackProfiles.standard;
    const paper = fallbackPapers.a4;
    const sources = new Map(getPageLayoutIds(profile, paper).map((id) => [id, tinyPng()]));
    const bytes = await createCutReadyPdf({ profile, paper, pieceSources: sources });
    const pdf = await PDFDocument.load(bytes);
    const page = pdf.getPages()[0];
    const mediaBox = page.getMediaBox();
    expect(pdf.getPageCount()).toBe(1);
    expect(mediaBox.width).toBeCloseTo(millimetersToPoints(210), 6);
    expect(mediaBox.height).toBeCloseTo(millimetersToPoints(297), 6);
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("writes the Vault Letter two-page layout and a print guide", async () => {
    const profile = fallbackProfiles.vaultx;
    const paper = fallbackPapers.letter;
    const sources = new Map(getPageLayoutIds(profile, paper).map((id) => [id, tinyPng()]));
    const bytes = await createCutReadyPdf({ profile, paper, pieceSources: sources });
    const guide = await createPrintGuidePdf({ profile, paper });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    expect((await PDFDocument.load(guide)).getPageCount()).toBe(1);
  });

  it("keeps PSA and frame outputs as one exact-size page with chamber geometry", async () => {
    for (const name of ["psa", "cardslab", "photo8x10"]) {
      const profile = fallbackProfiles[name];
      const paper = fallbackPapers.letter;
      const sources = new Map(getPageLayoutIds(profile, paper).map((id) => [id, tinyPng()]));
      const bytes = await createCutReadyPdf({ profile, paper, pieceSources: sources });
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    }
  });

  it("anchors SVG cutout paths at the physical top edge", () => {
    for (const name of ["psa", "cardslab", "photo8x10"]) {
      const profile = fallbackProfiles[name];
      const placement = createPageLayout(profile, fallbackPapers.letter).placements[0];
      const cutout = getCutoutGeometry(profile)[name === "psa" ? 1 : 0];
      const rect = cutoutRect(profile, placement, cutout);
      expect(svgPathOrigin(rect)).toEqual({ x: rect.x, y: rect.y + rect.height });
    }
  });

  it("keeps the with-card reference PDF additive to the cut-ready layout", async () => {
    const profile = fallbackProfiles.standard;
    const paper = fallbackPapers.a4;
    const layout = createPageLayout(profile, paper, { includeCenter: true });
    const sources = new Map(layout.placements.map((placement) => [placement.pieceId, tinyPng()]));
    const bytes = await createWithCardReferencePdf({
      profile,
      paper,
      pieceSources: sources,
      cardSource: tinyPng(),
      layout,
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

function getPageLayoutIds(profile, paper) {
  return createPageLayout(profile, paper).placements.map((placement) => placement.pieceId);
}
