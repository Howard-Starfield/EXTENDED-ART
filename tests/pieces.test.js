import { describe, expect, it } from "vitest";
import { fallbackProfiles, cellCardOffset } from "../src/profiles.js";
import { getOutputMaskGeometry } from "../src/output-geometry.js";
import {
  BINDER_POSITION_IDS,
  applyRoundedAlphaMask,
  cellFromOffset,
  getPieceGeometry,
  getPrintablePieceGeometry,
  mmToPixels,
  roundedMaskRadiusPx,
} from "../src/pieces.js";

describe("deterministic output pieces", () => {
  it("slices the standard master at rounded source edges and omits only C", () => {
    const all = getPieceGeometry(fallbackProfiles.standard);
    const printable = getPrintablePieceGeometry(fallbackProfiles.standard);

    expect(all.map((piece) => piece.id)).toEqual([...BINDER_POSITION_IDS]);
    expect(printable.map((piece) => piece.id)).toEqual([
      "TL", "TC", "TR", "ML", "MR", "BL", "BC", "BR",
    ]);
    expect(all.map((piece) => piece.source.height)).toEqual([
      1075, 1075, 1075,
      1074, 1074, 1074,
      1075, 1075, 1075,
    ]);
    expect(all.map((piece) => piece.source.width)).toEqual([780, 779, 780, 780, 779, 780, 780, 779, 780]);
    expect(all.every((piece) => piece.output.width === 780 && piece.output.height === 1075)).toBe(true);
  });

  it("keeps Vault source rounding independent from canonical piece dimensions", () => {
    const all = getPieceGeometry(fallbackProfiles.vaultx);
    expect(all.map((piece) => piece.source.height)).toEqual([
      1146, 1146, 1146,
      1145, 1145, 1145,
      1146, 1146, 1146,
    ]);
    expect(all.map((piece) => piece.source.width)).toEqual([803, 803, 803, 803, 803, 803, 803, 803, 803]);
    expect(all.every((piece) => piece.output.width === 803 && piece.output.height === 1146)).toBe(true);
  });

  it("keeps corner masks in physical pixels without changing piece boxes", () => {
    expect(mmToPixels(3)).toBeCloseTo(35.433, 3);
    expect(roundedMaskRadiusPx(fallbackProfiles.standard, 3)).toBeCloseTo(mmToPixels(3), 6);
    expect(roundedMaskRadiusPx(fallbackProfiles.standard, 99)).toBeCloseTo(mmToPixels(33), 6);
  });

  it("applies an alpha mask after the piece box is established", () => {
    const calls = [];
    const context = {
      save: () => calls.push("save"),
      restore: () => {
        calls.push("restore");
        context.globalCompositeOperation = "source-over";
      },
      beginPath: () => calls.push("beginPath"),
      moveTo: () => calls.push("moveTo"),
      arcTo: () => calls.push("arcTo"),
      closePath: () => calls.push("closePath"),
      fill: () => calls.push({ operation: context.globalCompositeOperation, width: 780, height: 1075 }),
      globalCompositeOperation: "source-over",
      globalAlpha: 0,
      fillStyle: "",
    };

    applyRoundedAlphaMask(context, 780, 1075, 35.433);

    expect(calls).toContainEqual({ operation: "destination-in", width: 780, height: 1075 });
    expect(calls[0]).toBe("save");
    expect(calls.at(-1)).toBe("restore");
    expect(context.globalCompositeOperation).toBe("source-over");
  });

  it("returns one complete printable piece for non-binder profiles", () => {
    for (const name of ["psa", "cardslab", "photo8x10"]) {
      const pieces = getPrintablePieceGeometry(fallbackProfiles[name]);
      expect(pieces).toHaveLength(1);
      expect(pieces[0].id).toBe("R1C1");
      expect(pieces[0].source).toEqual({
        x: 0,
        y: 0,
        width: fallbackProfiles[name].master_px[0],
        height: fallbackProfiles[name].master_px[1],
      });
    }
  });

  it("translates the standard card cutout into every picked pocket cell", () => {
    // The pocket tile is intentionally larger than the physical 63 x 88 mm
    // card. The cutout must translate with the picked cell while preserving
    // the card-sized opening and its centered margin inside that tile.
    for (const name of ["standard", "vaultx"]) {
      const profile = fallbackProfiles[name];
      const geom = getPieceGeometry(profile);
      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          const [ox, oy] = cellCardOffset(profile, col, row);
          const [pickedCol, pickedRow] = cellFromOffset(profile, ox, oy);
          expect([pickedCol, pickedRow]).toEqual([col, row]);
          const cutouts = getOutputMaskGeometry(profile, { cardOffsetX: ox, cardOffsetY: oy });
          expect(cutouts).toHaveLength(1);
          const cut = cutouts[0];
          const piece = geom.find((p) => p.column === col && p.row === row);
          expect(piece).toBeDefined();
          const rect = {
            x: cut.pixels.x - piece.source.x,
            y: cut.pixels.y - piece.source.y,
            width: cut.pixels.width,
            height: cut.pixels.height,
          };
          const expectedX = (profile.insert_px[0] - 744) / 2;
          const expectedY = (profile.insert_px[1] - 1039) / 2;
          expect(Math.abs(rect.x - expectedX)).toBeLessThanOrEqual(1);
          expect(Math.abs(rect.y - expectedY)).toBeLessThanOrEqual(1);
          expect(rect.width).toBe(744);
          expect(rect.height).toBe(1039);
        }
      }
    }
  });

  it("excludes the picked cell from printable pieces, not the center", () => {
    // Regression test: previously `getPieceGeometry` hardcoded the
    // center as `printable: false` and `getPrintablePieceGeometry`
    // always returned the 8 outer cells. So picking a non-center cell
    // would leave the center as a blank gap in the print. Now the
    // printable list is driven by the picked cell instead.
    for (const name of ["standard", "vaultx"]) {
      const profile = fallbackProfiles[name];
      const all = getPieceGeometry(profile).map((p) => p.id);
      // Legacy behaviour (no pick specified): center is missing.
      const defaultPrintable = getPrintablePieceGeometry(profile).map((p) => p.id);
      expect(defaultPrintable).toEqual(all.filter((id) => id !== "C"));
      // Pick bottom-left: center is back, BL is gone.
      const blPrintable = getPrintablePieceGeometry(profile, 0, 2).map((p) => p.id);
      expect(blPrintable).not.toContain("BL");
      expect(blPrintable).toContain("C");
      expect(blPrintable).toHaveLength(8);
      // Pick top-right: center is back, TR is gone.
      const trPrintable = getPrintablePieceGeometry(profile, 2, 0).map((p) => p.id);
      expect(trPrintable).not.toContain("TR");
      expect(trPrintable).toContain("C");
      expect(trPrintable).toHaveLength(8);
      // Pick the center: same as legacy — center is gone, outer 8 stay.
      const cPrintable = getPrintablePieceGeometry(profile, 1, 1).map((p) => p.id);
      expect(cPrintable).not.toContain("C");
      expect(cPrintable).toHaveLength(8);
    }
  });
});
