import { BINDER_POSITION_IDS } from "./pieces.js";

export const PROXY_SLOT_COUNT = 9;

export function createProxyBoard() {
  return {
    slots: Array.from({ length: PROXY_SLOT_COUNT }, () => null),
    nextSequence: 1,
    selectedIndex: null,
  };
}

export function defaultProxyTransform() {
  return { zoom: 1, offsetX: 0, offsetY: 0 };
}

export function proxySlotIndex(row, column) {
  return row * 3 + column;
}

export function proxySlotId(index) {
  return BINDER_POSITION_IDS[index] || null;
}

export function filledProxyIds(board) {
  return board.slots
    .map((slot, index) => (slot ? proxySlotId(index) : null))
    .filter(Boolean);
}

function lowestEmptyIndex(board) {
  return board.slots.findIndex((slot) => slot == null);
}

function oldestFilledIndex(board) {
  let oldestIndex = -1;
  let oldestSequence = Infinity;
  board.slots.forEach((slot, index) => {
    if (!slot) return;
    if (slot.sequence < oldestSequence) {
      oldestSequence = slot.sequence;
      oldestIndex = index;
    }
  });
  return oldestIndex;
}

function releaseSlotResources(slot, { releaseImage, revokePreviewUrl } = {}) {
  if (!slot) return;
  releaseImage?.(slot.image);
  revokePreviewUrl?.(slot.previewUrl);
}

function cloneBoard(board) {
  return {
    slots: [...board.slots],
    nextSequence: board.nextSequence,
    selectedIndex: board.selectedIndex,
  };
}

export function placeFiles(board, items, options = {}) {
  let next = cloneBoard(board);
  const placed = [];
  for (const item of items) {
    if (!item?.image) continue;
    let index = lowestEmptyIndex(next);
    if (index < 0) {
      index = oldestFilledIndex(next);
      if (index < 0) continue;
      releaseSlotResources(next.slots[index], options);
    }
    const sequence = next.nextSequence;
    next.nextSequence += 1;
    next.slots[index] = {
      sequence,
      file: item.file || null,
      image: item.image,
      previewUrl: item.previewUrl || null,
      dimensions: item.dimensions || { width: 0, height: 0 },
      transform: item.transform || defaultProxyTransform(),
    };
    next.selectedIndex = index;
    placed.push({ index, id: proxySlotId(index), sequence });
  }
  return { board: next, placed };
}

export function clearSlot(board, index, options = {}) {
  if (index < 0 || index >= PROXY_SLOT_COUNT) return board;
  const next = cloneBoard(board);
  releaseSlotResources(next.slots[index], options);
  next.slots[index] = null;
  if (next.selectedIndex === index) next.selectedIndex = null;
  return next;
}

export function clearAll(board, options = {}) {
  const next = cloneBoard(board);
  next.slots.forEach((slot) => releaseSlotResources(slot, options));
  next.slots = Array.from({ length: PROXY_SLOT_COUNT }, () => null);
  next.selectedIndex = null;
  return next;
}

export function selectSlot(board, index) {
  if (index == null) return { ...board, selectedIndex: null };
  if (index < 0 || index >= PROXY_SLOT_COUNT) return board;
  if (!board.slots[index]) return board;
  return { ...board, selectedIndex: index };
}

export function coverScale(imageSize, slotWidth, slotHeight) {
  if (!imageSize?.width || !imageSize?.height) return 1;
  return Math.max(slotWidth / imageSize.width, slotHeight / imageSize.height);
}

export function clampProxyTransform(transform, imageSize, slotWidth, slotHeight) {
  const zoom = Math.max(0.25, Math.min(8, Number(transform?.zoom) || 1));
  const base = coverScale(imageSize, slotWidth, slotHeight);
  const scale = base * zoom;
  const drawWidth = (imageSize?.width || slotWidth) * scale;
  const drawHeight = (imageSize?.height || slotHeight) * scale;
  let offsetX = Number(transform?.offsetX) || 0;
  let offsetY = Number(transform?.offsetY) || 0;
  let left = (slotWidth - drawWidth) / 2 + offsetX * slotWidth;
  let top = (slotHeight - drawHeight) / 2 + offsetY * slotHeight;
  left = Math.min(0, Math.max(slotWidth - drawWidth, left));
  top = Math.min(0, Math.max(slotHeight - drawHeight, top));
  return {
    zoom,
    offsetX: drawWidth <= slotWidth ? 0 : (left - (slotWidth - drawWidth) / 2) / slotWidth,
    offsetY: drawHeight <= slotHeight ? 0 : (top - (slotHeight - drawHeight) / 2) / slotHeight,
  };
}

export function setTransform(board, index, transform, imageSize, slotWidth, slotHeight) {
  if (index < 0 || index >= PROXY_SLOT_COUNT || !board.slots[index]) return board;
  const next = cloneBoard(board);
  const slot = { ...next.slots[index] };
  slot.transform = clampProxyTransform(
    transform,
    imageSize || slot.dimensions,
    slotWidth,
    slotHeight,
  );
  next.slots[index] = slot;
  return next;
}

export function drawProxyCover(context, image, width, height, transform) {
  const size = {
    width: image.naturalWidth || image.width || 0,
    height: image.naturalHeight || image.height || 0,
  };
  const clamped = clampProxyTransform(transform, size, width, height);
  const base = coverScale(size, width, height);
  const scale = base * clamped.zoom;
  const drawWidth = size.width * scale;
  const drawHeight = size.height * scale;
  const left = (width - drawWidth) / 2 + clamped.offsetX * width;
  const top = (height - drawHeight) / 2 + clamped.offsetY * height;
  context.drawImage(image, left, top, drawWidth, drawHeight);
  return clamped;
}
