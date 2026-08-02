import { imageSize } from "./state.js";
import { drawMasterArtwork, roundedRectPath } from "./renderer.js";

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

export function coverSourceSize(image) {
  return imageSize(image);
}
