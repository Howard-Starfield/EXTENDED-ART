export const MATCHER_VERSION = "phase2.1";

export const MATCH_GATES = Object.freeze({
  minimumScore: 0.78,
  minimumMargin: 0.06,
});

const EPSILON = 1e-6;

export function rgbaToGray(rgba, width, height) {
  const gray = new Float32Array(width * height);
  for (let index = 0, pixel = 0; index < gray.length; index += 1, pixel += 4) {
    gray[index] = rgba[pixel] * 0.2126 + rgba[pixel + 1] * 0.7152 + rgba[pixel + 2] * 0.0722;
  }
  return gray;
}

export function resizeGray(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const output = new Float32Array(targetWidth * targetHeight);
  const scaleX = sourceWidth / targetWidth;
  const scaleY = sourceHeight / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const yWeight = Math.max(0, Math.min(1, sourceY - y0));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const xWeight = Math.max(0, Math.min(1, sourceX - x0));
      const top = source[y0 * sourceWidth + x0] * (1 - xWeight) + source[y0 * sourceWidth + x1] * xWeight;
      const bottom = source[y1 * sourceWidth + x0] * (1 - xWeight) + source[y1 * sourceWidth + x1] * xWeight;
      output[y * targetWidth + x] = top * (1 - yWeight) + bottom * yWeight;
    }
  }
  return output;
}

export function standardize(source) {
  let mean = 0;
  for (const value of source) mean += value;
  mean /= Math.max(1, source.length);
  let variance = 0;
  for (const value of source) variance += (value - mean) ** 2;
  const standardDeviation = Math.sqrt(variance / Math.max(1, source.length));
  const output = new Float32Array(source.length);
  if (standardDeviation < EPSILON) return output;
  for (let index = 0; index < source.length; index += 1) {
    output[index] = (source[index] - mean) / standardDeviation;
  }
  return output;
}

export function sobelMagnitude(source, width, height) {
  const output = new Float32Array(source.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const topLeft = source[(y - 1) * width + x - 1];
      const top = source[(y - 1) * width + x];
      const topRight = source[(y - 1) * width + x + 1];
      const left = source[y * width + x - 1];
      const right = source[y * width + x + 1];
      const bottomLeft = source[(y + 1) * width + x - 1];
      const bottom = source[(y + 1) * width + x];
      const bottomRight = source[(y + 1) * width + x + 1];
      const horizontal = topRight + 2 * right + bottomRight - topLeft - 2 * left - bottomLeft;
      const vertical = bottomLeft + 2 * bottom + bottomRight - topLeft - 2 * top - topRight;
      output[y * width + x] = Math.sqrt(horizontal * horizontal + vertical * vertical);
    }
  }
  return standardize(output);
}

export function correlation(left, right) {
  if (left.length !== right.length || !left.length) return 0;
  let numerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index < left.length; index += 1) {
    numerator += left[index] * right[index];
    leftEnergy += left[index] ** 2;
    rightEnergy += right[index] ** 2;
  }
  const denominator = Math.sqrt(leftEnergy * rightEnergy);
  return denominator < EPSILON ? 0 : numerator / denominator;
}

function shiftedCorrelation(source, width, height, offsetX, offsetY) {
  const left = [];
  const right = [];
  for (let y = 0; y < height - offsetY; y += 1) {
    for (let x = 0; x < width - offsetX; x += 1) {
      left.push(source[y * width + x]);
      right.push(source[(y + offsetY) * width + x + offsetX]);
    }
  }
  return correlation(standardize(left), standardize(right));
}

export function periodicityScore(source, width, height) {
  let best = 0;
  const maxX = Math.floor(width * 0.45);
  const maxY = Math.floor(height * 0.45);
  for (let offset = 2; offset <= maxX; offset += 1) {
    best = Math.max(best, shiftedCorrelation(source, width, height, offset, 0));
  }
  for (let offset = 2; offset <= maxY; offset += 1) {
    best = Math.max(best, shiftedCorrelation(source, width, height, 0, offset));
  }
  return best;
}

export function coverGeometry(artWidth, artHeight, masterWidth, masterHeight, transform) {
  const baseScale = Math.max(masterWidth / artWidth, masterHeight / artHeight);
  const scale = baseScale * transform.zoom;
  const drawWidth = artWidth * scale;
  const drawHeight = artHeight * scale;
  const left = (masterWidth - drawWidth) / 2 + transform.offsetX * masterWidth;
  const top = (masterHeight - drawHeight) / 2 + transform.offsetY * masterHeight;
  return { baseScale, scale, drawWidth, drawHeight, left, top };
}

export function coversMaster(artWidth, artHeight, masterWidth, masterHeight, transform) {
  const geometry = coverGeometry(artWidth, artHeight, masterWidth, masterHeight, transform);
  return geometry.left <= EPSILON
    && geometry.top <= EPSILON
    && geometry.left + geometry.drawWidth >= masterWidth - EPSILON
    && geometry.top + geometry.drawHeight >= masterHeight - EPSILON;
}

function sampleBilinear(source, width, height, x, y) {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const xWeight = x - x0;
  const yWeight = y - y0;
  const top = source[y0 * width + x0] * (1 - xWeight) + source[y0 * width + x1] * xWeight;
  const bottom = source[y1 * width + x0] * (1 - xWeight) + source[y1 * width + x1] * xWeight;
  return top * (1 - yWeight) + bottom * yWeight;
}

export function sampleArtworkCard({ art, artWidth, artHeight, masterWidth, masterHeight, cardBox, transform, width, height }) {
  const geometry = coverGeometry(artWidth, artHeight, masterWidth, masterHeight, transform);
  const [left, top, right, bottom] = cardBox;
  const cardLeft = left * masterWidth;
  const cardTop = top * masterHeight;
  const cardWidth = (right - left) * masterWidth;
  const cardHeight = (bottom - top) * masterHeight;
  const output = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const masterY = cardTop + ((y + 0.5) / height) * cardHeight;
    for (let x = 0; x < width; x += 1) {
      const masterX = cardLeft + ((x + 0.5) / width) * cardWidth;
      const sourceX = (masterX - geometry.left) / geometry.scale - 0.5;
      const sourceY = (masterY - geometry.top) / geometry.scale - 0.5;
      const sample = sampleBilinear(art, artWidth, artHeight, sourceX, sourceY);
      if (sample === null) return null;
      output[y * width + x] = sample;
    }
  }
  return output;
}

function valuesBetween(start, end, step) {
  const values = [];
  for (let value = start; value <= end + EPSILON; value += step) {
    values.push(Number(value.toFixed(6)));
  }
  return values;
}

function transformKey(transform) {
  return `${transform.zoom.toFixed(6)}:${transform.offsetX.toFixed(6)}:${transform.offsetY.toFixed(6)}`;
}

function scoreCandidate(input, transform) {
  if (!coversMaster(input.artWidth, input.artHeight, input.masterWidth, input.masterHeight, transform)) return null;
  const scene = sampleArtworkCard({
    ...input,
    width: input.comparisonWidth,
    height: input.comparisonHeight,
    transform,
  });
  if (!scene) return null;
  const sceneTone = standardize(scene);
  const sceneEdges = sobelMagnitude(sceneTone, input.comparisonWidth, input.comparisonHeight);
  const toneScore = correlation(sceneTone, input.cardTone);
  const edgeScore = correlation(sceneEdges, input.cardEdges);
  return Math.max(-1, Math.min(1, edgeScore * 0.7 + toneScore * 0.3));
}

function addCandidate(input, results, seen, transform) {
  const key = transformKey(transform);
  if (seen.has(key)) return;
  seen.add(key);
  const score = scoreCandidate(input, transform);
  if (score === null) return;
  results.push({ ...transform, score });
}

export function searchTransforms({
  art,
  artWidth,
  artHeight,
  card,
  cardWidth,
  cardHeight,
  masterWidth,
  masterHeight,
  cardBox,
  baseline = { zoom: 1, offsetX: 0, offsetY: 0 },
  comparisonHeight = 240,
  onProgress,
}) {
  const startedAt = Date.now();
  const cardAspect = ((cardBox[2] - cardBox[0]) * masterWidth) / ((cardBox[3] - cardBox[1]) * masterHeight);
  const comparisonWidth = Math.max(48, Math.round(comparisonHeight * cardAspect));
  const cardResized = resizeGray(card, cardWidth, cardHeight, comparisonWidth, comparisonHeight);
  const cardPeriodicity = periodicityScore(cardResized, comparisonWidth, comparisonHeight);
  const input = {
    art,
    artWidth,
    artHeight,
    masterWidth,
    masterHeight,
    cardBox,
    comparisonWidth,
    comparisonHeight,
    cardTone: standardize(cardResized),
    cardEdges: sobelMagnitude(cardResized, comparisonWidth, comparisonHeight),
  };
  const zoomValues = valuesBetween(1, 1.3, 0.05);
  const offsetValues = valuesBetween(-0.15, 0.15, 0.05);
  const coarseTotal = zoomValues.length * offsetValues.length * offsetValues.length;
  const results = [];
  const seen = new Set();
  let completed = 0;
  for (const zoom of zoomValues) {
    for (const offsetY of offsetValues) {
      for (const offsetX of offsetValues) {
        addCandidate(input, results, seen, { zoom, offsetX, offsetY });
        completed += 1;
        if (completed % 8 === 0) {
          onProgress?.({ stage: "Matching coarse transforms", completedWork: completed, totalWork: coarseTotal, progress: 25 + (completed / coarseTotal) * 45 });
        }
      }
    }
  }
  results.sort((left, right) => right.score - left.score);
  const seeds = results.slice(0, 5);
  const refinementTotal = Math.max(1, seeds.length * 125);
  let refinementCompleted = 0;
  for (const seed of seeds) {
    const fineZooms = valuesBetween(Math.max(1, seed.zoom - 0.05), Math.min(1.3, seed.zoom + 0.05), 0.025);
    const fineOffsetsX = valuesBetween(Math.max(-0.15, seed.offsetX - 0.05), Math.min(0.15, seed.offsetX + 0.05), 0.025);
    const fineOffsetsY = valuesBetween(Math.max(-0.15, seed.offsetY - 0.05), Math.min(0.15, seed.offsetY + 0.05), 0.025);
    for (const zoom of fineZooms) {
      for (const offsetY of fineOffsetsY) {
        for (const offsetX of fineOffsetsX) {
          addCandidate(input, results, seen, { zoom, offsetX, offsetY });
          refinementCompleted += 1;
          if (refinementCompleted % 10 === 0) {
            onProgress?.({ stage: "Refining top candidates", completedWork: refinementCompleted, totalWork: refinementTotal, progress: 70 + (refinementCompleted / refinementTotal) * 25 });
          }
        }
      }
    }
  }
  results.sort((left, right) => right.score - left.score);
  const best = results[0] || { ...baseline, score: 0 };
  const second = results.find((candidate) => transformKey(candidate) !== transformKey(best));
  const secondScore = second?.score ?? 0;
  const margin = best.score - secondScore;
  // A genuinely repeated reference can produce a high score at one phase while
  // still being ambiguous. Keep this conservative gate separate from the
  // calibrated score and margin thresholds so it is visible in diagnostics.
  const repeatedPattern = cardPeriodicity >= 0.995;
  const accepted = !repeatedPattern
    && best.score >= MATCH_GATES.minimumScore
    && margin >= MATCH_GATES.minimumMargin;
  onProgress?.({ stage: "Preparing match result", completedWork: 1, totalWork: 1, progress: 100 });
  return {
    matcherVersion: MATCHER_VERSION,
    status: accepted ? "MATCHED" : "NO_RELIABLE_MATCH",
    accepted,
    zoom: accepted ? best.zoom : baseline.zoom,
    offsetX: accepted ? best.offsetX : baseline.offsetX,
    offsetY: accepted ? best.offsetY : baseline.offsetY,
    bestScore: best.score,
    secondScore,
    scoreMargin: margin,
    periodicityScore: cardPeriodicity,
    repeatedPattern,
    comparisonSize: [comparisonWidth, comparisonHeight],
    elapsedMs: Date.now() - startedAt,
    candidateCount: results.length,
    gates: { ...MATCH_GATES },
  };
}
