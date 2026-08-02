import { describe, expect, it } from "vitest";
import { fallbackPapers, fallbackProfiles, psaLabelBox } from "../src/profiles.js";
import { buildQualityReport } from "../src/quality-report.js";

const matched = {
  status: "MATCHED",
  accepted: true,
  matcherVersion: "phase2.0",
  profileVersion: "phase2-profiles-1",
  bestScore: 0.91,
  secondScore: 0.72,
  scoreMargin: 0.19,
  candidateCount: 200,
  comparisonSize: [172, 240],
  elapsedMs: 14,
};

describe("quality report contract", () => {
  it("reports a clean 300-DPI standard result with version stamps", () => {
    const profile = fallbackProfiles.standard;
    const report = buildQualityReport({
      profile,
      paper: fallbackPapers.a4,
      artDimensions: { width: 2232, height: 3118 },
      cardDimensions: { width: 744, height: 1039 },
      alignment: matched,
      exportOptions: { includePieces: false, includeMaster: false },
    });

    expect(report.overallStatus).toBe("PASS");
    expect(report.reportVersion).toBe("phase2.0");
    expect(report.profileVersion).toBe("phase2-profiles-1");
    expect(report.alignment.matcherVersion).toBe("phase2.0");
    expect(report.target.masterPx).toEqual([2232, 3118]);
    expect(report.cutouts[0].id).toBe("CENTER_CARD");
  });

  it("keeps low-resolution and uncertain results actionable", () => {
    const profile = fallbackProfiles.psa;
    const report = buildQualityReport({
      profile,
      paper: fallbackPapers.letter,
      artDimensions: { width: 300, height: 500 },
      cardDimensions: { width: 630, height: 880 },
      alignment: { status: "NO_RELIABLE_MATCH", accepted: false, matcherVersion: "phase2.0" },
      labelBox: psaLabelBox(profile, 70, 20),
    });

    expect(report.overallStatus).toBe("BLOCKED");
    expect(report.warnings.some((warning) => warning.includes("below 100 DPI"))).toBe(true);
    expect(report.warnings.some((warning) => warning.includes("inconclusive"))).toBe(true);
    expect(report.cutouts.map((cutout) => cutout.id)).toEqual(["PSA_LABEL", "CARD"]);
    expect(report.cutouts[0].widthMm).toBeCloseTo(70, 8);
  });
});
