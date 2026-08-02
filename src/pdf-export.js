import { PDFDocument, rgb } from "pdf-lib";
import { getCutoutGeometry } from "./output-geometry.js";
import { createPageLayout, millimetersToPoints } from "./page-layout.js";

export const PDF_EXPORT_VERSION = "phase3.0";
export const GUIDE_STROKE_PT = 0.5;
export const GUIDE_CLEARANCE_PT = 0.25;
const GUIDE_OFFSET_PT = GUIDE_STROKE_PT / 2 + GUIDE_CLEARANCE_PT;
const GUIDE_DASH = [3, 2];
const GUIDE_COLOR = rgb(0.09, 0.47, 0.52);

async function sourceBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (source?.arrayBuffer) return new Uint8Array(await source.arrayBuffer());
  throw new Error("A PNG source is required for PDF rendering.");
}

function sourceFor(sources, id) {
  if (sources instanceof Map) return sources.get(id);
  return sources?.[id];
}

function roundedRectPath(width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const k = 0.5522847498;
  const c = r * k;
  return [
    `M ${r} 0`,
    `L ${width - r} 0`,
    `C ${width - r + c} 0 ${width} ${r - c} ${width} ${r}`,
    `L ${width} ${height - r}`,
    `C ${width} ${height - r + c} ${width - r + c} ${height} ${width - r} ${height}`,
    `L ${r} ${height}`,
    `C ${r - c} ${height} 0 ${height - r + c} 0 ${height - r}`,
    `L 0 ${r}`,
    `C 0 ${r - c} ${r - c} 0 ${r} 0`,
    "Z",
  ].join(" ");
}

export function cutoutRect(profile, placement, cutout) {
  const masterWidthPt = millimetersToPoints(profile.master_mm[0]);
  const masterHeightPt = millimetersToPoints(profile.master_mm[1]);
  const width = cutout.box[2] - cutout.box[0];
  const height = cutout.box[3] - cutout.box[1];
  return {
    x: placement.xPt + cutout.box[0] * masterWidthPt,
    y: placement.yPt + (1 - cutout.box[3]) * masterHeightPt,
    width: width * masterWidthPt,
    height: height * masterHeightPt,
    radius: millimetersToPoints(cutout.radiusMm),
  };
}

export function svgPathOrigin(rect) {
  // pdf-lib's SVG path y-coordinate is the path's top edge. Keep this
  // conversion in one place so paths align with the embedded PNG bounds,
  // whose y-coordinate is the physical bottom edge.
  return { x: rect.x, y: rect.y + rect.height };
}

function drawOuterGuide(page, placement, cornerRadiusMm) {
  const rect = {
    x: placement.xPt - GUIDE_OFFSET_PT,
    y: placement.yPt - GUIDE_OFFSET_PT,
    width: placement.widthPt + GUIDE_OFFSET_PT * 2,
    height: placement.heightPt + GUIDE_OFFSET_PT * 2,
    radius: millimetersToPoints(cornerRadiusMm) + GUIDE_OFFSET_PT,
  };
  page.drawSvgPath(roundedRectPath(rect.width, rect.height, rect.radius), {
    ...svgPathOrigin(rect),
    borderWidth: GUIDE_STROKE_PT,
    borderColor: GUIDE_COLOR,
    borderDashArray: GUIDE_DASH,
    borderDashPhase: 0,
  });
}

function drawCutouts(
  page,
  profile,
  placement,
  {
    labelBox = profile.label_box,
    cornerRadiusMm = profile.recommended_corner_radius_mm || 0,
    fillCutouts = false,
    fillCard = false,
  } = {},
) {
  if (profile.grid[0] !== 1 || profile.grid[1] !== 1) return;
  const cutouts = getCutoutGeometry(profile, { labelBox, cornerRadiusMm });
  for (const cutout of cutouts) {
    const rect = cutoutRect(profile, placement, cutout);
    if (fillCutouts && (fillCard || cutout.id !== "CARD")) {
      page.drawSvgPath(roundedRectPath(rect.width, rect.height, rect.radius), {
        ...svgPathOrigin(rect),
        color: rgb(1, 1, 1),
      });
    }
    const guide = {
      x: rect.x + GUIDE_OFFSET_PT,
      y: rect.y + GUIDE_OFFSET_PT,
      width: Math.max(0, rect.width - GUIDE_OFFSET_PT * 2),
      height: Math.max(0, rect.height - GUIDE_OFFSET_PT * 2),
      radius: Math.max(0, rect.radius - GUIDE_OFFSET_PT),
    };
    page.drawSvgPath(roundedRectPath(
      guide.width,
      guide.height,
      guide.radius,
    ), {
      ...svgPathOrigin(guide),
      borderWidth: GUIDE_STROKE_PT,
      borderColor: cutout.id === "PSA_LABEL" ? rgb(0.95, 0.26, 0.17) : GUIDE_COLOR,
      borderDashArray: GUIDE_DASH,
      borderDashPhase: 0,
    });
  }
}

async function embedPngMap(pdfDoc, sources, ids) {
  const images = new Map();
  for (const id of ids) {
    const source = sourceFor(sources, id);
    if (!source) throw new Error(`Missing PNG source for piece ${id}.`);
    images.set(id, await pdfDoc.embedPng(await sourceBytes(source)));
  }
  return images;
}

export async function createCutReadyPdf({
  profile,
  paper,
  pieceSources,
  labelBox = profile.label_box,
  cornerRadiusMm = profile.recommended_corner_radius_mm || 0,
  title = "ExtendedArt cut-ready package",
  layout = createPageLayout(profile, paper),
}) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(title);
  pdfDoc.setSubject(`${profile.label} | ${paper.label} | exact-size cut-ready output`);
  pdfDoc.setCreator(`ExtendedArt Web ${PDF_EXPORT_VERSION}`);
  const ids = layout.placements.map((placement) => placement.pieceId);
  const images = await embedPngMap(pdfDoc, pieceSources, ids);

  for (const pageLayout of layout.pages) {
    const page = pdfDoc.addPage([pageLayout.widthPt, pageLayout.heightPt]);
    for (const placement of pageLayout.placements) {
      const image = images.get(placement.pieceId);
      page.drawImage(image, {
        x: placement.xPt,
        y: placement.yPt,
        width: placement.widthPt,
        height: placement.heightPt,
      });
      drawCutouts(page, profile, placement, { labelBox, cornerRadiusMm });
      drawOuterGuide(page, placement, cornerRadiusMm);
    }
  }
  return new Uint8Array(await pdfDoc.save());
}

export async function createWithCardReferencePdf({
  profile,
  paper,
  pieceSources,
  cardSource,
  labelBox = profile.label_box,
  cornerRadiusMm = profile.recommended_corner_radius_mm || 0,
  title = "ExtendedArt with-card reference",
  layout = createPageLayout(profile, paper, { includeCenter: true }),
}) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(title);
  pdfDoc.setSubject(`${profile.label} | ${paper.label} | reference copy with card overlay`);
  pdfDoc.setCreator(`ExtendedArt Web ${PDF_EXPORT_VERSION}`);
  const ids = layout.placements.map((placement) => placement.pieceId);
  const images = await embedPngMap(pdfDoc, pieceSources, ids);
  const cardImage = await pdfDoc.embedPng(await sourceBytes(cardSource));

  for (const pageLayout of layout.pages) {
    const page = pdfDoc.addPage([pageLayout.widthPt, pageLayout.heightPt]);
    for (const placement of pageLayout.placements) {
      page.drawImage(images.get(placement.pieceId), {
        x: placement.xPt,
        y: placement.yPt,
        width: placement.widthPt,
        height: placement.heightPt,
      });
      if (placement.pieceId === "C") {
        page.drawImage(cardImage, { x: placement.xPt, y: placement.yPt, width: placement.widthPt, height: placement.heightPt });
      } else if (profile.grid[0] === 1) {
        const cardCutout = getCutoutGeometry(profile, { labelBox, cornerRadiusMm }).find((cutout) => cutout.id === "CARD");
        if (cardCutout) {
          const rect = cutoutRect(profile, placement, cardCutout);
          page.drawImage(cardImage, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        }
      }
      drawCutouts(page, profile, placement, { labelBox, cornerRadiusMm, fillCutouts: true });
      drawOuterGuide(page, placement, cornerRadiusMm);
    }
  }
  return new Uint8Array(await pdfDoc.save());
}

export async function createFullArtPdf({ profile, paper, masterSource, title = "ExtendedArt reference artwork" }) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(title);
  pdfDoc.setSubject(`${profile.label} | ${paper.label} | REFERENCE - NOT CUT READY`);
  pdfDoc.setCreator(`ExtendedArt Web ${PDF_EXPORT_VERSION}`);
  const pageSize = paper.size_mm.map(millimetersToPoints);
  const page = pdfDoc.addPage(pageSize);
  const image = await pdfDoc.embedPng(await sourceBytes(masterSource));
  const masterWidth = millimetersToPoints(profile.master_mm[0]);
  const masterHeight = millimetersToPoints(profile.master_mm[1]);
  const scale = Math.min((pageSize[0] - 24) / masterWidth, (pageSize[1] - 42) / masterHeight, 1);
  const width = masterWidth * scale;
  const height = masterHeight * scale;
  page.drawText("REFERENCE - NOT CUT READY", { x: 12, y: pageSize[1] - 24, size: 10, color: rgb(0.55, 0.12, 0.08) });
  page.drawImage(image, { x: (pageSize[0] - width) / 2, y: 12, width, height });
  return new Uint8Array(await pdfDoc.save());
}

export async function createPrintGuidePdf({ profile, paper, layout = createPageLayout(profile, paper) }) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`${profile.label} ${paper.label} print guide`);
  pdfDoc.setSubject("Print at 100% and measure the calibration square before cutting.");
  pdfDoc.setCreator(`ExtendedArt Web ${PDF_EXPORT_VERSION}`);
  const pageSize = paper.size_mm.map(millimetersToPoints);
  const page = pdfDoc.addPage(pageSize);
  page.drawText("PRINT AT 100% / ACTUAL SIZE", { x: 18, y: pageSize[1] - 28, size: 13, color: rgb(0.08, 0.15, 0.18) });
  page.drawText(`${profile.label} | ${paper.label}`, { x: 18, y: pageSize[1] - 46, size: 9, color: rgb(0.25, 0.32, 0.34) });
  const square = millimetersToPoints(50);
  page.drawRectangle({ x: 18, y: pageSize[1] - 120 - square, width: square, height: square, borderWidth: 1, borderColor: GUIDE_COLOR });
  page.drawText("50 mm calibration square", { x: 18, y: pageSize[1] - 132 - square, size: 8, color: rgb(0.25, 0.32, 0.34) });
  const warning = layout.warnings.length ? "Warning: " + layout.warnings.join(" ") : "Measure the square, then print the cut-ready PDF at 100% with page scaling disabled.";
  page.drawText(warning.slice(0, 180), { x: 18, y: 42, size: 8, maxWidth: pageSize[0] - 36, color: rgb(0.45, 0.16, 0.08) });
  return new Uint8Array(await pdfDoc.save());
}
