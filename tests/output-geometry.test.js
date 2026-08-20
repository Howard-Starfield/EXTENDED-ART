import { describe, expect, it } from "vitest";
import { cellCardOffset, fallbackProfiles, psaLabelBox } from "../src/profiles.js";
import {
  getCutoutGeometry,
  getOutputMaskGeometry,
  guideOffsetPx,
  internalGuideRect,
  outerGuideRect,
  pointsToPixels,
} from "../src/output-geometry.js";

describe("cutout and guide geometry", () => {
  it("returns the PSA label and card openings at the measured dimensions", () => {
    const profile = fallbackProfiles.psa;
    const geometry = getOutputMaskGeometry(profile, {
      labelBox: psaLabelBox(profile, 69.85, 21.59),
    });

    expect(geometry.map((item) => item.id)).toEqual(["PSA_LABEL", "CARD"]);
    expect(geometry[0].pixels.width).toBe(825);
    expect(geometry[0].pixels.height).toBe(255);
    expect(geometry[1].pixels.width).toBe(744);
    expect(geometry[1].pixels.height).toBe(1039);
  });

  it("returns only the centered card opening for the label-free Card Slab", () => {
    const profile = fallbackProfiles.cardslab;
    const geometry = getOutputMaskGeometry(profile);

    expect(geometry.map((item) => item.id)).toEqual(["CARD"]);
    expect(geometry[0].pixels.width).toBe(744);
    expect(geometry[0].pixels.height).toBe(1039);
    expect(geometry[0].pixels.y).toBe(Math.round((23.564 / 25.4) * 300));
  });

  it("keeps custom PSA label dimensions physically exact", () => {
    const profile = fallbackProfiles.psa;
    const geometry = getOutputMaskGeometry(profile, {
      labelBox: psaLabelBox(profile, 70, 20),
    });
    expect(geometry[0].pixels.width).toBe(Math.round((70 / 25.4) * 300));
    expect(geometry[0].pixels.height).toBe(Math.round((20 / 25.4) * 300));
  });

  it("provides a blank card chamber for the frame and center-card mask for binders", () => {
    expect(getOutputMaskGeometry(fallbackProfiles.photo8x10)).toHaveLength(1);
    expect(getOutputMaskGeometry(fallbackProfiles.photo8x10)[0].id).toBe("CARD");
    expect(getOutputMaskGeometry(fallbackProfiles.standard)[0].id).toBe("CENTER_CARD");
  });

  it("uses the selected roundness for every PSA opening and the frame chamber", () => {
    const psa = getCutoutGeometry(fallbackProfiles.psa, {
      labelBox: psaLabelBox(fallbackProfiles.psa, 69.85, 21.59),
      cornerRadiusMm: 4.5,
    });
    expect(psa.map((item) => item.radiusMm)).toEqual([4.5, 4.5]);
    expect(getOutputMaskGeometry(fallbackProfiles.photo8x10)[0].radiusMm).toBe(0);
    expect(getOutputMaskGeometry(fallbackProfiles.photo8x10, { cornerRadiusMm: 5 })[0].radiusMm).toBe(5);
    expect(getOutputMaskGeometry(fallbackProfiles.cardslab, { cornerRadiusMm: 4.5 })[0].radiusMm).toBe(4.5);
  });

  it("keeps outer guides outside and internal guides inside their retained boundaries", () => {
    const rect = { x: 100, y: 200, width: 744, height: 1039 };
    const offset = guideOffsetPx();
    const outer = outerGuideRect(rect);
    const internal = internalGuideRect(rect);
    expect(offset).toBeCloseTo(pointsToPixels(0.5) / 2 + pointsToPixels(0.25), 8);
    expect(outer.x).toBeLessThan(rect.x);
    expect(outer.x + outer.width).toBeGreaterThan(rect.x + rect.width);
    expect(internal.x).toBeGreaterThan(rect.x);
    expect(internal.x + internal.width).toBeLessThan(rect.x + rect.width);
  });

  it("shifts the binder center-card cutout when a card offset is provided", () => {
    const profile = fallbackProfiles.standard;
    const baseline = getOutputMaskGeometry(profile)[0].pixels;
    const offset = getOutputMaskGeometry(profile, { cardOffsetX: 780, cardOffsetY: 0 })[0].pixels;
    // Width and height of the cutout must stay the same.
    expect(offset.width).toBe(baseline.width);
    expect(offset.height).toBe(baseline.height);
    // But the cutout has slid by one pocket cell to the right.
    expect(offset.x - baseline.x).toBe(780);
  });

  it("lets the on-screen chamber follow the picked cell when the offset is provided", () => {
    // drawAlignmentScene threads state.cardOffsetX/Y into getCutoutGeometry so
    // the on-screen chamber, the cyan stroke, and the export cutout all sit on
    // the cell the user picked — matching the cell picker and the print.
    const profile = fallbackProfiles.standard;
    const baseline = getOutputMaskGeometry(profile)[0].pixels;
    const offset = getOutputMaskGeometry(profile, { cardOffsetX: 780, cardOffsetY: 0 })[0].pixels;
    // Width and height of the cutout must stay the same.
    expect(offset.width).toBe(baseline.width);
    expect(offset.height).toBe(baseline.height);
    // The cutout slid by one pocket cell to the right.
    expect(offset.x - baseline.x).toBe(780);
  });

  it("translates the binder card cutout onto a sub-piece instead of scaling it", () => {
    // The picked cell's piece is one 1/3-sized sub-piece of the master, so
    // when the cutout lands on it, the mask must cover the WHOLE piece
    // (translated to the piece's local coords), not a scaled-down sliver.
    // Regression test for the "mini version" bug where applyCutoutMasks
    // scaled cutout coords by piece/master instead of translating them.
    const profile = fallbackProfiles.standard; // 3x3 binder, piece = 780 x 1075
    const piece = { column: 1, row: 0, source: { x: 780, y: 0 } };
    const cutout = getOutputMaskGeometry(profile, {
      cardOffsetX: cellCardOffset(profile, 1, 0)[0],
      cardOffsetY: cellCardOffset(profile, 1, 0)[1],
    })[0];
    // The card-sized cutout is centered inside the selected top-center pocket.
    expect(cutout.pixels.x - piece.source.x).toBeGreaterThanOrEqual(17);
    expect(cutout.pixels.x - piece.source.x).toBeLessThanOrEqual(18);
    expect(cutout.pixels.y - piece.source.y).toBeGreaterThanOrEqual(17);
    expect(cutout.pixels.y - piece.source.y).toBeLessThanOrEqual(18);
    expect(cutout.pixels.width).toBe(744);
    expect(cutout.pixels.height).toBe(1039);
  });

  it("ignores the card offset for non-binder profiles", () => {
    const psa = fallbackProfiles.psa;
    const baseline = getOutputMaskGeometry(psa, { labelBox: psaLabelBox(psa, 69.85, 21.59) })[1].pixels;
    const offset = getOutputMaskGeometry(psa, {
      labelBox: psaLabelBox(psa, 69.85, 21.59),
      cardOffsetX: 500,
      cardOffsetY: 500,
    })[1].pixels;
    expect(offset).toEqual(baseline);
  });
});
