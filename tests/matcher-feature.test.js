import { describe, expect, it } from "vitest";
import { searchTransforms } from "../src/matcher-core.js";
import { estimateFeatureGeometry } from "../src/feature-matcher.js";

const CARD_WIDTH = 240;
const CARD_HEIGHT = 336;
const MASTER_WIDTH = 300;
const MASTER_HEIGHT = 420;
const CARD_BOX = [1 / 3, 1 / 3, 2 / 3, 2 / 3];
const ARTWORK_REGION = { left: 24, top: 28, right: 216, bottom: 198 };

function noise(x, y) {
  return ((x * 73856093 ^ y * 19349663 ^ (x * y * 83492791)) >>> 0) % 256;
}

function createCard({ repetitive = false, variant = 0 } = {}) {
  const card = new Float32Array(CARD_WIDTH * CARD_HEIGHT);
  for (let y = 0; y < CARD_HEIGHT; y += 1) {
    for (let x = 0; x < CARD_WIDTH; x += 1) {
      const tileX = repetitive ? x % 12 : x;
      const tileY = repetitive ? y % 12 : y;
      card[y * CARD_WIDTH + x] = repetitive
        ? 30 + ((tileX * 17 + tileY * 31) % 180)
        : 205 - ((x * 3 + y * 5) % 12);
    }
  }
  if (repetitive) return card;

  for (let y = ARTWORK_REGION.top; y < ARTWORK_REGION.bottom; y += 1) {
    for (let x = ARTWORK_REGION.left; x < ARTWORK_REGION.right; x += 1) {
      const texture = variant === 0
        ? noise(x, y) + noise(x * 3, y * 5) + ((x * 17 + y * 11) % 97)
        : noise(x * 5 + 19, y * 7 + 23) + noise(x * 11 + 29, y * 2 + 31) + ((x * 7 + y * 19) % 113);
      card[y * CARD_WIDTH + x] = 15 + (texture % 256) * 0.82;
    }
  }
  return card;
}

function createSceneBackground(width, height, repetitive) {
  const art = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tileX = repetitive ? x % 12 : x;
      const tileY = repetitive ? y % 12 : y;
      art[y * width + x] = repetitive
        ? 30 + ((tileX * 17 + tileY * 31) % 180)
        : 30 + ((x * 9 + y * 7 + noise(x >> 3, y >> 3)) % 40);
    }
  }
  return art;
}

function createEmbeddedScene({
  width = 840,
  height = 1176,
  cardLeft = 300,
  cardTop = 420,
  cardScale = 1,
  rotationDegrees = 0,
  noCard = false,
  repetitive = false,
  sceneCardVariant = 0,
  cardVariant = sceneCardVariant,
} = {}) {
  const sceneCard = createCard({ repetitive, variant: sceneCardVariant });
  const card = createCard({ repetitive, variant: cardVariant });
  const art = createSceneBackground(width, height, repetitive);
  if (noCard) return { art, card, width, height };

  const radians = rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const centerX = cardLeft + CARD_WIDTH / 2;
  const centerY = cardTop + CARD_HEIGHT / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const deltaX = x - centerX;
      const deltaY = y - centerY;
      const sourceX = (cosine * deltaX + sine * deltaY) / cardScale + CARD_WIDTH / 2;
      const sourceY = (-sine * deltaX + cosine * deltaY) / cardScale + CARD_HEIGHT / 2;
      if (sourceX < ARTWORK_REGION.left || sourceX >= ARTWORK_REGION.right
        || sourceY < ARTWORK_REGION.top || sourceY >= ARTWORK_REGION.bottom) continue;
      art[y * width + x] = sceneCard[Math.floor(sourceY) * CARD_WIDTH + Math.floor(sourceX)];
    }
  }
  return { art, card, width, height };
}

function expectedTransform({ cardLeft, cardTop, cardScale, width, height }) {
  const targetWidth = (CARD_BOX[2] - CARD_BOX[0]) * MASTER_WIDTH;
  const targetHeight = (CARD_BOX[3] - CARD_BOX[1]) * MASTER_HEIGHT;
  const scaleX = targetWidth / (cardScale * CARD_WIDTH);
  const scaleY = targetHeight / (cardScale * CARD_HEIGHT);
  const scale = (scaleX + scaleY) / 2;
  const baseScale = Math.max(MASTER_WIDTH / width, MASTER_HEIGHT / height);
  const estimatedCenterX = cardLeft + cardScale * CARD_WIDTH / 2;
  const estimatedCenterY = cardTop + cardScale * CARD_HEIGHT / 2;
  const left = (CARD_BOX[0] + CARD_BOX[2]) * MASTER_WIDTH / 2 - estimatedCenterX * scale;
  const top = (CARD_BOX[1] + CARD_BOX[3]) * MASTER_HEIGHT / 2 - estimatedCenterY * scale;
  return {
    zoom: scale / baseScale,
    offsetX: (left - (MASTER_WIDTH - width * scale) / 2) / MASTER_WIDTH,
    offsetY: (top - (MASTER_HEIGHT - height * scale) / 2) / MASTER_HEIGHT,
  };
}

function runMatcher(scenario) {
  return searchTransforms({
    art: scenario.art,
    artWidth: scenario.width,
    artHeight: scenario.height,
    card: scenario.card,
    cardWidth: CARD_WIDTH,
    cardHeight: CARD_HEIGHT,
    masterWidth: MASTER_WIDTH,
    masterHeight: MASTER_HEIGHT,
    cardBox: CARD_BOX,
    comparisonHeight: 80,
  });
}

describe("local feature estimator contract", () => {
  it("auto-applies a translated and scaled local card correspondence", () => {
    const scenario = createEmbeddedScene({ cardLeft: 250, cardTop: 350, cardScale: 0.98 });
    const result = runMatcher(scenario);
    const expected = expectedTransform({
      cardLeft: 250,
      cardTop: 350,
      cardScale: 0.98,
      width: scenario.width,
      height: scenario.height,
    });
    expect(result.status, result.reason).toBe("MATCH_APPLIED");
    expect(result.autoApplied).toBe(true);
    expect(result.strategy).toBe("local-features-ransac");
    expect(result.diagnostics.candidateMatches).toMatchObject({ rawPairCount: expect.any(Number) });
    expect(result.diagnostics.inliers.count).toBeGreaterThanOrEqual(10);
    expect(result.diagnostics.inliers.ratio).toBeGreaterThanOrEqual(0.26);
    expect(result.diagnostics.similarity).toMatchObject({
      scale: expect.any(Number),
      rotationDegrees: expect.any(Number),
      residual: { medianPx: expect.any(Number), thresholdPx: 4.5 },
    });
    expect(Math.abs(result.estimatedCardBox.sourcePx.left - 250)).toBeLessThan(6);
    expect(Math.abs(result.estimatedCardBox.sourcePx.top - 350)).toBeLessThan(6);
    expect(result.estimatedCardBox.normalized.source.left).toBeCloseTo(250 / 840, 2);
    expect(result.estimatedCardBox.normalized.source.top).toBeCloseTo(350 / 1176, 2);
    expect(result.requiredTransform).toMatchObject({
      zoom: expect.any(Number),
      offsetX: expect.any(Number),
      offsetY: expect.any(Number),
    });
    expect(result.zoom).toBeGreaterThan(1.05);
    expect(Math.abs(result.offsetX)).toBeGreaterThan(0.05);
    expect(Math.abs(result.offsetY)).toBeGreaterThan(0.05);
    expect(result.zoom).toBeCloseTo(expected.zoom, 1);
    expect(result.offsetX).toBeCloseTo(expected.offsetX, 1);
    expect(result.offsetY).toBeCloseTo(expected.offsetY, 1);
    expect(result.overscan.sourcePx.shortfall).toMatchObject({ width: 0, height: 0 });
  });

  it("keeps the baseline for a same-layout but different-card texture", () => {
    const result = runMatcher(createEmbeddedScene({
      cardLeft: 250,
      cardTop: 350,
      cardScale: 0.98,
      sceneCardVariant: 0,
      cardVariant: 1,
    }));

    expect(result.status).toBe("MATCH_UNCERTAIN");
    expect(result.autoApplied).toBe(false);
    expect(result.zoom).toBe(1);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
  });

  it("keeps the baseline when local correspondence is strong but surrounding art is insufficient", () => {
    const result = runMatcher(createEmbeddedScene({
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      cardLeft: 0,
      cardTop: 0,
    }));

    expect(result.status).toBe("MATCH_UNCERTAIN");
    expect(result.autoApplied).toBe(false);
    expect(result.rejectionClassification).toBe("INSUFFICIENT_OVERSCAN");
    expect(result.diagnostics.inliers.count).toBeGreaterThanOrEqual(10);
    expect(result.requiredTransform.zoom).toBeCloseTo(1 / 3, 3);
    expect(result.zoom).toBe(1);
    expect(result.overscan.sourcePx.requiredCanvas.width).toBeCloseTo(720, 2);
    expect(result.overscan.sourcePx.requiredCanvas.height).toBeCloseTo(1008, 2);
    expect(result.overscan.sourcePx.shortfall.left).toBeCloseTo(240, 2);
    expect(result.overscan.sourcePx.shortfall.top).toBeCloseTo(336, 2);
  });

  it("does not auto-apply absent or repetitive scenes", () => {
    for (const scenario of [
      createEmbeddedScene({ noCard: true }),
      createEmbeddedScene({ repetitive: true }),
    ]) {
      const result = runMatcher(scenario);
      expect(result.status).toBe("MATCH_UNCERTAIN");
      expect(result.autoApplied).toBe(false);
    }
  });

  it("rejects a detected rotation beyond the renderer transform contract", () => {
    const result = runMatcher(createEmbeddedScene({ rotationDegrees: 4 }));

    expect(result.status).toBe("MATCH_UNCERTAIN");
    expect(result.autoApplied).toBe(false);
    expect(result.rejectionClassification).toBe("ROTATION_BEYOND_RENDERER_CONTRACT");
    expect(result.diagnostics.compatibility.rejectionReason).toBe("ROTATION_BEYOND_RENDERER_CONTRACT");
  });

  it("classifies a strongly supported projective fit as renderer-incompatible", () => {
    const matches = [];
    for (let y = 42; y < CARD_HEIGHT - 20; y += 42) {
      for (let x = 28; x < CARD_WIDTH - 20; x += 36) {
        const horizontal = x / CARD_WIDTH;
        const vertical = y / CARD_HEIGHT;
        const denominator = 1 + 0.22 * vertical;
        matches.push({
          card: {
            x,
            y,
            roi: `${Math.floor(vertical * 5)}:${Math.floor(horizontal * 4)}`,
            row: Math.floor(vertical * 5),
            column: Math.floor(horizontal * 4),
          },
          art: {
            x: ((0.3 + 0.3 * horizontal + 0.04 * vertical) / denominator) * 840,
            y: ((0.34 + 0.03 * horizontal + 0.38 * vertical) / denominator) * 1176,
          },
          distance: 0,
        });
      }
    }

    const geometry = estimateFeatureGeometry({
      matches,
      cardWidth: CARD_WIDTH,
      cardHeight: CARD_HEIGHT,
      artWidth: 840,
      artHeight: 1176,
    });

    expect(geometry.homography.inlierCount).toBe(matches.length);
    expect(geometry.compatibility.rejectionReason).toBe("PERSPECTIVE_BEYOND_RENDERER_CONTRACT");
    expect(geometry.correspondenceFound).toBe(true);
  });
});
