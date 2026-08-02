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
