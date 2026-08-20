import { imageSize } from "./state.js";
import { getCutoutGeometry, internalGuideRect, normalizedBoxToPixels } from "./output-geometry.js";
import { effectiveCardBox, isSingleDisplayProfile } from "./profiles.js";

export function roundedRectPath(context, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

export function drawCover(context, image, width, height, state) {
  const size = imageSize(image);
  const base = Math.max(width / size.width, height / size.height);
  const scale = base * state.zoom;
  const drawWidth = size.width * scale;
  const drawHeight = size.height * scale;
  let left = (width - drawWidth) / 2 + state.offsetX * width;
  let top = (height - drawHeight) / 2 + state.offsetY * height;
  left = Math.min(0, Math.max(width - drawWidth, left));
  top = Math.min(0, Math.max(height - drawHeight, top));
  context.drawImage(image, left, top, drawWidth, drawHeight);
  return {
    offsetX: (left - (width - drawWidth) / 2) / width,
    offsetY: (top - (height - drawHeight) / 2) / height,
  };
}

function drawCardReference(context, image, box, width, height, radius, opacity, difference) {
  const size = imageSize(image);
  const cardX = box[0] * width;
  const cardY = box[1] * height;
  const cardW = (box[2] - box[0]) * width;
  const cardH = (box[3] - box[1]) * height;
  const scale = Math.max(cardW / size.width, cardH / size.height);
  const drawWidth = size.width * scale;
  const drawHeight = size.height * scale;
  context.save();
  roundedRectPath(context, cardX, cardY, cardW, cardH, radius);
  context.clip();
  context.globalAlpha = opacity;
  if (difference) context.globalCompositeOperation = "difference";
  context.drawImage(image, cardX + (cardW - drawWidth) / 2, cardY + (cardH - drawHeight) / 2, drawWidth, drawHeight);
  context.restore();
}

export function drawAlignmentScene({ context, width, height, profile, state, artImage, cardImage, includeCard, labelBox }) {
  context.fillStyle = "#d9dad4";
  context.fillRect(0, 0, width, height);
  let clamped = { offsetX: state.offsetX, offsetY: state.offsetY };
  if (artImage) clamped = drawCover(context, artImage, width, height, state);

  const columns = profile.grid[0];
  const rows = profile.grid[1];
  const cellW = width / columns;
  const cellH = height / rows;
  const pieceRadius = (state.cornerRadiusMm / profile.insert_mm[0]) * cellW;
  // The card image, the on-screen chamber, and the cyan stroke all follow
  // the user's picked cell. The export cutout follows the same offset.
  const cardBox = effectiveCardBox(profile, state.cardOffsetX, state.cardOffsetY);
  const cardX = cardBox[0] * width;
  const cardY = cardBox[1] * height;
  const cardW = (cardBox[2] - cardBox[0]) * width;
  const cardH = (cardBox[3] - cardBox[1]) * height;
  const cardWidthMm = profile.master_mm[0] * (cardBox[2] - cardBox[0]);
  const cardRadius = (state.cornerRadiusMm / cardWidthMm) * cardW;

  if (cardImage && state.showCard) {
    drawCardReference(context, cardImage, cardBox, width, height, cardRadius, state.opacity, state.difference);
  }

  if (artImage && isSingleDisplayProfile(profile)) {
    const cutouts = getCutoutGeometry(profile, {
      labelBox,
      cornerRadiusMm: state.cornerRadiusMm,
      cardOffsetX: state.cardOffsetX,
      cardOffsetY: state.cardOffsetY,
    }).filter((cutout) => !(cutout.id === "CARD" && includeCard));
    context.save();
    for (const cutout of cutouts) {
      const box = normalizedBoxToPixels(cutout.box, width, height);
      const guide = internalGuideRect(box, { strokeWidthPx: 1.5 });
      const cutRadius = (cutout.radiusMm / profile.master_mm[0]) * width;
      const guideRadius = Math.max(0, cutRadius - (box.x - guide.x));
      roundedRectPath(context, box.x, box.y, box.width, box.height, cutRadius);
      const referenceVisible = cutout.id === "CARD" && cardImage && state.showCard;
      context.fillStyle = referenceVisible ? "rgba(255,255,255,.78)" : "rgba(255,255,255,.96)";
      context.fill();
      context.setLineDash([4, 3]);
      context.strokeStyle = cutout.id === "PSA_LABEL" ? "#f26345" : "#177884";
      context.lineWidth = 1.5;
      roundedRectPath(context, guide.x, guide.y, guide.width, guide.height, guideRadius);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = "#4f595c";
      context.font = '700 8px "Cascadia Mono", monospace';
      context.textAlign = "center";
      context.fillText(cutout.label, box.x + box.width / 2, box.y + Math.min(box.height / 2 + 3, 12));
    }
    context.restore();
  }

  if (state.showGrid) {
    context.save();
    context.strokeStyle = "rgba(255,255,255,.88)";
    context.lineWidth = 1;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        roundedRectPath(context, column * cellW + 0.5, row * cellH + 0.5, cellW - 1, cellH - 1, pieceRadius);
        context.stroke();
      }
    }
    // The cyan stroke is the "card position" outline — it follows the
    // user's picked cell so the on-screen preview matches the print.
    context.strokeStyle = state.difference ? "#f4d34d" : "#2aa9b8";
    context.lineWidth = 2;
    roundedRectPath(context, cardX + 1, cardY + 1, cardW - 2, cardH - 2, cardRadius);
    context.stroke();
    context.restore();
  }
  return clamped;
}

export function drawArtworkProof({ context, width, height, state, artImage }) {
  return drawMasterArtwork({ context, width, height, state, artImage });
}

export function drawMasterArtwork({ context, width, height, state, artImage, background = "#ffffff" }) {
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  if (!artImage) return { offsetX: state.offsetX, offsetY: state.offsetY };
  return drawCover(context, artImage, width, height, state);
}
