import { describe, expect, it } from "vitest";
import {
  cardPhysicalMm,
  cellCardOffset,
  cellFromCardOffset,
  cellName,
  effectiveCardBox,
  fallbackPapers,
  fallbackProfiles,
  paperFit,
  psaLabelBox,
} from "../src/profiles.js";

describe("print profile contracts", () => {
  it("uses pocket-sized binder tiles while keeping the card chamber standard-sized", () => {
    expect(fallbackProfiles.standard.master_px).toEqual([2339, 3224]);
    expect(fallbackProfiles.standard.insert_px).toEqual([780, 1075]);
    expect(fallbackProfiles.vaultx.master_px).toEqual([2409, 3437]);
    expect(fallbackProfiles.vaultx.insert_px).toEqual([803, 1146]);
    expect(cardPhysicalMm(fallbackProfiles.standard)[0]).toBeCloseTo(63, 8);
    expect(cardPhysicalMm(fallbackProfiles.standard)[1]).toBeCloseTo(88, 8);
    expect(cardPhysicalMm(fallbackProfiles.vaultx)[0]).toBeCloseTo(63, 8);
    expect(cardPhysicalMm(fallbackProfiles.vaultx)[1]).toBeCloseTo(88, 8);
    expect(fallbackProfiles.standard.piece_count).toBe(8);
  });

  it("derives a standard 63 by 88 millimetre card chamber", () => {
    expect(cardPhysicalMm(fallbackProfiles.standard)[0]).toBeCloseTo(63, 8);
    expect(cardPhysicalMm(fallbackProfiles.standard)[1]).toBeCloseTo(88, 8);
    expect(cardPhysicalMm(fallbackProfiles.psa)[0]).toBeCloseTo(63, 8);
    expect(cardPhysicalMm(fallbackProfiles.psa)[1]).toBeCloseTo(88, 8);
  });

  it("keeps the PSA label centered and converts the recommended cutout", () => {
    const box = psaLabelBox(fallbackProfiles.psa, 69.85, 21.59);
    expect(box[0]).toBeCloseTo((80.264 - 69.85) / 2 / 80.264, 8);
    expect(box[1]).toBeCloseTo(5 / 135.128, 8);
    expect((box[2] - box[0]) * 80.264).toBeCloseTo(69.85, 8);
    expect((box[3] - box[1]) * 135.128).toBeCloseTo(21.59, 8);
  });

  it("centers a standard card in the label-free PSA-sized Card Slab", () => {
    const profile = fallbackProfiles.cardslab;
    expect(profile.master_mm).toEqual(fallbackProfiles.psa.master_mm);
    expect(profile.master_px).toEqual(fallbackProfiles.psa.master_px);
    expect(profile.label_box).toBeNull();
    expect(cardPhysicalMm(profile)[0]).toBeCloseTo(63, 8);
    expect(cardPhysicalMm(profile)[1]).toBeCloseTo(88, 8);
    expect(profile.card_box[1] * profile.master_mm[1]).toBeCloseTo((135.128 - 88) / 2, 8);
    expect(profile.card_box[3] * profile.master_mm[1]).toBeCloseTo((135.128 + 88) / 2, 8);
  });

  it("sizes the PSA Cover Edition (CASE) to 3.14 by 5.30 inches with a centered card", () => {
    const profile = fallbackProfiles.psaCase;
    expect(profile.label).toBe("PSA Cover Edition (CASE)");
    expect(profile.master_mm).toEqual([79.756, 134.62]);
    expect(profile.master_px).toEqual([942, 1590]);
    expect(profile.insert_px).toEqual([942, 1590]);
    expect(profile.label_box).toBeNull();
    // 3.14 × 5.30 in master
    expect(profile.master_mm[0] / 25.4).toBeCloseTo(3.14, 5);
    expect(profile.master_mm[1] / 25.4).toBeCloseTo(5.30, 5);
    // Standard 63 × 88 mm card fits inside with ~8.378 mm horizontal and ~23.31 mm vertical clearance
    expect(cardPhysicalMm(profile)[0]).toBeCloseTo(63, 8);
    expect(cardPhysicalMm(profile)[1]).toBeCloseTo(88, 8);
    expect(profile.card_box[0] * profile.master_mm[0]).toBeCloseTo((79.756 - 63) / 2, 8);
    expect(profile.card_box[1] * profile.master_mm[1]).toBeCloseTo((134.62 - 88) / 2, 8);
    expect(profile.card_box[2] * profile.master_mm[0]).toBeCloseTo((79.756 + 63) / 2, 8);
    expect(profile.card_box[3] * profile.master_mm[1]).toBeCloseTo((134.62 + 88) / 2, 8);
  });

  it("sizes the PSA SLAB (CASE) to 3.14 by 5.30 inches and keeps the psa label + card chamber positions", () => {
    const profile = fallbackProfiles.psaMini;
    expect(profile.label).toBe("PSA SLAB (CASE)");
    expect(profile.master_mm).toEqual([79.756, 134.62]);
    expect(profile.master_px).toEqual([942, 1590]);
    expect(profile.insert_px).toEqual([942, 1590]);
    expect(profile.label_box).not.toBeNull();
    // 3.14 × 5.30 in master
    expect(profile.master_mm[0] / 25.4).toBeCloseTo(3.14, 5);
    expect(profile.master_mm[1] / 25.4).toBeCloseTo(5.30, 5);
    // Same internal label and card positions (in mm) as the full psa profile.
    expect(profile.label_box_mm).toEqual([5.207, 5, 69.85, 21.59]);
    expect(cardPhysicalMm(profile)[0]).toBeCloseTo(63, 8);
    expect(cardPhysicalMm(profile)[1]).toBeCloseTo(88, 8);
    expect(profile.card_box[1] * profile.master_mm[1]).toBeCloseTo(36, 8);
    expect(profile.card_box[3] * profile.master_mm[1]).toBeCloseTo(124, 8);
  });

  it("shows when Vault Letter needs exact two-page handling", () => {
    const fit = paperFit(fallbackProfiles.vaultx, "letter", fallbackPapers);
    expect(fit.scale).toBeLessThan(1);
  });
});

describe("effectiveCardBox", () => {
  it("returns the original card_box when offset is zero on a binder", () => {
    const profile = fallbackProfiles.standard;
    expect(effectiveCardBox(profile, 0, 0)).toEqual(profile.card_box);
  });

  it("shifts the binder card box by the requested pixel offset", () => {
    const profile = fallbackProfiles.standard;
    const offsetX = 780; // one standard pocket cell wide at 300 DPI
    const offsetY = 1075; // one standard pocket cell tall at 300 DPI
    const result = effectiveCardBox(profile, offsetX, offsetY);
    // Left should move by one cell width.
    expect(result[0] - profile.card_box[0]).toBeCloseTo(offsetX / profile.master_px[0], 8);
    expect(result[1] - profile.card_box[1]).toBeCloseTo(offsetY / profile.master_px[1], 8);
    // Card size is preserved.
    expect(result[2] - result[0]).toBeCloseTo(profile.card_box[2] - profile.card_box[0], 8);
    expect(result[3] - result[1]).toBeCloseTo(profile.card_box[3] - profile.card_box[1], 8);
  });

  it("ignores the offset for single-card profiles", () => {
    const psa = fallbackProfiles.psa;
    const original = [...psa.card_box];
    const result = effectiveCardBox(psa, 999, -999);
    expect(result).toEqual(original);
  });

  it("ignores the offset for the photo frame profile", () => {
    const photo = fallbackProfiles.photo8x10;
    const original = [...photo.card_box];
    const result = effectiveCardBox(photo, 500, 500);
    expect(result).toEqual(original);
  });

  it("treats missing piece_count as a single-card profile", () => {
    const profile = { card_box: [0.1, 0.1, 0.2, 0.2], master_px: [1000, 1000] };
    expect(effectiveCardBox(profile, 200, 200)).toEqual([0.1, 0.1, 0.2, 0.2]);
  });
});

describe("cellCardOffset / cellFromCardOffset", () => {
  it("returns zero offset for the centre cell of a 3x3 binder", () => {
    const profile = fallbackProfiles.standard;
    expect(cellCardOffset(profile, 1, 1)).toEqual([0, 0]);
    expect(cellFromCardOffset(profile, 0, 0)).toEqual([1, 1]);
  });

  it("snaps to one cell horizontally and vertically for the standard profile", () => {
    const profile = fallbackProfiles.standard;
    // One cell horizontally = master_px[0] / 3 = 2339/3 ≈ 779.67 px.
    // One cell vertically = master_px[1] / 3 = 3224/3 ≈ 1074.67 px.
    const [dx, dy] = cellCardOffset(profile, 2, 0);
    expect(dx).toBeCloseTo(779.667, 3);
    expect(dy).toBeCloseTo(-1074.667, 3);
  });

  it("respects the larger cell size for the vaultx profile", () => {
    const profile = fallbackProfiles.vaultx;
    // vaultx cells are master_px[0]/3 x master_px[1]/3 = 803 x 1145.667 px.
    const [dx, dy] = cellCardOffset(profile, 2, 0);
    expect(dx).toBeCloseTo(803, 3);
    expect(dy).toBeCloseTo(-1145.667, 3);
  });

  it("round-trips between cell and offset for every cell of a 3x3 binder", () => {
    const profile = fallbackProfiles.standard;
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const [ox, oy] = cellCardOffset(profile, col, row);
        expect(cellFromCardOffset(profile, ox, oy)).toEqual([col, row]);
      }
    }
  });

  it("clamps out-of-range cell coordinates to the grid", () => {
    const profile = fallbackProfiles.standard;
    expect(cellCardOffset(profile, 9, 9)).toEqual(cellCardOffset(profile, 2, 2));
    expect(cellCardOffset(profile, -3, -3)).toEqual(cellCardOffset(profile, 0, 0));
  });

  it("falls back to the centre cell for non-binder profiles", () => {
    const psa = fallbackProfiles.psa;
    // PSA is a 1x1 grid, so the only valid cell is (0, 0).
    expect(cellCardOffset(psa, 0, 0)).toEqual([0, 0]);
    expect(cellFromCardOffset(psa, 999, -999)).toEqual([0, 0]);
  });

  it("names each of the 9 cells of a 3x3 binder", () => {
    expect(cellName(0, 0)).toBe("Top-Left");
    expect(cellName(1, 0)).toBe("Top-Center");
    expect(cellName(2, 0)).toBe("Top-Right");
    expect(cellName(0, 1)).toBe("Middle-Left");
    expect(cellName(1, 1)).toBe("Center");
    expect(cellName(2, 1)).toBe("Middle-Right");
    expect(cellName(0, 2)).toBe("Bottom-Left");
    expect(cellName(1, 2)).toBe("Bottom-Center");
    expect(cellName(2, 2)).toBe("Bottom-Right");
  });
});
