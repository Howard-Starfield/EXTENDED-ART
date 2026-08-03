import { describe, expect, it } from "vitest";
import { coverGeometry, searchTransforms } from "../src/matcher-core.js";

const MASTER_WIDTH = 100;
const MASTER_HEIGHT = 120;
const CARD_BOX = [0.32, 0.2916667, 0.68, 0.7083333];
const CARD_WIDTH = 72;
const CARD_HEIGHT = 100;
const SCENE_WIDTH = 240;
const SCENE_HEIGHT = 220;

function makeCard({ contrast = 190, repeated = false } = {}) {
  const card = new Float32Array(CARD_WIDTH * CARD_HEIGHT);
  for (let y = 0; y < CARD_HEIGHT; y += 1) {
    for (let x = 0; x < CARD_WIDTH; x += 1) {
      const sourceX = repeated ? x % 12 : x;
      const sourceY = repeated ? y % 12 : y;
      const texture = ((sourceX * 17 + sourceY * 29 + (sourceX * sourceY) % 41) % 190);
      card[y * CARD_WIDTH + x] = 120 + (texture / 190) * contrast - contrast / 2;
    }
  }
  return card;
}

function makeScene(card, transform, { noCard = false, repeated = false, borderOverlay = false, semanticMismatch = false } = {}) {
  const scene = new Float32Array(SCENE_WIDTH * SCENE_HEIGHT);
  for (let y = 0; y < SCENE_HEIGHT; y += 1) {
    for (let x = 0; x < SCENE_WIDTH; x += 1) {
      scene[y * SCENE_WIDTH + x] = repeated
        ? 120 + (((x % 12) * 17 + (y % 12) * 29 + ((x % 12) * (y % 12)) % 41) % 190) / 190 * 190 - 95
        : 8 + ((x * 11 + y * 5) % 23);
    }
  }
  if (noCard) return scene;
  const geometry = coverGeometry(SCENE_WIDTH, SCENE_HEIGHT, MASTER_WIDTH, MASTER_HEIGHT, transform);
  const sceneCard = semanticMismatch ? makeCard({ contrast: 190 }).map((value, index) => (
    120 + ((((index % CARD_WIDTH) * 31 + Math.floor(index / CARD_WIDTH) * 7 + index % 23) % 190) / 190) * 190 - 95
  )) : card;
  const cardLeft = CARD_BOX[0] * MASTER_WIDTH;
  const cardTop = CARD_BOX[1] * MASTER_HEIGHT;
  const cardOutputWidth = (CARD_BOX[2] - CARD_BOX[0]) * MASTER_WIDTH;
  const cardOutputHeight = (CARD_BOX[3] - CARD_BOX[1]) * MASTER_HEIGHT;
  for (let sourceY = 0; sourceY < SCENE_HEIGHT; sourceY += 1) {
    for (let sourceX = 0; sourceX < SCENE_WIDTH; sourceX += 1) {
      const outputX = (sourceX + 0.5) * geometry.scale + geometry.left;
      const outputY = (sourceY + 0.5) * geometry.scale + geometry.top;
      if (outputX < cardLeft || outputX > cardLeft + cardOutputWidth || outputY < cardTop || outputY > cardTop + cardOutputHeight) continue;
      const cardX = Math.min(CARD_WIDTH - 1, Math.max(0, Math.round((outputX - cardLeft) / cardOutputWidth * CARD_WIDTH - 0.5)));
      const cardY = Math.min(CARD_HEIGHT - 1, Math.max(0, Math.round((outputY - cardTop) / cardOutputHeight * CARD_HEIGHT - 0.5)));
      const relativeX = (outputX - cardLeft) / cardOutputWidth;
      const relativeY = (outputY - cardTop) / cardOutputHeight;
      const isBorder = relativeX < 0.02 || relativeX >= 0.98 || relativeY < 0.02 || relativeY >= 0.98;
      scene[sourceY * SCENE_WIDTH + sourceX] = borderOverlay && isBorder
        ? ((sourceX + sourceY) % 2 ? 250 : 5)
        : sceneCard[cardY * CARD_WIDTH + cardX];
    }
  }
  return scene;
}

function runFixture(card, scene) {
  return searchTransforms({
    art: scene,
    artWidth: SCENE_WIDTH,
    artHeight: SCENE_HEIGHT,
    card,
    cardWidth: CARD_WIDTH,
    cardHeight: CARD_HEIGHT,
    masterWidth: MASTER_WIDTH,
    masterHeight: MASTER_HEIGHT,
    cardBox: CARD_BOX,
    comparisonHeight: 60,
  });
}

describe("reference matcher fixture release gates", () => {
  it("recovers known translation and scale within the coarse-to-fine error budget", () => {
    const fixtures = [
      { name: "translation-left", transform: { zoom: 1.05, offsetX: -0.05, offsetY: 0.025 } },
      { name: "scale-and-translation", transform: { zoom: 1.2, offsetX: 0.05, offsetY: -0.05 } },
      { name: "low-contrast", transform: { zoom: 1.1, offsetX: 0, offsetY: 0 }, contrast: 14 },
    ];
    const errors = fixtures.map((fixture) => {
      const card = makeCard({ contrast: fixture.contrast });
      const result = runFixture(card, makeScene(card, fixture.transform, fixture));
      expect(result.accepted, `${fixture.name}: ${result.reason}; score=${result.bestScore}; support=${result.supportFraction}`).toBe(true);
      const transformError = Math.max(
        Math.abs(result.zoom - fixture.transform.zoom),
        Math.abs(result.offsetX - fixture.transform.offsetX),
        Math.abs(result.offsetY - fixture.transform.offsetY),
      );
      expect(transformError, fixture.name).toBeLessThanOrEqual(0.03);
      const expectedGeometry = coverGeometry(SCENE_WIDTH, SCENE_HEIGHT, MASTER_WIDTH, MASTER_HEIGHT, fixture.transform);
      const actualGeometry = coverGeometry(SCENE_WIDTH, SCENE_HEIGHT, MASTER_WIDTH, MASTER_HEIGHT, result);
      return Math.max(
        Math.abs(expectedGeometry.left - actualGeometry.left),
        Math.abs(expectedGeometry.top - actualGeometry.top),
        Math.abs((expectedGeometry.left + expectedGeometry.drawWidth) - (actualGeometry.left + actualGeometry.drawWidth)),
        Math.abs((expectedGeometry.top + expectedGeometry.drawHeight) - (actualGeometry.top + actualGeometry.drawHeight)),
      );
    });

    const sorted = [...errors].sort((left, right) => left - right);
    expect(sorted[1]).toBeLessThanOrEqual(4);
    expect(Math.max(...errors)).toBeLessThanOrEqual(10);
  });

  it("ignores a deterministic UI/border overlay outside the 3% scoring inset", () => {
    const sceneCard = makeCard();
    const overlaidReference = Float32Array.from(sceneCard);
    for (let y = 0; y < CARD_HEIGHT; y += 1) {
      for (let x = 0; x < CARD_WIDTH; x += 1) {
        if (x === 0 || x === CARD_WIDTH - 1 || y === 0 || y === CARD_HEIGHT - 1) {
          overlaidReference[y * CARD_WIDTH + x] = (x + y) % 2 ? 250 : 5;
        }
      }
    }
    const result = runFixture(
      overlaidReference,
      makeScene(sceneCard, { zoom: 1.1, offsetX: 0, offsetY: 0 }),
    );

    expect(result.accepted, `${result.reason}; score=${result.bestScore}; margin=${result.scoreMargin}; support=${result.supportFraction}`).toBe(true);
    expect(result.supportedRegionCount).toBeGreaterThanOrEqual(5);
    expect(result.gates.regions).toBe(true);
  });

  it("rejects no-card and repeated-pattern negative fixtures", () => {
    const card = makeCard();
    const noCard = runFixture(card, makeScene(card, { zoom: 1, offsetX: 0, offsetY: 0 }, { noCard: true }));
    const repeatedCard = makeCard({ repeated: true });
    const repeated = runFixture(repeatedCard, makeScene(repeatedCard, { zoom: 1.1, offsetX: 0, offsetY: 0 }, { repeated: true }));

    expect(noCard.accepted).toBe(false);
    expect(repeated.accepted).toBe(false);
  });

  it("rejects a semantically different card even when the chamber geometry is correct", () => {
    const card = makeCard();
    const result = runFixture(
      card,
      makeScene(card, { zoom: 1.1, offsetX: 0, offsetY: 0 }, { semanticMismatch: true }),
    );

    expect(result.accepted).toBe(false);
    expect(result.status).toBe("MATCH_UNCERTAIN");
    expect(result.legacyStatus).toBe("NO_RELIABLE_MATCH");
    expect(result.crossRegionSupport).toBe(false);
  });
});
