import { isSlabProfile } from "./profiles.js";

export const GUIDE_CLEARANCE_PT = 0.25;
export const GUIDE_STROKE_PT = 0.5;

export function pointsToPixels(points, dpi = 300) {
  return (points / 72) * dpi;
}

export function millimetersToPixels(mm, dpi = 300) {
  return (mm / 25.4) * dpi;
}

export function normalizedBoxToPixels(box, width, height) {
  const left = Math.round(box[0] * width);
  const top = Math.round(box[1] * height);
  const right = Math.round(box[2] * width);
  const bottom = Math.round(box[3] * height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function guideOffsetPx({ strokeWidthPx = pointsToPixels(GUIDE_STROKE_PT), clearancePx = pointsToPixels(GUIDE_CLEARANCE_PT) } = {}) {
  return (strokeWidthPx / 2) + clearancePx;
}

export function outerGuideRect(rect, options = {}) {
  const offset = guideOffsetPx(options);
  return {
    x: rect.x - offset,
    y: rect.y - offset,
    width: rect.width + offset * 2,
    height: rect.height + offset * 2,
  };
}

export function internalGuideRect(rect, options = {}) {
  const offset = guideOffsetPx(options);
  return {
    x: rect.x + offset,
    y: rect.y + offset,
    width: Math.max(0, rect.width - offset * 2),
    height: Math.max(0, rect.height - offset * 2),
  };
}

export function getCutoutGeometry(
  profile,
  { labelBox = profile.label_box, cornerRadiusMm = profile.recommended_corner_radius_mm || 0 } = {},
) {
  const cutouts = [];
  if ((profile.name === "psa" || profile.name === "psaMini") && labelBox) {
    cutouts.push({ id: "PSA_LABEL", label: "PSA LABEL CUTOUT", box: labelBox, radiusMm: cornerRadiusMm });
  }
  if (isSlabProfile(profile)) {
    cutouts.push({ id: "CARD", label: "CARD CUTOUT", box: profile.card_box, radiusMm: cornerRadiusMm });
  } else if (profile.name === "photo8x10") {
    cutouts.push({ id: "CARD", label: "CARD CHAMBER", box: profile.card_box, radiusMm: cornerRadiusMm });
  } else if (profile.grid?.[0] === 3 && profile.grid?.[1] === 3) {
    cutouts.push({ id: "CENTER_CARD", label: "CENTER CARD", box: profile.card_box, radiusMm: cornerRadiusMm });
  }
  return cutouts;
}

export function getOutputMaskGeometry(profile, options = {}) {
  return getCutoutGeometry(profile, options).map((cutout) => ({
    ...cutout,
    pixels: physicalBoxToPixels(cutout.box, profile),
  }));
}

function physicalBoxToPixels(box, profile) {
  const [masterWidthMm, masterHeightMm] = profile.master_mm;
  const leftMm = box[0] * masterWidthMm;
  const topMm = box[1] * masterHeightMm;
  const widthMm = (box[2] - box[0]) * masterWidthMm;
  const heightMm = (box[3] - box[1]) * masterHeightMm;
  return {
    x: Math.round(millimetersToPixels(leftMm)),
    y: Math.round(millimetersToPixels(topMm)),
    width: Math.round(millimetersToPixels(widthMm)),
    height: Math.round(millimetersToPixels(heightMm)),
  };
}
