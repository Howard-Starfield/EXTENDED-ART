import { describe, expect, it } from "vitest";
import { fallbackProfiles, psaLabelBox } from "../src/profiles.js";
import {
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
});
