import { imageSize } from "./state.js";
import { drawMasterArtwork, roundedRectPath } from "./renderer.js";
import { getOutputMaskGeometry } from "./output-geometry.js";

export const OUTPUT_DPI = 300;
export const BINDER_POSITION_IDS = Object.freeze([
  "TL", "TC", "TR",
  "ML", "C", "MR",
  "BL", "BC", "BR",
]);

const CENTER_POSITION_ID = "C";

export function mmToPixels(mm, dpi = OUTPUT_DPI) {
  return (mm / 25.4) * dpi;
}

export function roundedMaskRadiusPx(profile, cornerRadiusMm, dpi = OUTPUT_DPI) {
  if (!profile || !Number.isFinite(cornerRadiusMm)) return 0;
  return Math.max(0, Math.min(mmToPixels(cornerRadiusMm, dpi), mmToPixels(profile.insert_mm[0] / 2, dpi), mmToPixels(profile.insert_mm[1] / 2, dpi)));
}

function edgeAt(index, count, pixels) {
  return Math.round((index * pixels) / count);
}

function positionId(row, column, rows, columns) {
  if (rows === 3 && columns === 3) return BINDER_POSITION_IDS[row * columns + column];
  return `R${row + 1}C${column + 1}`;
}

export function getPieceGeometry(profile) {
  const columns = Math.max(1, profile.grid?.[0] || 1);
  const rows = Math.max(1, profile.grid?.[1] || 1);
  const [masterWidth, masterHeight] = profile.master_px;
  const [insertWidth, insertHeight] = profile.insert_px;
  const pieces = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = edgeAt(column, columns, masterWidth);
      const right = edgeAt(column + 1, columns, masterWidth);
      const top = edgeAt(row, rows, masterHeight);
      const bottom = edgeAt(row + 1, rows, masterHeight);
      const id = positionId(row, column, rows, columns);
      pieces.push({
        id,
        row,
        column,
        printable: !(profile.piece_count === 8 && id === CENTER_POSITION_ID),
        source: { x: left, y: top, width: right - left, height: bottom - top },
        output: { width: insertWidth, height: insertHeight },
      });
    }
  }
  return pieces;
}

export function getPrintablePieceGeometry(profile) {
  return getPieceGeometry(profile).filter((piece) => piece.printable);
}

function createCanvas({ width, height, documentRef, canvasFactory }) {
  const canvas = canvasFactory
    ? canvasFactory(width, height)
    : documentRef?.createElement?.("canvas");
  if (!canvas) throw new Error("A canvas factory is required for output rendering.");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function renderMasterToCanvas({ profile, state, artImage, documentRef = globalThis.document, canvasFactory }) {
  const [width, height] = profile.master_px;
  const canvas = createCanvas({ width, height, documentRef, canvasFactory });
  const context = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
  if (!context) throw new Error("The output canvas could not be created.");
  drawMasterArtwork({ context, width, height, state, artImage });
  return canvas;
}

export function applyRoundedAlphaMask(context, width, height, radiusPx) {
  context.save();
  context.globalCompositeOperation = "destination-in";
  context.globalAlpha = 1;
  context.fillStyle = "#ffffff";
  roundedRectPath(context, 0, 0, width, height, radiusPx);
  context.fill();
  context.restore();
}

export function applyCutoutMasks(
  context,
  width,
  height,
  profile,
  { labelBox = profile.label_box, cornerRadiusMm = profile.recommended_corner_radius_mm || 0, cardOffsetX = 0, cardOffsetY = 0 } = {},
) {
  const cutouts = getOutputMaskGeometry(profile, { labelBox, cornerRadiusMm, cardOffsetX, cardOffsetY });
  for (const cutout of cutouts) {
    // The cutout's pixel coords are in the master's space. We translate them
    // into the current canvas's space (which may be a sub-piece of the master)
    // so the cutout lands exactly on the piece the user picked.
    const scaleX = width / profile.master_px[0];
    const scaleY = height / profile.master_px[1];
    const rect = {
      x: cutout.pixels.x * scaleX,
      y: cutout.pixels.y * scaleY,
      width: cutout.pixels.width * scaleX,
      height: cutout.pixels.height * scaleY,
    };
    const radius = mmToPixels(cutout.radiusMm) * Math.min(scaleX, scaleY);
    context.save();
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.fillStyle = "#ffffff";
    roundedRectPath(context, rect.x, rect.y, rect.width, rect.height, radius);
    context.fill();
    context.restore();
  }
  return cutouts;
}

// Returns the [col, row] of the cell that the given pixel offset corresponds
// to, clamped to the profile's grid. Mirrors the renderer helper so the
// export pipeline stays in sync with the on-screen picker.
export function cellFromOffset(profile, cardOffsetX, cardOffsetY) {
  if (!profile || !profile.grid) return [0, 0];
  const [cols, rows] = profile.grid;
  const [masterW, masterH] = profile.master_px;
  const col = Math.round((Number(cardOffsetX) / masterW) * cols + (cols - 1) / 2);
  const row = Math.round((Number(cardOffsetY) / masterH) * rows + (rows - 1) / 2);
  return [
    Math.max(0, Math.min(cols - 1, col)),
    Math.max(0, Math.min(rows - 1, row)),
  ];
}

export function renderCutReadyPieceFromMaster({ masterCanvas, piece, profile, cornerRadiusMm, labelBox = profile.label_box, documentRef = globalThis.document, canvasFactory, cardOffsetX = 0, cardOffsetY = 0 }) {
  const canvas = renderPieceFromMaster({
    masterCanvas,
    piece,
    profile,
    cornerRadiusMm,
    documentRef,
    canvasFactory,
  });
  const context = canvas.getContext("2d", { alpha: true, colorSpace: "srgb" });
  if (!context) throw new Error("The cut-ready piece canvas could not be created.");
  // Apply the cutout to whichever piece the user picked. For a 1x1 profile
  // the picked cell is the only cell (so this matches the previous "full
  // master" check). For a binder, the picked cell may be one of the outer
  // pieces, so the cutout follows the user's card position into the print.
  const [pickedCol, pickedRow] = cellFromOffset(profile, cardOffsetX, cardOffsetY);
  if (piece.column === pickedCol && piece.row === pickedRow) {
    applyCutoutMasks(context, piece.output.width, piece.output.height, profile, { labelBox, cornerRadiusMm, cardOffsetX, cardOffsetY });
  }
  return canvas;
}

export function renderPieceFromMaster({ masterCanvas, piece, profile, cornerRadiusMm, documentRef = globalThis.document, canvasFactory }) {
  const canvas = createCanvas({
    width: piece.output.width,
    height: piece.output.height,
    documentRef,
    canvasFactory,
  });
  const context = canvas.getContext("2d", { alpha: true, colorSpace: "srgb" });
  if (!context) throw new Error("The piece canvas could not be created.");
  context.clearRect(0, 0, piece.output.width, piece.output.height);
  context.drawImage(
    masterCanvas,
    piece.source.x,
    piece.source.y,
    piece.source.width,
    piece.source.height,
    0,
    0,
    piece.output.width,
    piece.output.height,
  );
  applyRoundedAlphaMask(
    context,
    piece.output.width,
    piece.output.height,
    roundedMaskRadiusPx(profile, cornerRadiusMm),
  );
  return canvas;
}

export function renderPrintablePieces({ masterCanvas, profile, cornerRadiusMm, documentRef = globalThis.document, canvasFactory }) {
  return getPrintablePieceGeometry(profile).map((piece) => ({
    ...piece,
    canvas: renderPieceFromMaster({
      masterCanvas,
      piece,
      profile,
      cornerRadiusMm,
      documentRef,
      canvasFactory,
    }),
  }));
}

export function renderCutReadyPieces({ masterCanvas, profile, cornerRadiusMm, labelBox = profile.label_box, documentRef = globalThis.document, canvasFactory }) {
  return getPrintablePieceGeometry(profile).map((piece) => ({
    ...piece,
    canvas: renderCutReadyPieceFromMaster({
      masterCanvas,
      piece,
      profile,
      cornerRadiusMm,
      labelBox,
      documentRef,
      canvasFactory,
    }),
  }));
}

export function coverSourceSize(image) {
  return imageSize(image);
}
