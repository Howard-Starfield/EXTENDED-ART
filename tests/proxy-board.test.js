import { describe, expect, it, vi } from "vitest";
import {
  clearAll,
  clearSlot,
  createProxyBoard,
  filledProxyIds,
  placeFiles,
  selectSlot,
  setTransform,
} from "../src/proxy-board.js";

function item(label, sequenceHint) {
  return {
    file: { name: `${label}.png` },
    image: { id: label },
    previewUrl: `blob:${label}`,
    dimensions: { width: 1000, height: 1400 },
    transform: sequenceHint ? undefined : undefined,
  };
}

describe("proxy board fill and replace", () => {
  it("fills empty seats in ascending index order", () => {
    let board = createProxyBoard();
    ({ board } = placeFiles(board, [item("a"), item("b"), item("c")]));
    expect(board.slots[0].file.name).toBe("a.png");
    expect(board.slots[1].file.name).toBe("b.png");
    expect(board.slots[2].file.name).toBe("c.png");
    expect(board.slots[0].sequence).toBe(1);
    expect(board.slots[2].sequence).toBe(3);
    expect(filledProxyIds(board)).toEqual(["TL", "TC", "TR"]);
  });

  it("replaces the oldest filled seat when the board is full", () => {
    let board = createProxyBoard();
    const firstNine = Array.from({ length: 9 }, (_, index) => item(String(index)));
    ({ board } = placeFiles(board, firstNine));
    expect(filledProxyIds(board)).toHaveLength(9);
    ({ board } = placeFiles(board, [item("new")]));
    expect(board.slots[0].file.name).toBe("new.png");
    expect(board.slots[1].file.name).toBe("1.png");
    expect(board.slots[0].sequence).toBe(10);
  });

  it("prefers a cleared empty seat over replacing", () => {
    let board = createProxyBoard();
    ({ board } = placeFiles(board, Array.from({ length: 9 }, (_, index) => item(String(index)))));
    board = clearSlot(board, 4);
    expect(board.slots[4]).toBeNull();
    ({ board } = placeFiles(board, [item("into-center")]));
    expect(board.slots[4].file.name).toBe("into-center.png");
    expect(board.slots[0].file.name).toBe("0.png");
  });

  it("releases resources when clearing or replacing", () => {
    const releaseImage = vi.fn();
    const revokePreviewUrl = vi.fn();
    let board = createProxyBoard();
    ({ board } = placeFiles(board, [item("a")], { releaseImage, revokePreviewUrl }));
    board = clearSlot(board, 0, { releaseImage, revokePreviewUrl });
    expect(releaseImage).toHaveBeenCalledTimes(1);
    expect(revokePreviewUrl).toHaveBeenCalledWith("blob:a");
    ({ board } = placeFiles(board, Array.from({ length: 9 }, (_, index) => item(String(index)))));
    ({ board } = placeFiles(board, [item("replace")], { releaseImage, revokePreviewUrl }));
    expect(releaseImage).toHaveBeenCalled();
  });

  it("clears selection when the selected slot is cleared", () => {
    let board = createProxyBoard();
    ({ board } = placeFiles(board, [item("a")]));
    board = selectSlot(board, 0);
    expect(board.selectedIndex).toBe(0);
    board = clearSlot(board, 0);
    expect(board.selectedIndex).toBeNull();
    board = clearAll(createProxyBoard());
    expect(board.slots.every((slot) => slot == null)).toBe(true);
  });

  it("clamps pan so the cover image still fills the slot", () => {
    let board = createProxyBoard();
    ({ board } = placeFiles(board, [item("a")]));
    board = setTransform(board, 0, { zoom: 1, offsetX: 5, offsetY: -5 }, { width: 1000, height: 1400 }, 744, 1039);
    expect(Math.abs(board.slots[0].transform.offsetX)).toBeLessThan(1);
    expect(Math.abs(board.slots[0].transform.offsetY)).toBeLessThan(1);
  });
});
