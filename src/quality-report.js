import { cardPhysicalMm } from "./profiles.js";
import { getOutputMaskGeometry } from "./output-geometry.js";
import { classifyEffectiveDpi } from "./quality.js";
import {
  ALIGNMENT_STATUS_VERSION,
  ALIGNMENT_STATUSES,
  alignmentTransform,
  normalizeAlignmentResult,
} from "./state.js";

export const QUALITY_REPORT_VERSION = "phase2.1";

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
    .replace(/(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|private|tmp|var|mnt|workspace|src|app)[\\/])\S*/gi, "[local input]")
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

export function serializeAlignmentDiagnostics(
  alignment,
  { currentTransform = null, preservedAlignment = false } = {},
) {
  if (!alignment) return null;
  const normalized = normalizeAlignmentResult(alignment);
  const rawStatus = rawAlignmentStatus(alignment);
  const gates = matcherGates(alignment);
  const reason = safeDiagnosticText(
    alignment.reason
      ?? alignment.failureReason
      ?? alignment.failure_reason
      ?? alignment.diagnostics?.reason,
  );
  const diagnostics = {
    status: normalized.status,
    statusVersion: ALIGNMENT_STATUS_VERSION,
    accepted: normalized.status === ALIGNMENT_STATUSES.APPLIED
      ? true
      : Boolean(normalized.accepted),
    autoApplied: normalized.status === ALIGNMENT_STATUSES.APPLIED && alignment.autoApplied !== false,
    method: alignment.method || alignment.alignmentMethod || alignment.alignment_method || null,
    matcherVersion: alignment.matcherVersion || alignment.matcher_version || null,
    transportVersion: alignment.transportVersion || alignment.transport_version || null,
    profileVersion: alignment.profileVersion || alignment.profile_version || null,
    stage: alignment.stage || null,
    stageVersion: alignment.stageVersion || alignment.stage_version || null,
    jobId: finiteMetric(alignment.jobId ?? alignment.job_id),
    legacyStatus: rawStatus && normalized.status !== rawStatus ? rawStatus : null,
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
    warnings.push("Automatic reference matching was inconclusive; manual correction is required before final export.");
  }
  if (normalizedAlignment?.status === "CENTERED_NOT_MATCHED") {
    warnings.push("Only a center-fit baseline is available; inspect and align manually before final export.");
  }
  if ([ALIGNMENT_STATUSES.FAILED, ALIGNMENT_STATUSES.TIMED_OUT, ALIGNMENT_STATUSES.CANCELLED]
    .includes(normalizedAlignment?.status)) {
    const retained = Boolean(alignmentReport?.preservedAlignment);
    warnings.push(retained
      ? `Alignment ${normalizedAlignment.status.toLowerCase().replaceAll("_", " ")} did not replace the last accepted/manual alignment; retry or continue manually.`
      : `Alignment ${normalizedAlignment.status.toLowerCase().replaceAll("_", " ")}; complete another alignment before export.`);
  }
  const transientStatus = [ALIGNMENT_STATUSES.FAILED, ALIGNMENT_STATUSES.TIMED_OUT, ALIGNMENT_STATUSES.CANCELLED]
    .includes(normalizedAlignment?.status);
  const blocked = Boolean(art?.blocksPackage || card?.blocksPackage)
    || (transientStatus && !alignmentReport?.preservedAlignment);
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
