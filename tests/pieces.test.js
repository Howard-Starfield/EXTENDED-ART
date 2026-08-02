import { describe, expect, it } from "vitest";
import { fallbackProfiles } from "../src/profiles.js";
import {
  BINDER_POSITION_IDS,
  applyRoundedAlphaMask,
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
      1039, 1039, 1039,
      1040, 1040, 1040,
      1039, 1039, 1039,
    ]);
    expect(all.every((piece) => piece.output.width === 744 && piece.output.height === 1039)).toBe(true);
  });

  it("keeps Vault source rounding independent from canonical piece dimensions", () => {
    const all = getPieceGeometry(fallbackProfiles.vaultx);
    expect(all.map((piece) => piece.source.width)).toEqual([780, 779, 780, 780, 779, 780, 780, 779, 780]);
    expect(all.map((piece) => piece.source.height)).toEqual([
      1110, 1110, 1110,
      1111, 1111, 1111,
      1110, 1110, 1110,
    ]);
    expect(all.every((piece) => piece.output.width === 780 && piece.output.height === 1110)).toBe(true);
  });

  it("keeps corner masks in physical pixels without changing piece boxes", () => {
    expect(mmToPixels(3)).toBeCloseTo(35.433, 3);
    expect(roundedMaskRadiusPx(fallbackProfiles.standard, 3)).toBeCloseTo(mmToPixels(3), 6);
    expect(roundedMaskRadiusPx(fallbackProfiles.standard, 99)).toBeCloseTo(mmToPixels(31.5), 6);
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
      fill: () => calls.push({ operation: context.globalCompositeOperation, width: 744, height: 1039 }),
      globalCompositeOperation: "source-over",
      globalAlpha: 0,
      fillStyle: "",
    };

    applyRoundedAlphaMask(context, 744, 1039, 35.433);

    expect(calls).toContainEqual({ operation: "destination-in", width: 744, height: 1039 });
    expect(calls[0]).toBe("save");
    expect(calls.at(-1)).toBe("restore");
    expect(context.globalCompositeOperation).toBe("source-over");
  });

  it("returns one complete printable piece for non-binder profiles", () => {
    for (const name of ["psa", "photo8x10"]) {
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
});
