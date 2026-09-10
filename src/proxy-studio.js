import { outerGuideRect, pointsToPixels, GUIDE_STROKE_PT, GUIDE_CLEARANCE_PT } from "./output-geometry.js";
import {
  clearSlot,
  createProxyBoard,
  drawProxyCover,
  placeFiles,
  proxySlotId,
  selectSlot,
  setTransform,
} from "./proxy-board.js";
import { releaseImage } from "./state.js";
import { readImage, replacePreviewUrl } from "./image-io.js";

const TRASH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/><path d="M10 11v6M14 11v6"/></svg>`;

export function ensureProxyBoard(state) {
  if (!state.proxyBoard) state.proxyBoard = createProxyBoard();
  return state.proxyBoard;
}

export function revokeProxyPreview(url) {
  if (url) URL.revokeObjectURL(url);
}

function releaseOptions() {
  return {
    releaseImage,
    revokePreviewUrl: revokeProxyPreview,
  };
}

export function mountProxyBoard(root) {
  root.innerHTML = "";
  root.classList.add("proxy-board");
  for (let index = 0; index < 9; index += 1) {
    const seat = document.createElement("button");
    seat.type = "button";
    seat.className = "proxy-seat";
    seat.dataset.index = String(index);
    seat.setAttribute("aria-label", `Proxy seat ${proxySlotId(index)}`);
    const canvas = document.createElement("canvas");
    canvas.className = "proxy-seat-canvas";
    const trash = document.createElement("span");
    trash.className = "proxy-trash";
    trash.setAttribute("role", "button");
    trash.setAttribute("aria-label", `Remove ${proxySlotId(index)}`);
    trash.innerHTML = TRASH_SVG;
    const label = document.createElement("span");
    label.className = "proxy-seat-label";
    label.textContent = proxySlotId(index);
    seat.append(canvas, trash, label);
    root.append(seat);
  }
}

function drawSeatGuides(context, width, height, cornerRadiusMm, selected) {
  const radiusPx = Math.max(0, (cornerRadiusMm / 63) * width);
  const guide = outerGuideRect(
    { x: 0, y: 0, width, height },
    {
      strokeWidthPx: pointsToPixels(GUIDE_STROKE_PT),
      clearancePx: pointsToPixels(GUIDE_CLEARANCE_PT),
    },
  );
  context.save();
  context.strokeStyle = selected ? "#2aa9b8" : "rgba(23, 120, 132, 0.9)";
  context.lineWidth = Math.max(1, pointsToPixels(GUIDE_STROKE_PT) * (width / 744));
  context.setLineDash([6, 4]);
  context.beginPath();
  const r = Math.max(0, Math.min(radiusPx + (guide.width - width) / 2, guide.width / 2, guide.height / 2));
  context.moveTo(guide.x + r, guide.y);
  context.arcTo(guide.x + guide.width, guide.y, guide.x + guide.width, guide.y + guide.height, r);
  context.arcTo(guide.x + guide.width, guide.y + guide.height, guide.x, guide.y + guide.height, r);
  context.arcTo(guide.x, guide.y + guide.height, guide.x, guide.y, r);
  context.arcTo(guide.x, guide.y, guide.x + guide.width, guide.y, r);
  context.closePath();
  context.stroke();
  context.restore();
}

export function paintProxyBoard(root, board, profile, cornerRadiusMm) {
  const [slotW, slotH] = profile.insert_px;
  root.querySelectorAll(".proxy-seat").forEach((seat) => {
    const index = Number(seat.dataset.index);
    const slot = board.slots[index];
    const canvas = seat.querySelector("canvas");
    const selected = board.selectedIndex === index;
    seat.classList.toggle("is-filled", Boolean(slot));
    seat.classList.toggle("is-selected", selected);
    seat.classList.toggle("is-empty", !slot);
    const rect = seat.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cssW = rect.width;
    const cssH = rect.height;
    context.fillStyle = "#f7f5ef";
    context.fillRect(0, 0, cssW, cssH);
    if (slot?.image) {
      context.save();
      context.beginPath();
      const radius = Math.max(0, (cornerRadiusMm / 63) * cssW);
      context.moveTo(radius, 0);
      context.arcTo(cssW, 0, cssW, cssH, radius);
      context.arcTo(cssW, cssH, 0, cssH, radius);
      context.arcTo(0, cssH, 0, 0, radius);
      context.arcTo(0, 0, cssW, 0, radius);
      context.closePath();
      context.clip();
      drawProxyCover(context, slot.image, cssW, cssH, slot.transform);
      context.restore();
    } else {
      context.strokeStyle = "rgba(170, 178, 187, 0.9)";
      context.lineWidth = 1;
      context.setLineDash([4, 4]);
      context.strokeRect(4, 4, cssW - 8, cssH - 8);
      context.setLineDash([]);
    }
    drawSeatGuides(context, cssW, cssH, cornerRadiusMm, selected);
    // Keep transform clamps in print pixel space when editing later.
    seat.dataset.slotWidth = String(slotW);
    seat.dataset.slotHeight = String(slotH);
  });
}

export async function ingestProxyFiles(state, fileList, { onProgress } = {}) {
  const files = [...fileList].filter(Boolean);
  const decoded = [];
  for (const file of files) {
    try {
      onProgress?.(file.name);
      const result = await readImage(file, "art");
      decoded.push({
        file,
        image: result.image,
        previewUrl: replacePreviewUrl(null, file),
        dimensions: { width: result.width, height: result.height },
      });
    } catch (error) {
      decoded.push({ error, file });
    }
  }
  const successes = decoded.filter((item) => item.image);
  const failures = decoded.filter((item) => item.error);
  const board = ensureProxyBoard(state);
  const placed = placeFiles(board, successes, releaseOptions());
  state.proxyBoard = placed.board;
  return { placed: placed.placed, failures };
}

export function removeProxySlot(state, index) {
  const board = ensureProxyBoard(state);
  state.proxyBoard = clearSlot(board, index, releaseOptions());
  return state.proxyBoard;
}

export function selectProxySeat(state, index) {
  const board = ensureProxyBoard(state);
  state.proxyBoard = selectSlot(board, index);
  return state.proxyBoard;
}

export function panSelectedProxy(state, dxNorm, dyNorm, profile) {
  const board = ensureProxyBoard(state);
  const index = board.selectedIndex;
  if (index == null || !board.slots[index]) return board;
  const slot = board.slots[index];
  const next = {
    zoom: slot.transform.zoom,
    offsetX: slot.transform.offsetX + dxNorm,
    offsetY: slot.transform.offsetY + dyNorm,
  };
  state.proxyBoard = setTransform(
    board,
    index,
    next,
    slot.dimensions,
    profile.insert_px[0],
    profile.insert_px[1],
  );
  return state.proxyBoard;
}

export function zoomSelectedProxy(state, zoomDelta, profile) {
  const board = ensureProxyBoard(state);
  const index = board.selectedIndex;
  if (index == null || !board.slots[index]) return board;
  const slot = board.slots[index];
  state.proxyBoard = setTransform(
    board,
    index,
    {
      zoom: slot.transform.zoom + zoomDelta,
      offsetX: slot.transform.offsetX,
      offsetY: slot.transform.offsetY,
    },
    slot.dimensions,
    profile.insert_px[0],
    profile.insert_px[1],
  );
  return state.proxyBoard;
}

export function resetSelectedProxyTransform(state, profile) {
  const board = ensureProxyBoard(state);
  const index = board.selectedIndex;
  if (index == null || !board.slots[index]) return board;
  const slot = board.slots[index];
  state.proxyBoard = setTransform(
    board,
    index,
    { zoom: 1, offsetX: 0, offsetY: 0 },
    slot.dimensions,
    profile.insert_px[0],
    profile.insert_px[1],
  );
  return state.proxyBoard;
}

export function filledProxyCount(state) {
  return ensureProxyBoard(state).slots.filter(Boolean).length;
}
