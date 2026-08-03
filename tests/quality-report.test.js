import { describe, expect, it } from "vitest";
import { fallbackPapers, fallbackProfiles, psaLabelBox } from "../src/profiles.js";
import { buildQualityReport } from "../src/quality-report.js";

const matched = {
  status: "MATCHED",
  accepted: true,
  matcherVersion: "phase2.1",
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
    expect(report.reportVersion).toBe("phase2.1");
    expect(report.profileVersion).toBe("phase2-profiles-1");
    expect(report.alignment.status).toBe("MATCH_APPLIED");
    expect(report.alignment.statusVersion).toBe("alignment-v3.0");
    expect(report.alignment.matcherVersion).toBe("phase2.1");
    expect(report.alignment.evidence[0]).toContain("cleared");
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
       alignment: {
         status: "NO_RELIABLE_MATCH",
         accepted: false,
         matcherVersion: "phase2.1",
         reason: "C:\\private\\source-card.png was not unique",
       },
      labelBox: psaLabelBox(profile, 70, 20),
    });

    expect(report.overallStatus).toBe("BLOCKED");
    expect(report.alignment.status).toBe("MATCH_UNCERTAIN");
    expect(report.warnings.some((warning) => warning.includes("below 100 DPI"))).toBe(true);
    expect(report.warnings.some((warning) => warning.includes("inconclusive"))).toBe(true);
    expect(JSON.stringify(report)).not.toContain("source-card.png");
    expect(report.cutouts.map((cutout) => cutout.id)).toEqual(["PSA_LABEL", "CARD"]);
    expect(report.cutouts[0].widthMm).toBeCloseTo(70, 8);
  });

  it("keeps the preserved alignment usable after a transient transport failure", () => {
    const report = buildQualityReport({
      profile: fallbackProfiles.standard,
      paper: fallbackPapers.a4,
      artDimensions: { width: 2232, height: 3118 },
      cardDimensions: { width: 744, height: 1039 },
      alignment: {
        status: "TIMED_OUT",
        reason: "The worker exceeded its time limit",
        preservedAlignment: true,
        jobId: 7,
      },
      currentTransform: { zoom: 1.04, offsetX: 0.01, offsetY: -0.02 },
    });

    expect(report.overallStatus).toBe("PASS_WITH_WARNINGS");
    expect(report.alignment.status).toBe("TIMED_OUT");
    expect(report.alignment.preservedAlignment).toBe(true);
    expect(report.alignment.transform).toEqual({ zoom: 1.04, offsetX: 0.01, offsetY: -0.02 });
  });
});
