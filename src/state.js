export const ALIGNMENT_STATUS_VERSION = "alignment-v4.0";

export const ALIGNMENT_STATUSES = Object.freeze({
  APPLIED: "MATCH_APPLIED",
  UNCERTAIN: "MATCH_UNCERTAIN",
  TIMED_OUT: "TIMED_OUT",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
});

const STATUS_ALIASES = new Map([
  ["MATCH_APPLIED", ALIGNMENT_STATUSES.APPLIED],
  ["MATCHED", ALIGNMENT_STATUSES.APPLIED],
  ["APPLIED", ALIGNMENT_STATUSES.APPLIED],
  ["MATCH_UNCERTAIN", ALIGNMENT_STATUSES.UNCERTAIN],
  ["NO_RELIABLE_MATCH", ALIGNMENT_STATUSES.UNCERTAIN],
  ["UNCERTAIN", ALIGNMENT_STATUSES.UNCERTAIN],
  ["TIMED_OUT", ALIGNMENT_STATUSES.TIMED_OUT],
  ["TIMEOUT", ALIGNMENT_STATUSES.TIMED_OUT],
  ["FAILED", ALIGNMENT_STATUSES.FAILED],
  ["ERROR", ALIGNMENT_STATUSES.FAILED],
  ["CANCELLED", ALIGNMENT_STATUSES.CANCELLED],
  ["CANCELED", ALIGNMENT_STATUSES.CANCELLED],
]);

function statusToken(value) {
  if (typeof value !== "string") return null;
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function firstStatus(result) {
  if (!result || typeof result !== "object") return result;
  return [
    result.status,
    result.resultStatus,
    result.result_status,
    result.transportStatus,
    result.transport_status,
  ].find((value) => value != null);
}

export function normalizeAlignmentStatus(value, accepted) {
  const token = statusToken(value);
  if (STATUS_ALIASES.has(token)) return STATUS_ALIASES.get(token);
  if (token) return token;
  if (accepted === true) return ALIGNMENT_STATUSES.APPLIED;
  if (accepted === false) return ALIGNMENT_STATUSES.UNCERTAIN;
  return null;
}

function finiteOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function alignmentTransform(result, fallback = null) {
  const source = result?.transform && typeof result.transform === "object"
    ? result.transform
    : result;
  const fallbackTransform = fallback || {};
  const zoom = finiteOr(source?.zoom, finiteOr(fallbackTransform.zoom, 1));
  const offsetX = finiteOr(source?.offsetX ?? source?.offset_x, finiteOr(fallbackTransform.offsetX, 0));
  const offsetY = finiteOr(source?.offsetY ?? source?.offset_y, finiteOr(fallbackTransform.offsetY, 0));
  return { zoom, offsetX, offsetY };
}

export function snapshotAlignment(source, metadata = {}) {
  const transform = alignmentTransform(source, metadata.fallback);
  return {
    ...transform,
    ...(metadata.method ? { method: metadata.method } : {}),
    ...(metadata.status ? { status: metadata.status } : {}),
  };
}

export function normalizeAlignmentResult(result = {}, defaults = {}) {
  const source = result && typeof result === "object" ? result : {};
  const rawStatus = firstStatus(source) ?? firstStatus(defaults);
  const status = normalizeAlignmentStatus(rawStatus, source.accepted ?? defaults.accepted)
    || ALIGNMENT_STATUSES.FAILED;
  const transform = alignmentTransform(source, defaults.transform || defaults);
  const accepted = status === ALIGNMENT_STATUSES.APPLIED
    ? true
    : status === ALIGNMENT_STATUSES.UNCERTAIN
      ? false
      : typeof source.accepted === "boolean"
        ? source.accepted
        : Boolean(defaults.accepted);
  return {
    ...source,
    ...defaults,
    ...transform,
    status,
    resultStatus: status,
    accepted,
    ...(rawStatus && normalizeAlignmentStatus(rawStatus, source.accepted) !== rawStatus
      ? { legacyStatus: rawStatus }
      : {}),
  };
}

export function createInitialState(profiles, papers) {
  return {
    profile: null,
    paper: null,
    profiles,
    papers,
    artFile: null,
    cardFile: null,
    artImage: null,
    cardImage: null,
    artPreviewUrl: null,
    cardPreviewUrl: null,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    cardOffsetX: 0,
    cardOffsetY: 0,
    opacity: 0.72,
    cornerRadiusMm: 3,
    psaLabelWidthMm: 69.85,
    psaLabelHeightMm: 21.59,
    showGrid: true,
    showCard: true,
    difference: false,
    dragging: false,
    pointerX: 0,
    pointerY: 0,
    alignmentBusy: false,
    alignmentStatus: "NEEDS_REFERENCE",
    alignmentJobId: 0,
    lastCompletedJobId: 0,
    baseline: null,
    matcherDiagnostics: null,
    qualityReport: null,
    alignmentRequestId: 0,
    alignmentSnapshot: null,
    lastStableAlignment: null,
    alignmentSourceGenerations: null,
    alignmentRestartPending: false,
    exportBusy: false,
    packageUrl: null,
    focusBeforeAlignment: null,
    setupStep: "product",
    quality: { warnings: [] },
  };
}

export function imageSize(image) {
  return {
    width: image?.naturalWidth || image?.width || 0,
    height: image?.naturalHeight || image?.height || 0,
  };
}

export function releaseImage(image) {
  if (image && typeof image.close === "function") image.close();
}
