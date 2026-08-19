import { describe, expect, it } from "vitest";
import {
  cardPhysicalMm,
  effectiveCardBox,
  fallbackPapers,
  fallbackProfiles,
  paperFit,
  psaLabelBox,
} from "../src/profiles.js";

describe("print profile contracts", () => {
  it("keeps the standard binder at the exact master and insert sizes", () => {
    expect(fallbackProfiles.standard.master_px).toEqual([2232, 3118]);
    expect(fallbackProfiles.standard.insert_px).toEqual([744, 1039]);
    expect(fallbackProfiles.standard.piece_count).toBe(8);
  });

  it("derives a standard 63 by 88 millimetre card chamber", () => {
    expect(cardPhysicalMm(fallbackProfiles.standard)).toEqual([63, 88]);
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
    const offsetX = 744; // one cell wide
    const offsetY = 1039; // one cell tall
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
