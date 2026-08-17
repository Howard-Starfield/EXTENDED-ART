import { cardPhysicalMm } from "./profiles.js";
import { getOutputMaskGeometry } from "./output-geometry.js";
import { classifyEffectiveDpi } from "./quality.js";
import {
  ALIGNMENT_STATUS_VERSION,
  ALIGNMENT_STATUSES,
  alignmentTransform,
  normalizeAlignmentResult,
} from "./state.js";

export const QUALITY_REPORT_VERSION = "alignment-v4.0";

function sourceQuality(kind, dimensions, physicalMm) {
  if (!dimensions) return null;
  return classifyEffectiveDpi(kind, dimensions, physicalMm);
}

function cutoutReport(profile, labelBox, cornerRadiusMm) {
  return getOutputMaskGeometry(profile, { labelBox, cornerRadiusMm }).map((cutout) => ({
    id: cutout.id,
    label: cutout.label,
    pixels: cutout.pixels,
    widthMm: (cutout.box[2] - cutout.box[0]) * profile.master_mm[0],
    heightMm: (cutout.box[3] - cutout.box[1]) * profile.master_mm[1],
  }));
}

function finiteMetric(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function safeDiagnosticText(value) {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[redacted]")
    .replace(/(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|private|tmp|var|mnt|workspace|src|app)[\\/])\S*/gi, "[local input]")
    .replace(/\b[^\\/\s"'<>:]+\.(?:png|jpe?g|webp|gif|bmp|tiff?|avif|heic|svg)\b/gi, "[local input]")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 240) : null;
}

export { safeDiagnosticText as sanitizeDiagnosticText };

function safeEvidenceItems(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      return item.message || item.reason || item.label || item.text || null;
    })
    .map(safeDiagnosticText)
    .filter(Boolean)
    .slice(0, 5);
}

function matcherGates(alignment) {
  const gates = alignment?.gates || alignment?.diagnostics?.gates;
  if (!gates || typeof gates !== "object" || Array.isArray(gates)) return {};
  return Object.fromEntries(
    ["minimumScore", "minimumMargin", "maximumPeriodicity"]
      .map((key) => [key, finiteMetric(gates[key])])
      .filter(([, value]) => value !== null),
  );
}

function rawAlignmentStatus(alignment) {
  return alignment?.status
    ?? alignment?.resultStatus
    ?? alignment?.result_status
    ?? alignment?.transportStatus
    ?? alignment?.transport_status
    ?? null;
}

export function alignmentEvidence(alignment) {
  if (!alignment) return [];
  const normalized = normalizeAlignmentResult(alignment);
  const explicit = safeEvidenceItems(
    alignment.evidence
      ?? alignment.evidenceItems
      ?? alignment.evidence_items
      ?? alignment.diagnostics?.evidence,
  );
  if (explicit.length) return explicit;

  const gates = matcherGates(alignment);
  const minimumScore = gates.minimumScore ?? 0.78;
  const minimumMargin = gates.minimumMargin ?? 0.06;
  const maximumPeriodicity = gates.maximumPeriodicity ?? 0.995;
  const bestScore = finiteMetric(alignment.bestScore ?? alignment.diagnostics?.bestScore);
  const scoreMargin = finiteMetric(alignment.scoreMargin ?? alignment.diagnostics?.scoreMargin);
  const periodicityScore = finiteMetric(alignment.periodicityScore ?? alignment.diagnostics?.periodicityScore);

  if (normalized.status === ALIGNMENT_STATUSES.APPLIED) {
    return ["The leading candidate cleared the score and separation checks."];
  }
  if (normalized.status === ALIGNMENT_STATUSES.UNCERTAIN) {
    if (rejectionClassification(alignment) === "INSUFFICIENT_OVERSCAN") {
      return ["Card artwork was found, but the image needs more surrounding artwork."];
    }
    if (["ROTATION_BEYOND_RENDERER_CONTRACT", "PERSPECTIVE_BEYOND_RENDERER_CONTRACT", "AFFINE_BEYOND_RENDERER_CONTRACT", "ASPECT_RATIO_BEYOND_RENDERER_CONTRACT"]
      .includes(rejectionClassification(alignment))) {
      return ["Card artwork was found, but its geometry is incompatible with the zoom-and-translation renderer."];
    }
    if (alignment.repeatedPattern === true || (periodicityScore !== null && periodicityScore >= maximumPeriodicity)) {
      return ["The reference texture was too repetitive to distinguish uniquely."];
    }
    if (bestScore !== null && bestScore < minimumScore) {
      return ["No candidate cleared the minimum match threshold."];
    }
    if (scoreMargin !== null && scoreMargin < minimumMargin) {
      return ["The leading candidates were too close to separate reliably."];
    }
    return ["The matcher did not find enough distinct evidence for an automatic apply."];
  }
  if (normalized.status === "CENTERED_NOT_MATCHED") {
    return ["Only the center-fit baseline is available; reference matching has not been applied."];
  }
  return [];
}

function safeComparisonSize(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const width = finiteMetric(value[0]);
  const height = finiteMetric(value[1]);
  return width !== null && height !== null ? [width, height] : null;
}

function safeTransform(value) {
  if (!value) return null;
  const transform = alignmentTransform(value);
  return {
    zoom: transform.zoom,
    offsetX: transform.offsetX,
    offsetY: transform.offsetY,
  };
}

function safeBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function safeToken(value) {
  if (typeof value !== "string") return null;
  const token = value.trim().toUpperCase().replace(/[^A-Z0-9_:-]/g, "_");
  return token && token.length <= 120 ? token : null;
}

function safeStrategy(value) {
  if (typeof value !== "string") return null;
  const strategy = value.trim();
  return /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/.test(strategy) && strategy.length <= 120
    ? strategy
    : null;
}

function safeBox(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const left = finiteMetric(value.left);
  const top = finiteMetric(value.top);
  const right = finiteMetric(value.right);
  const bottom = finiteMetric(value.bottom);
  if ([left, top, right, bottom].some((item) => item === null)) return null;
  return {
    left,
    top,
    right,
    bottom,
    width: finiteMetric(value.width),
    height: finiteMetric(value.height),
    centerX: finiteMetric(value.centerX),
    centerY: finiteMetric(value.centerY),
  };
}

function safeMargins(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = ["left", "right", "top", "bottom", "width", "height"]
    .map((key) => [key, finiteMetric(value[key])]);
  if (entries.every(([, item]) => item === null)) return null;
  return Object.fromEntries(entries);
}

function safeOverscan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const scope = (candidate) => {
    if (!candidate || typeof candidate !== "object") return null;
    return {
      requiredCanvas: safeMargins(candidate.requiredCanvas),
      requiredBounds: safeMargins(candidate.requiredBounds),
      requiredSurroundingMargins: safeMargins(candidate.requiredSurroundingMargins),
      availableSurroundingMargins: safeMargins(candidate.availableSurroundingMargins),
      shortfall: safeMargins(candidate.shortfall),
    };
  };
  return {
    covered: safeBoolean(value.covered),
    workingPx: scope(value.workingPx),
    sourcePx: scope(value.sourcePx),
  };
}

function safeFeatureLevels(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).map((level) => ({
    index: finiteMetric(level?.index),
    scale: finiteMetric(level?.scale),
    width: finiteMetric(level?.width),
    height: finiteMetric(level?.height),
    keypointCount: finiteMetric(level?.keypointCount),
  }));
}

function safeFeatureImage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    total: finiteMetric(value.total),
    levels: safeFeatureLevels(value.levels),
    base: value.base && typeof value.base === "object" ? {
      width: finiteMetric(value.base.width),
      height: finiteMetric(value.base.height),
      inputScale: finiteMetric(value.base.inputScale),
    } : null,
  };
}

function safeSpatialCoverage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    roiCount: finiteMetric(value.roiCount),
    rowCount: finiteMetric(value.rowCount),
    columnCount: finiteMetric(value.columnCount),
    spreadX: finiteMetric(value.spreadX),
    spreadY: finiteMetric(value.spreadY),
  };
}

function safeSimilarity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    scale: finiteMetric(value.scale),
    rotationDegrees: finiteMetric(value.rotationDegrees),
    translationX: finiteMetric(value.translationX),
    translationY: finiteMetric(value.translationY),
  };
}

function safeHomography(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const shape = value.shape && typeof value.shape === "object" ? {
    perspectiveDistortion: finiteMetric(value.shape.perspectiveDistortion),
    affineDistortion: finiteMetric(value.shape.affineDistortion),
    orthogonalityError: finiteMetric(value.shape.orthogonalityError),
  } : null;
  return {
    inlierCount: finiteMetric(value.inlierCount),
    inlierRatio: finiteMetric(value.inlierRatio),
    medianResidualPx: finiteMetric(value.medianResidualPx),
    shape,
  };
}

function featurePayload(alignment) {
  const diagnostics = alignment?.diagnostics;
  if (alignment?.featureDiagnostics && typeof alignment.featureDiagnostics === "object") return alignment.featureDiagnostics;
  if (diagnostics?.localFeatures && typeof diagnostics.localFeatures === "object") return diagnostics.localFeatures;
  if (diagnostics?.strategy === "local-features-ransac") return diagnostics;
  return null;
}

function safeFeatureDiagnostics(alignment) {
  const value = featurePayload(alignment);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keypoints = value.keypoints && typeof value.keypoints === "object" ? {
    art: safeFeatureImage(value.keypoints.art),
    card: safeFeatureImage(value.keypoints.card),
    roiGrid: value.keypoints.roiGrid && typeof value.keypoints.roiGrid === "object" ? {
      columns: finiteMetric(value.keypoints.roiGrid.columns),
      rows: finiteMetric(value.keypoints.roiGrid.rows),
    } : null,
  } : null;
  const candidates = value.candidateMatches && typeof value.candidateMatches === "object" ? {
    rawPairCount: finiteMetric(value.candidateMatches.rawPairCount),
    ratioCandidateCount: finiteMetric(value.candidateMatches.ratioCandidateCount),
    crossCheckedCount: finiteMetric(value.candidateMatches.crossCheckedCount),
  } : null;
  const inliers = value.inliers && typeof value.inliers === "object" ? {
    count: finiteMetric(value.inliers.count),
    ratio: finiteMetric(value.inliers.ratio ?? value.inlierRatio),
    medianResidualPx: finiteMetric(value.inliers.medianResidualPx),
    thresholdPx: finiteMetric(value.inliers.thresholdPx),
    spatialCoverage: safeSpatialCoverage(value.inliers.spatialCoverage),
  } : null;
  const compatibility = value.compatibility && typeof value.compatibility === "object" ? {
    compatible: safeBoolean(value.compatibility.compatible),
    rejectionReason: safeToken(value.compatibility.rejectionReason),
    maximumRotationDegrees: finiteMetric(value.compatibility.maximumRotationDegrees),
    maximumPerspectiveDistortion: finiteMetric(value.compatibility.maximumPerspectiveDistortion),
    maximumAffineDistortion: finiteMetric(value.compatibility.maximumAffineDistortion),
    aspectMismatch: finiteMetric(value.compatibility.aspectMismatch),
    homographyMateriallyImprovesEvidence: safeBoolean(value.compatibility.homographyMateriallyImprovesEvidence),
  } : null;
  const confidenceSource = value.confidenceGates;
  const confidenceGates = confidenceSource && typeof confidenceSource === "object"
    ? Object.fromEntries([
      "keypoints", "candidateMatches", "inliers", "inlierRatio", "rois", "rows", "columns",
      "spatialSpread", "periodicity", "compatibility", "coverage", "passed",
      "homographyMateriallyImprovesEvidence",
    ].map((key) => [key, safeBoolean(confidenceSource[key])]).filter(([, item]) => item !== null))
    : null;
  return {
    strategy: safeStrategy(value.strategy),
    version: safeDiagnosticText(value.version),
    keypoints,
    candidateMatches: candidates,
    inliers,
    inlierRatio: finiteMetric(value.inlierRatio ?? value.inliers?.ratio),
    similarity: safeSimilarity(value.similarity),
    homography: safeHomography(value.homography),
    estimatedArtCardBox: value.estimatedArtCardBox && typeof value.estimatedArtCardBox === "object" ? {
      workingPx: safeBox(value.estimatedArtCardBox.workingPx),
      sourcePx: safeBox(value.estimatedArtCardBox.sourcePx),
    } : value.estimatedCardBox ? { workingPx: safeBox(value.estimatedCardBox), sourcePx: null } : null,
    requiredTransform: safeTransform(value.requiredTransform),
    overscan: safeOverscan(value.overscan),
    compatibility,
    rejectionClassification: safeToken(value.rejectionClassification),
    confidenceGates,
  };
}

function rejectionClassification(alignment) {
  return safeToken(alignment?.rejectionClassification
    ?? alignment?.diagnostics?.rejectionClassification
    ?? alignment?.diagnostics?.compatibility?.rejectionReason);
}

function alignmentStrategy(alignment) {
  return [alignment?.strategy, alignment?.diagnostics?.strategy]
    .map(safeStrategy)
    .find(Boolean) || null;
}

export function serializeAlignmentDiagnostics(
  alignment,
  { currentTransform = null, preservedAlignment = false } = {},
) {
  if (!alignment) return null;
  const normalized = normalizeAlignmentResult(alignment);
  const rawStatus = rawAlignmentStatus(alignment);
  const gates = matcherGates(alignment);
  const strategy = alignmentStrategy(alignment);
  const reason = safeDiagnosticText(
    alignment.reason
      ?? alignment.failureReason
      ?? alignment.failure_reason
      ?? alignment.diagnostics?.reason,
  );
  const featureDiagnostics = safeFeatureDiagnostics(alignment);
  const diagnostics = {
    status: normalized.status,
    statusVersion: ALIGNMENT_STATUS_VERSION,
    accepted: normalized.status === ALIGNMENT_STATUSES.APPLIED
      ? true
      : Boolean(normalized.accepted),
    autoApplied: normalized.status === ALIGNMENT_STATUSES.APPLIED && alignment.autoApplied !== false,
    strategy,
    method: safeDiagnosticText(alignment.method || alignment.alignmentMethod || alignment.alignment_method),
    matcherVersion: safeDiagnosticText(alignment.matcherVersion || alignment.matcher_version),
    transportVersion: safeDiagnosticText(alignment.transportVersion || alignment.transport_version),
    profileVersion: safeDiagnosticText(alignment.profileVersion || alignment.profile_version),
    stage: safeDiagnosticText(alignment.stage),
    stageVersion: safeDiagnosticText(alignment.stageVersion || alignment.stage_version),
    jobId: finiteMetric(alignment.jobId ?? alignment.job_id),
    legacyStatus: rawStatus && normalized.status !== rawStatus ? safeDiagnosticText(rawStatus) : null,
    reason,
    evidence: alignmentEvidence(alignment),
    bestScore: finiteMetric(alignment.bestScore ?? alignment.diagnostics?.bestScore),
    secondScore: finiteMetric(alignment.secondScore ?? alignment.diagnostics?.secondScore),
    scoreMargin: finiteMetric(alignment.scoreMargin ?? alignment.diagnostics?.scoreMargin),
    periodicityScore: finiteMetric(alignment.periodicityScore ?? alignment.diagnostics?.periodicityScore),
    repeatedPattern: typeof alignment.repeatedPattern === "boolean" ? alignment.repeatedPattern : null,
    candidateCount: finiteMetric(alignment.candidateCount ?? alignment.diagnostics?.candidateCount),
    comparisonSize: safeComparisonSize(alignment.comparisonSize ?? alignment.diagnostics?.comparisonSize),
    elapsedMs: finiteMetric(alignment.elapsedMs ?? alignment.diagnostics?.elapsedMs),
    gates: Object.keys(gates).length ? gates : null,
    rejectionClassification: rejectionClassification(alignment),
    localFeatures: strategy === "local-features-ransac" ? featureDiagnostics : null,
    localFeatureAttempt: strategy === "correlation-fallback" ? featureDiagnostics : null,
    preservedAlignment: Boolean(preservedAlignment || alignment.preservedAlignment),
    transform: safeTransform(currentTransform || alignment),
  };
  return diagnostics;
}

export function buildQualityReport({
  profile,
  paper,
  artDimensions,
  cardDimensions,
  alignment,
  labelBox = profile.label_box,
  cornerRadiusMm = profile.recommended_corner_radius_mm || 0,
  exportOptions = {},
  papers = null,
  layouts = null,
  currentTransform = null,
  preservedAlignment = false,
}) {
  const cardMm = cardPhysicalMm(profile);
  const art = sourceQuality("Extended artwork", artDimensions, profile.master_mm[0]);
  const card = sourceQuality("Original card", cardDimensions, cardMm[0]);
  const paperSet = papers || (paper ? [paper] : []);
  const normalizedAlignment = alignment ? normalizeAlignmentResult(alignment) : null;
  const alignmentReport = serializeAlignmentDiagnostics(alignment, {
    currentTransform,
    preservedAlignment,
  });
  const warnings = [art, card]
    .filter(Boolean)
    .filter((result) => result.level !== "pass")
    .map((result) => result.message);
  if (normalizedAlignment?.status === ALIGNMENT_STATUSES.UNCERTAIN) {
    const classification = rejectionClassification(alignment);
    if (classification === "INSUFFICIENT_OVERSCAN") {
      const detail = alignmentEvidence(alignment).join(" ");
      warnings.push(detail || "Card artwork was found, but the image needs more surrounding artwork.");
    } else {
      warnings.push("Automatic reference matching was inconclusive; manual correction is required before final export.");
    }
  }
  if (normalizedAlignment?.status === "CENTERED_NOT_MATCHED") {
    warnings.push("Only a center-fit baseline is available; inspect and align manually before final export.");
  }
  if ([ALIGNMENT_STATUSES.FAILED, ALIGNMENT_STATUSES.TIMED_OUT, ALIGNMENT_STATUSES.CANCELLED]
    .includes(normalizedAlignment?.status)) {
    const retained = Boolean(alignmentReport?.preservedAlignment);
    warnings.push(retained
      ? `Alignment ${normalizedAlignment.status.toLowerCase().replaceAll("_", " ")} did not replace the last accepted/manual alignment; retry or continue manually.`
      : `Alignment ${normalizedAlignment.status.toLowerCase().replaceAll("_", " ")}; the center-fit baseline remains available. Inspect and adjust manually before export.`);
  }
  const blocked = Boolean(art?.blocksPackage || card?.blocksPackage);
  return {
    reportVersion: QUALITY_REPORT_VERSION,
    profileVersion: profile.version || null,
    profile: profile.name,
    paper: paper ? { name: paper.name, label: paper.label, sizeMm: [...paper.size_mm] } : null,
    papers: paperSet.map((item) => ({ name: item.name, label: item.label, sizeMm: [...item.size_mm] })),
    overallStatus: blocked ? "BLOCKED" : warnings.length ? "PASS_WITH_WARNINGS" : "PASS",
    sources: {
      artwork: artDimensions ? { dimensions: { ...artDimensions }, effectiveDpi: art?.dpi ?? null, quality: art } : null,
      card: cardDimensions ? { dimensions: { ...cardDimensions }, effectiveDpi: card?.dpi ?? null, quality: card } : null,
    },
    target: {
      masterPx: [...profile.master_px],
      insertPx: [...profile.insert_px],
      masterMm: [...profile.master_mm],
      insertMm: [...profile.insert_mm],
    },
    alignment: alignmentReport,
    cutouts: cutoutReport(profile, labelBox, cornerRadiusMm),
    pageLayouts: (layouts || []).map((layout) => ({
      paper: layout.paper,
      pageSizeMm: [...layout.pageSizeMm],
      pageCount: layout.pageCount,
      status: layout.status,
      warnings: [...layout.warnings],
    })),
    exportOptions: { ...exportOptions },
    warnings,
  };
}
