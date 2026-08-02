import { cardPhysicalMm } from "./profiles.js";
import { getOutputMaskGeometry } from "./output-geometry.js";
import { classifyEffectiveDpi } from "./quality.js";

export const QUALITY_REPORT_VERSION = "phase2.0";

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
}) {
  const cardMm = cardPhysicalMm(profile);
  const art = sourceQuality("Extended artwork", artDimensions, profile.master_mm[0]);
  const card = sourceQuality("Original card", cardDimensions, cardMm[0]);
  const paperSet = papers || (paper ? [paper] : []);
  const warnings = [art, card]
    .filter(Boolean)
    .filter((result) => result.level !== "pass")
    .map((result) => result.message);
  if (alignment?.status === "NO_RELIABLE_MATCH") {
    warnings.push("Automatic reference matching was inconclusive; manual correction is required before final export.");
  }
  if (["ERROR", "TIMED_OUT", "CANCELLED"].includes(alignment?.status)) {
    warnings.push(`Alignment status is ${alignment.status.toLowerCase().replaceAll("_", " ")}; complete another alignment before export.`);
  }
  const blocked = Boolean(art?.blocksPackage || card?.blocksPackage)
    || ["ERROR", "TIMED_OUT", "CANCELLED"].includes(alignment?.status);
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
    alignment: alignment ? {
      status: alignment.status,
      accepted: Boolean(alignment.accepted),
      matcherVersion: alignment.matcherVersion || null,
      profileVersion: alignment.profileVersion || profile.version || null,
      bestScore: alignment.bestScore ?? null,
      secondScore: alignment.secondScore ?? null,
      scoreMargin: alignment.scoreMargin ?? null,
      candidateCount: alignment.candidateCount ?? null,
      comparisonSize: alignment.comparisonSize || null,
      elapsedMs: alignment.elapsedMs ?? null,
    } : null,
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
