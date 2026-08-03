import { describe, expect, it } from "vitest";
import {
  MATCHER_CONFIG,
  MATCH_GATES,
  correlation,
  coverGeometry,
  coverageDiagnostics,
  coversMaster,
  periodicityScore,
  searchTransforms,
  sobelMagnitude,
} from "../src/matcher-core.js";

function makeCard(width, height) {
  const card = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      card[y * width + x] = 40 + ((x * 17 + y * 29 + (x * y) % 41) % 190);
    }
  }
  return card;
}

function makeScene(width, height, card, cardWidth, cardHeight, masterWidth, masterHeight, cardBox, transform) {
  const scene = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) scene[y * width + x] = 8 + ((x * 11 + y * 5) % 23);
  }
  const geometry = coverGeometry(width, height, masterWidth, masterHeight, transform);
  const cardLeft = cardBox[0] * masterWidth;
  const cardTop = cardBox[1] * masterHeight;
  const cardOutputWidth = (cardBox[2] - cardBox[0]) * masterWidth;
  const cardOutputHeight = (cardBox[3] - cardBox[1]) * masterHeight;
  for (let sourceY = 0; sourceY < height; sourceY += 1) {
    for (let sourceX = 0; sourceX < width; sourceX += 1) {
      const outputX = (sourceX + 0.5) * geometry.scale + geometry.left;
      const outputY = (sourceY + 0.5) * geometry.scale + geometry.top;
      if (outputX < cardLeft || outputX > cardLeft + cardOutputWidth || outputY < cardTop || outputY > cardTop + cardOutputHeight) continue;
      const cardX = Math.min(cardWidth - 1, Math.max(0, Math.round((outputX - cardLeft) / cardOutputWidth * cardWidth - 0.5)));
      const cardY = Math.min(cardHeight - 1, Math.max(0, Math.round((outputY - cardTop) / cardOutputHeight * cardHeight - 0.5)));
      scene[sourceY * width + sourceX] = card[cardY * cardWidth + cardX];
    }
  }
  return scene;
}

describe("deterministic reference matcher", () => {
  it("keeps the bounded transform geometry inside the master", () => {
    expect(coversMaster(240, 220, 100, 120, { zoom: 1.1, offsetX: -0.05, offsetY: 0.05 })).toBe(true);
    expect(coversMaster(240, 220, 100, 120, { zoom: 1, offsetX: 0.2, offsetY: 0 })).toBe(false);
    const exact = coverageDiagnostics(100, 120, 100, 120, { zoom: 1, offsetX: 0, offsetY: 0 });
    const uncovered = coverageDiagnostics(100, 120, 100, 120, { zoom: 1, offsetX: 0.01, offsetY: 0 });
    expect(MATCHER_CONFIG.borderExclusion).toBeCloseTo(0.03, 6);
    expect(MATCH_GATES.minimumScore).toBe(0.78);
    expect(MATCH_GATES.minimumMargin).toBe(0.06);
    expect(exact.covered).toBe(true);
    expect(exact.requiredOverscanPx).toBe(2);
    expect(uncovered.covered).toBe(false);
    expect(uncovered.edgeClearancePx.left).toBeLessThan(0);
  });

  it("produces a normalized Sobel plane and perfect correlation for identical data", () => {
    const plane = Float32Array.from([0, 0, 0, 255, 255, 0, 0, 0, 0]);
    const edges = sobelMagnitude(plane, 3, 3);
    expect(edges[4]).not.toBe(0);
    expect(correlation(edges, edges)).toBeCloseTo(1, 6);
  });

  it("detects an exactly repeated card texture as ambiguous", () => {
    const repeated = new Float32Array(48 * 60);
    for (let y = 0; y < 60; y += 1) {
      for (let x = 0; x < 48; x += 1) repeated[y * 48 + x] = (x % 8 < 4 ? 30 : 220);
    }
    expect(periodicityScore(repeated, 48, 60)).toBeGreaterThan(0.995);
  });

  it("recovers a known zoom and translation when the scene contains the card", () => {
    const masterWidth = 100;
    const masterHeight = 120;
    const cardBox = [0.32, 0.2916667, 0.68, 0.7083333];
    const cardWidth = 72;
    const cardHeight = 100;
    const card = makeCard(cardWidth, cardHeight);
    const transform = { zoom: 1.1, offsetX: -0.05, offsetY: 0.05 };
    const scene = makeScene(240, 220, card, cardWidth, cardHeight, masterWidth, masterHeight, cardBox, transform);
    const result = searchTransforms({
      art: scene,
      artWidth: 240,
      artHeight: 220,
      card,
      cardWidth,
      cardHeight,
      masterWidth,
      masterHeight,
      cardBox,
      comparisonHeight: 60,
    });
    expect(result.accepted).toBe(true);
    expect(result.status).toBe("MATCH_APPLIED");
    expect(result.legacyStatus).toBe("MATCHED");
    expect(result.bestScore).toBeGreaterThanOrEqual(MATCH_GATES.minimumScore);
    expect(result.regionScores).toHaveLength(9);
    expect(result.regionSupport).toHaveLength(9);
    expect(result.supportedRegionCount).toBeGreaterThanOrEqual(5);
    expect(result.comparisonLevels).toHaveLength(3);
    expect(result.gates.passed).toBe(true);
    expect(result.zoom).toBeCloseTo(transform.zoom, 2);
    expect(result.offsetX).toBeCloseTo(transform.offsetX, 2);
    expect(result.offsetY).toBeCloseTo(transform.offsetY, 2);
  });

  it("does not accept an ambiguous scene without a reliable card match", () => {
    const card = makeCard(72, 100);
    const scene = new Float32Array(240 * 220).fill(12);
    const result = searchTransforms({
      art: scene,
      artWidth: 240,
      artHeight: 220,
      card,
      cardWidth: 72,
      cardHeight: 100,
      masterWidth: 100,
      masterHeight: 120,
      cardBox: [0.32, 0.2916667, 0.68, 0.7083333],
      comparisonHeight: 60,
    });

    expect(result.accepted).toBe(false);
    expect(result.status).toBe("MATCH_UNCERTAIN");
    expect(result.legacyStatus).toBe("NO_RELIABLE_MATCH");
    expect(result.reason).toContain("aggregate score");
  });
});
