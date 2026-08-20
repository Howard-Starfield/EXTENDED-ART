import { describe, expect, it } from "vitest";
import { fallbackPapers, fallbackProfiles } from "../src/profiles.js";
import { createPageLayout, millimetersToPoints } from "../src/page-layout.js";

describe("exact page layout contract", () => {
  it("fits eight Standard pieces on one exact A4 page without the center", () => {
    const layout = createPageLayout(fallbackProfiles.standard, fallbackPapers.a4);
    expect(layout.pageCount).toBe(1);
    expect(layout.status).toBe("exact_one_page");
    expect(layout.placements.map((placement) => placement.pieceId)).toEqual([
      "TL", "TC", "TR", "ML", "MR", "BL", "BC", "BR",
    ]);
    expect(layout.placements.every((placement) => placement.scale === 1)).toBe(true);
    expect(layout.placements[0].widthPt).toBeCloseTo(millimetersToPoints(63), 8);
    expect(layout.placements[0].heightPt).toBeCloseTo(millimetersToPoints(88), 8);
    expect(layout.pageSizePt[0]).toBeCloseTo(595.2755905, 6);
    expect(layout.pageSizePt[1]).toBeCloseTo(841.8897638, 6);
  });

  it("paginates Vault Letter without shrinking the pieces", () => {
    const layout = createPageLayout(fallbackProfiles.vaultx, fallbackPapers.letter);
    expect(layout.status).toBe("exact_multipage");
    expect(layout.pageCount).toBe(2);
    expect(layout.pages[0].placements.map((placement) => placement.pieceId)).toEqual(["TL", "TC", "TR", "ML", "MR"]);
    expect(layout.pages[1].placements.map((placement) => placement.pieceId)).toEqual(["BL", "BC", "BR"]);
    expect(layout.placements.every((placement) => placement.scale === 1)).toBe(true);
  });

  it("keeps exact 8x10 A4 size and records the printer-margin warning", () => {
    const layout = createPageLayout(fallbackProfiles.photo8x10, fallbackPapers.a4);
    expect(layout.status).toBe("exact_with_margin_warning");
    expect(layout.placements).toHaveLength(1);
    expect(layout.placements[0].widthPt).toBeCloseTo(millimetersToPoints(203.2), 8);
    expect(layout.warnings[0]).toContain("3.4 mm");
  });

  it("swaps the center into the printable set when the user picks a non-center cell", () => {
    // Default (no pick): center is excluded — legacy behaviour.
    const noPick = createPageLayout(fallbackProfiles.standard, fallbackPapers.a4);
    expect(noPick.placements.map((p) => p.pieceId)).not.toContain("C");
    expect(noPick.placements).toHaveLength(8);
    // Picked bottom-left: BL is excluded, center is back.
    const blPicked = createPageLayout(fallbackProfiles.standard, fallbackPapers.a4, {
      excludeCol: 0, excludeRow: 2,
    });
    expect(blPicked.placements.map((p) => p.pieceId)).not.toContain("BL");
    expect(blPicked.placements.map((p) => p.pieceId)).toContain("C");
    expect(blPicked.placements).toHaveLength(8);
  });

  it("centers the PSA overlay at exact physical size on Letter", () => {
    const layout = createPageLayout(fallbackProfiles.psa, fallbackPapers.letter);
    const placement = layout.placements[0];
    expect(layout.status).toBe("exact_one_page");
    expect(placement.pieceId).toBe("R1C1");
    expect(placement.xPt).toBeCloseTo((millimetersToPoints(215.9) - placement.widthPt) / 2, 8);
    expect(placement.yPt).toBeCloseTo((millimetersToPoints(279.4) - placement.heightPt) / 2, 8);
  });

  it("changes only the sheet contract between A4 and Letter", () => {
    for (const name of ["standard", "psa", "psaMini", "psaCase", "cardslab", "photo8x10"]) {
      const a4 = createPageLayout(fallbackProfiles[name], fallbackPapers.a4);
      const letter = createPageLayout(fallbackProfiles[name], fallbackPapers.letter);
      expect(a4.pageSizeMm).toEqual([210, 297]);
      expect(letter.pageSizeMm).toEqual([215.9, 279.4]);
      expect(a4.placements[0].widthPt).toBeCloseTo(letter.placements[0].widthPt, 8);
      expect(a4.placements[0].heightPt).toBeCloseTo(letter.placements[0].heightPt, 8);
    }
  });
});
