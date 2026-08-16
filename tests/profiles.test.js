import { describe, expect, it } from "vitest";
import {
  cardPhysicalMm,
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

  it("shows when Vault Letter needs exact two-page handling", () => {
    const fit = paperFit(fallbackProfiles.vaultx, "letter", fallbackPapers);
    expect(fit.scale).toBeLessThan(1);
  });
});
