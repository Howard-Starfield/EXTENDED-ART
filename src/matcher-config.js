const VERSION = "alignment-v4.0";

export const MATCHER_CONFIG_VERSION = VERSION;

// This is deliberately data-only. Keeping the search/calibration contract in
// one versioned object makes a result reproducible and makes threshold changes
// auditable against the fixture suite.
export const MATCHER_CONFIG = Object.freeze({
  version: VERSION,
  borderExclusion: 0.03,
  borderExclusionFraction: 0.03,
  regionGrid: Object.freeze({ columns: 3, rows: 3 }),
  comparison: Object.freeze({
    minHeight: 24,
    minWidth: 48,
    levels: Object.freeze([
      Object.freeze({ id: "coarse", scale: 0.5 }),
      Object.freeze({ id: "mid", scale: 0.75 }),
      Object.freeze({ id: "fine", scale: 1 }),
    ]),
  }),
  search: Object.freeze({
    zoom: Object.freeze({ min: 1, max: 1.3, step: 0.05 }),
    offset: Object.freeze({ min: -0.15, max: 0.15, step: 0.05 }),
    refinement: Object.freeze({
      topCandidates: 5,
      zoomRadius: 0.05,
      offsetRadius: 0.05,
      zoomStep: 0.025,
      offsetStep: 0.025,
    }),
  }),
  scoring: Object.freeze({
    // Local contrast and semantic texture are less sensitive to the source
    // raster scale than raw edge magnitude; retain both in every region.
    edgeWeight: 0.4,
    toneWeight: 0.6,
    pooledWeight: 0.65,
    regionalWeight: 0.35,
    regionSupportThreshold: 0.62,
    minimumSupportedRegions: 5,
    minimumSupportFraction: 0.56,
    minimumSupportedRows: 2,
    minimumSupportedColumns: 2,
    minimumEvidenceLevels: 2,
    minimumEvidenceScore: 0.55,
    minimumScore: 0.78,
    minimumMargin: 0.06,
    maximumPeriodicity: 0.995,
  }),
  features: Object.freeze({
    strategy: "local-features-ransac",
    version: VERSION,
    // Feature work is intentionally capped independently from the worker's
    // raster cap. This keeps the browser-local matcher responsive without a
    // model download or a server round-trip.
    maximumDimension: 900,
    minimumInputDimension: 120,
    pyramidScales: Object.freeze([1, 0.76, 0.58]),
    roiGrid: Object.freeze({ columns: 4, rows: 5 }),
    maxKeypointsPerLevel: 180,
    maxKeypointsPerRoi: 14,
    minimumKeypoints: 24,
    descriptorBits: 128,
    descriptorRadius: 12,
    harrisThresholdFraction: 0.004,
    nonMaximumRadius: 2,
    minimumKeypointDistance: 6,
    ratioThreshold: 0.78,
    maximumDescriptorDistance: 58,
    minimumCandidateMatches: 12,
    ransacIterations: 640,
    homographyIterations: 420,
    inlierThresholdPx: 4.5,
    minimumInliers: 10,
    minimumInlierRatio: 0.26,
    minimumRois: 3,
    minimumRows: 2,
    minimumColumns: 2,
    minimumSpreadX: 0.18,
    minimumSpreadY: 0.16,
    maximumRotationDegrees: 2,
    maximumScaleMismatch: 0.035,
    maximumPerspectiveDistortion: 0.045,
    maximumAffineDistortion: 0.055,
    maximumModelScale: 4,
    minimumModelScale: 0.2,
  }),
  coverage: Object.freeze({
    // The small guard band is reported as evidence. The normal cover-fit
    // baseline remains valid when an aspect ratio has exactly zero overscan.
    fixedOverscanPx: 2,
    tolerancePx: 1e-6,
  }),
});

// Keep the existing named gate contract available to callers and reports.
export const MATCH_GATES = Object.freeze({
  minimumScore: MATCHER_CONFIG.scoring.minimumScore,
  minimumMargin: MATCHER_CONFIG.scoring.minimumMargin,
});
