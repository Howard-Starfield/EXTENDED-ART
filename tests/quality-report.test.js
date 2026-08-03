import { describe, expect, it } from "vitest";
import { fallbackPapers, fallbackProfiles, psaLabelBox } from "../src/profiles.js";
import { buildQualityReport, serializeAlignmentDiagnostics } from "../src/quality-report.js";
import { sourceManifest } from "../src/export.js";
import { createPageLayout } from "../src/page-layout.js";

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
    expect(report.reportVersion).toBe("alignment-v4.0");
    expect(report.profileVersion).toBe("phase2-profiles-1");
    expect(report.alignment.status).toBe("MATCH_APPLIED");
    expect(report.alignment.statusVersion).toBe("alignment-v4.0");
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

  it("serializes v4 feature and overscan diagnostics without raw local input details", () => {
    const serialized = serializeAlignmentDiagnostics({
      status: "MATCH_UNCERTAIN",
      accepted: false,
      matcherVersion: "alignment-v4.0",
      reason: "C:\\Users\\howard\\Downloads\\source-card.png needs canvas",
      diagnostics: {
        strategy: "local-features-ransac",
        version: "alignment-v4.0",
        keypoints: {
          art: { total: 184, levels: [{ index: 0, scale: 1, width: 849, height: 1200, keypointCount: 184 }] },
          card: { total: 141, levels: [{ index: 0, scale: 1, width: 600, height: 838, keypointCount: 141 }] },
          roiGrid: { columns: 4, rows: 5 },
        },
        descriptors: { type: "brief-128-local-contrast", bits: 128, artCount: 184, cardCount: 141 },
        candidateMatches: { rawPairCount: 25944, ratioCandidateCount: 52, crossCheckedCount: 31 },
        inliers: { count: 24, ratio: 0.77, medianResidualPx: 1.1, thresholdPx: 4.5, spatialCoverage: { roiCount: 5, rowCount: 2, columnCount: 3, spreadX: 0.44, spreadY: 0.31 } },
        estimatedArtCardBox: { sourcePx: { left: 274, top: 198, right: 876, bottom: 1039, width: 602, height: 841, centerX: 575, centerY: 618.5 } },
        requiredTransform: { zoom: 0.584, offsetX: 0.01, offsetY: -0.02 },
        overscan: { sourcePx: { requiredCanvas: { width: 1804, height: 2523 }, shortfall: { left: 328, right: 423, top: 643, bottom: 389, width: 751, height: 1032 } } },
        compatibility: { compatible: true, rejectionReason: "INSUFFICIENT_OVERSCAN" },
        rejectionClassification: "INSUFFICIENT_OVERSCAN",
        confidenceGates: { keypoints: true, candidateMatches: true, inliers: true, inlierRatio: true, rois: true, rows: true, columns: true, spatialSpread: true, periodicity: true, compatibility: true, coverage: false, passed: false },
        sourcePath: "C:\\Users\\howard\\Downloads\\source-card.png",
        rawFilename: "source-card.png",
        rawImageData: [1, 2, 3],
      },
    });

    expect(serialized.strategy).toBe("local-features-ransac");
    expect(serialized.localFeatureAttempt).toBeNull();
    expect(serialized.rejectionClassification).toBe("INSUFFICIENT_OVERSCAN");
    expect(serialized.localFeatures.strategy).toBe("local-features-ransac");
    expect(serialized.localFeatures).not.toHaveProperty("descriptors");
    expect(serialized.localFeatures.estimatedArtCardBox.sourcePx).toMatchObject({ left: 274, right: 876 });
    expect(serialized.localFeatures.overscan.sourcePx.shortfall).toMatchObject({ width: 751, height: 1032 });
    const output = JSON.stringify(serialized);
    expect(output).not.toContain("source-card.png");
    expect(output).not.toContain("Downloads");
    expect(output).not.toContain("rawImageData");
    expect(output).not.toContain("brief-128-local-contrast");
  });

  it("records the local-feature strategy for feature-applied results", () => {
    const serialized = serializeAlignmentDiagnostics({
      status: "MATCH_APPLIED",
      accepted: true,
      strategy: "local-features-ransac",
      diagnostics: {
        strategy: "local-features-ransac",
        version: "alignment-v4.0",
        descriptors: { type: "brief-128-local-contrast", raw: [1, 2, 3] },
        sourcePath: "C:\\Users\\howard\\Downloads\\source-card.png",
        rawFilename: "source-card.png",
        rawImageData: [1, 2, 3],
      },
    });

    expect(serialized.strategy).toBe("local-features-ransac");
    expect(serialized.localFeatures.strategy).toBe("local-features-ransac");
    expect(serialized.localFeatureAttempt).toBeNull();
    const output = JSON.stringify(serialized);
    expect(output).not.toContain("source-card.png");
    expect(output).not.toContain("rawImageData");
    expect(output).not.toContain("brief-128-local-contrast");
  });

  it("records the actual fallback strategy and failed local-feature attempt in the package manifest", () => {
    const profile = fallbackProfiles.standard;
    const paper = fallbackPapers.a4;
    const layout = createPageLayout(profile, paper);
    const manifest = sourceManifest(
      {
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
        lastStableAlignment: { zoom: 1, offsetX: 0, offsetY: 0 },
        artDimensions: { width: 1804, height: 2523 },
        cardDimensions: { width: 600, height: 838 },
        artFile: { type: "image/png", size: 5000 },
        cardFile: { type: "image/png", size: 4000 },
      },
      profile,
      paper,
      {
        status: "MATCH_APPLIED",
        accepted: true,
        strategy: "correlation-fallback",
        diagnostics: {
          strategy: "correlation-fallback",
          version: "alignment-v4.0",
          localFeatures: {
            strategy: "local-features-ransac",
            candidateMatches: { crossCheckedCount: 31 },
            inliers: { count: 24, ratio: 0.77 },
            estimatedArtCardBox: { sourcePx: { left: 274, top: 198, right: 876, bottom: 1039 } },
            overscan: { sourcePx: { shortfall: { left: 328, right: 423, top: 643, bottom: 389 } } },
            compatibility: { compatible: true, rejectionReason: "INSUFFICIENT_OVERSCAN" },
            rejectionClassification: "INSUFFICIENT_OVERSCAN",
            descriptors: { type: "brief-128-local-contrast", raw: [1, 2, 3] },
            sourcePath: "C:\\Users\\howard\\Downloads\\source-card.png",
            rawFilename: "source-card.png",
            rawImageData: [1, 2, 3],
          },
        },
      },
      {},
      layout,
      [paper],
      [layout],
    );

    expect(manifest.alignment.strategy).toBe("correlation-fallback");
    expect(manifest.alignment.localFeatures).toBeNull();
    expect(manifest.alignment.localFeatureAttempt.strategy).toBe("local-features-ransac");
    expect(manifest.alignment.localFeatureAttempt.rejectionClassification).toBe("INSUFFICIENT_OVERSCAN");
    expect(manifest.alignment.localFeatureAttempt.overscan.sourcePx.shortfall).toMatchObject({ left: 328, bottom: 389 });
    const output = JSON.stringify(manifest);
    expect(output).not.toContain("source-card.png");
    expect(output).not.toContain("rawImageData");
    expect(output).not.toContain("brief-128-local-contrast");
  });
});
