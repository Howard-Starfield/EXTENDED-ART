import { MATCHER_CONFIG } from "./matcher-config.js";

export const FEATURE_MATCHER_STRATEGY = "local-features-ransac";
export const FEATURE_MATCHER_VERSION = MATCHER_CONFIG.features.version;

const EPSILON = 1e-6;
const BRIEF_WORDS = 4;
const DESCRIPTOR_ROTATION_PROBES = Object.freeze([0, 10, -10, 20, -20]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function cancellationError() {
  const error = new Error("Cancellation requested by the caller.");
  error.name = "AbortError";
  return error;
}

function throwIfCancelled(shouldCancel) {
  if (shouldCancel?.()) throw cancellationError();
}

function mergeFeatureConfig(config = {}) {
  const defaults = MATCHER_CONFIG.features;
  return {
    ...defaults,
    ...config,
    roiGrid: { ...defaults.roiGrid, ...(config.roiGrid || {}) },
    pyramidScales: config.pyramidScales || defaults.pyramidScales,
  };
}

function resizeGray(source, sourceWidth, sourceHeight, targetWidth, targetHeight, shouldCancel) {
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return source;
  const output = new Float32Array(targetWidth * targetHeight);
  const scaleX = sourceWidth / targetWidth;
  const scaleY = sourceHeight / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    if ((y & 0x1f) === 0) throwIfCancelled(shouldCancel);
    const sourceY = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const yWeight = clamp(sourceY - y0, 0, 1);
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const xWeight = clamp(sourceX - x0, 0, 1);
      const top = source[y0 * sourceWidth + x0] * (1 - xWeight)
        + source[y0 * sourceWidth + x1] * xWeight;
      const bottom = source[y1 * sourceWidth + x0] * (1 - xWeight)
        + source[y1 * sourceWidth + x1] * xWeight;
      output[y * targetWidth + x] = top * (1 - yWeight) + bottom * yWeight;
    }
  }
  return output;
}

function featureBase(source, width, height, config, shouldCancel) {
  const maximumDimension = Math.max(64, Math.floor(finiteOr(config.maximumDimension, 900)));
  const scale = Math.min(1, maximumDimension / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  return {
    gray: resizeGray(source, width, height, targetWidth, targetHeight, shouldCancel),
    width: targetWidth,
    height: targetHeight,
    inputScale: scale,
  };
}

function localContrast(source, width, height, radius, shouldCancel) {
  const stride = width + 1;
  const integral = new Float64Array((height + 1) * stride);
  for (let y = 0; y < height; y += 1) {
    if ((y & 0x1f) === 0) throwIfCancelled(shouldCancel);
    let rowSum = 0;
    const destinationRow = (y + 1) * stride;
    const previousRow = y * stride;
    for (let x = 0; x < width; x += 1) {
      rowSum += source[y * width + x];
      integral[destinationRow + x + 1] = integral[previousRow + x + 1] + rowSum;
    }
  }
  const output = new Float32Array(source.length);
  const safeRadius = Math.max(1, Math.floor(radius));
  for (let y = 0; y < height; y += 1) {
    if ((y & 0x1f) === 0) throwIfCancelled(shouldCancel);
    const y0 = Math.max(0, y - safeRadius);
    const y1 = Math.min(height, y + safeRadius + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - safeRadius);
      const x1 = Math.min(width, x + safeRadius + 1);
      const total = integral[y1 * stride + x1]
        - integral[y0 * stride + x1]
        - integral[y1 * stride + x0]
        + integral[y0 * stride + x0];
      output[y * width + x] = source[y * width + x] - total / ((x1 - x0) * (y1 - y0));
    }
  }
  return output;
}

function harrisResponses(plane, width, height, shouldCancel) {
  const horizontal = new Float32Array(plane.length);
  const vertical = new Float32Array(plane.length);
  for (let y = 1; y < height - 1; y += 1) {
    if ((y & 0x1f) === 0) throwIfCancelled(shouldCancel);
    for (let x = 1; x < width - 1; x += 1) {
      const topLeft = plane[(y - 1) * width + x - 1];
      const top = plane[(y - 1) * width + x];
      const topRight = plane[(y - 1) * width + x + 1];
      const left = plane[y * width + x - 1];
      const right = plane[y * width + x + 1];
      const bottomLeft = plane[(y + 1) * width + x - 1];
      const bottom = plane[(y + 1) * width + x];
      const bottomRight = plane[(y + 1) * width + x + 1];
      const index = y * width + x;
      horizontal[index] = topRight + 2 * right + bottomRight - topLeft - 2 * left - bottomLeft;
      vertical[index] = bottomLeft + 2 * bottom + bottomRight - topLeft - 2 * top - topRight;
    }
  }

  const response = new Float32Array(plane.length);
  let maximum = 0;
  for (let y = 2; y < height - 2; y += 1) {
    if ((y & 0x1f) === 0) throwIfCancelled(shouldCancel);
    for (let x = 2; x < width - 2; x += 1) {
      let xx = 0;
      let yy = 0;
      let xy = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const index = (y + dy) * width + x + dx;
          const gx = horizontal[index];
          const gy = vertical[index];
          xx += gx * gx;
          yy += gy * gy;
          xy += gx * gy;
        }
      }
      const trace = xx + yy;
      const value = xx * yy - xy * xy - 0.04 * trace * trace;
      if (value > 0) {
        response[y * width + x] = value;
        if (value > maximum) maximum = value;
      }
    }
  }
  return { response, maximum };
}

function createBriefPairs() {
  const pairs = [];
  let state = 0x63d83595;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  while (pairs.length < BRIEF_WORDS * 32) {
    const ax = (next() % 23) - 11;
    const ay = (next() % 23) - 11;
    const bx = (next() % 23) - 11;
    const by = (next() % 23) - 11;
    if (ax * ax + ay * ay > 100 || bx * bx + by * by > 100) continue;
    if ((ax - bx) ** 2 + (ay - by) ** 2 < 9) continue;
    pairs.push([ax, ay, bx, by]);
  }
  return pairs;
}

const BRIEF_PAIRS = createBriefPairs();

function descriptorSample(plane, width, x, y) {
  let total = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) total += plane[(y + dy) * width + x + dx];
  }
  return total / 9;
}

function descriptorAt(plane, width, x, y, rotationDegrees = 0) {
  const descriptor = new Uint32Array(BRIEF_WORDS);
  const radians = rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  for (let index = 0; index < BRIEF_PAIRS.length; index += 1) {
    const [ax, ay, bx, by] = BRIEF_PAIRS[index];
    const rotatedAx = Math.round(cosine * ax - sine * ay);
    const rotatedAy = Math.round(sine * ax + cosine * ay);
    const rotatedBx = Math.round(cosine * bx - sine * by);
    const rotatedBy = Math.round(sine * bx + cosine * by);
    const first = descriptorSample(plane, width, x + rotatedAx, y + rotatedAy);
    const second = descriptorSample(plane, width, x + rotatedBx, y + rotatedBy);
    if (first < second) descriptor[index >>> 5] |= 1 << (index & 31);
  }
  return descriptor;
}

function isLocalMaximum(response, width, x, y, radius) {
  const score = response[y * width + x];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (!dx && !dy) continue;
      const neighbor = response[(y + dy) * width + x + dx];
      if (neighbor > score) return false;
      if (neighbor === score && (dy < 0 || (dy === 0 && dx < 0))) return false;
    }
  }
  return true;
}

function selectKeypoints(plane, width, height, level, inputScale, config, shouldCancel) {
  const { response, maximum } = harrisResponses(plane, width, height, shouldCancel);
  const descriptorRadius = Math.max(4, Math.floor(finiteOr(config.descriptorRadius, 12)));
  const margin = descriptorRadius + 3;
  const threshold = maximum * Math.max(0, finiteOr(config.harrisThresholdFraction, 0.012));
  const localRadius = Math.max(1, Math.floor(finiteOr(config.nonMaximumRadius, 2)));
  const candidates = [];
  for (let y = margin; y < height - margin; y += 1) {
    if ((y & 0x1f) === 0) throwIfCancelled(shouldCancel);
    for (let x = margin; x < width - margin; x += 1) {
      const score = response[y * width + x];
      if (score < threshold || !isLocalMaximum(response, width, x, y, localRadius)) continue;
      candidates.push({ x, y, score });
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.y - right.y || left.x - right.x);

  const columns = Math.max(1, Math.floor(finiteOr(config.roiGrid?.columns, 4)));
  const rows = Math.max(1, Math.floor(finiteOr(config.roiGrid?.rows, 5)));
  const perRoi = Math.max(1, Math.floor(finiteOr(config.maxKeypointsPerRoi, 14)));
  const maximumKeypoints = Math.max(1, Math.floor(finiteOr(config.maxKeypointsPerLevel, 180)));
  const minimumDistance = Math.max(1, finiteOr(config.minimumKeypointDistance, 6));
  const selected = [];
  const selectedPerRoi = new Map();
  for (const candidate of candidates) {
    if (selected.length >= maximumKeypoints) break;
    const column = Math.min(columns - 1, Math.floor(candidate.x / width * columns));
    const row = Math.min(rows - 1, Math.floor(candidate.y / height * rows));
    const roi = `${row}:${column}`;
    if ((selectedPerRoi.get(roi) || 0) >= perRoi) continue;
    let tooNear = false;
    for (const previous of selected) {
      if ((candidate.x - previous.localX) ** 2 + (candidate.y - previous.localY) ** 2 < minimumDistance ** 2) {
        tooNear = true;
        break;
      }
    }
    if (tooNear) continue;
    selectedPerRoi.set(roi, (selectedPerRoi.get(roi) || 0) + 1);
    selected.push({
      x: candidate.x / inputScale,
      y: candidate.y / inputScale,
      localX: candidate.x,
      localY: candidate.y,
      score: candidate.score,
      level,
      roi,
      row,
      column,
      descriptor: descriptorAt(plane, width, candidate.x, candidate.y),
      descriptorVariants: DESCRIPTOR_ROTATION_PROBES.map((rotation) => descriptorAt(plane, width, candidate.x, candidate.y, rotation)),
    });
  }
  return selected;
}

function buildFeaturePyramid(source, width, height, config, shouldCancel) {
  const base = featureBase(source, width, height, config, shouldCancel);
  const features = [];
  const levels = [];
  const requestedScales = [...new Set(
    config.pyramidScales.map((value) => Math.max(0.25, Math.min(1, finiteOr(value, 1)))),
  )].sort((left, right) => right - left);
  for (let index = 0; index < requestedScales.length; index += 1) {
    throwIfCancelled(shouldCancel);
    const scale = requestedScales[index];
    const levelWidth = Math.max(32, Math.round(base.width * scale));
    const levelHeight = Math.max(32, Math.round(base.height * scale));
    const localScale = base.inputScale * scale;
    const gray = resizeGray(base.gray, base.width, base.height, levelWidth, levelHeight, shouldCancel);
    const contrast = localContrast(gray, levelWidth, levelHeight, Math.max(3, Math.round(4 * scale)), shouldCancel);
    const points = selectKeypoints(contrast, levelWidth, levelHeight, index, localScale, config, shouldCancel);
    features.push(...points);
    levels.push({ index, scale, width: levelWidth, height: levelHeight, keypointCount: points.length });
  }
  return {
    features,
    levels,
    base: { width: base.width, height: base.height, inputScale: base.inputScale },
  };
}

function popcount32(value) {
  let bits = value >>> 0;
  bits -= (bits >>> 1) & 0x55555555;
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
  return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function descriptorDistance(left, right) {
  let distance = 0;
  for (let index = 0; index < BRIEF_WORDS; index += 1) {
    distance += popcount32(left[index] ^ right[index]);
  }
  return distance;
}

function featureDescriptorDistance(left, right) {
  const leftVariants = left.descriptorVariants || [left.descriptor];
  const rightVariants = right.descriptorVariants || [right.descriptor];
  let best = Infinity;
  for (const leftDescriptor of leftVariants) {
    for (const rightDescriptor of rightVariants) {
      best = Math.min(best, descriptorDistance(leftDescriptor, rightDescriptor));
    }
  }
  return best;
}

function matchDescriptors(cardFeatures, artFeatures, config, shouldCancel) {
  const bestForArt = new Int32Array(artFeatures.length).fill(-1);
  const bestForArtDistance = new Int16Array(artFeatures.length).fill(32767);
  const ratioCandidates = [];
  const maximumDistance = Math.max(1, finiteOr(config.maximumDescriptorDistance, 58));
  const ratioThreshold = clamp(finiteOr(config.ratioThreshold, 0.78), 0.1, 0.99);
  for (let cardIndex = 0; cardIndex < cardFeatures.length; cardIndex += 1) {
    if ((cardIndex & 0x1f) === 0) throwIfCancelled(shouldCancel);
    const card = cardFeatures[cardIndex];
    let bestIndex = -1;
    let bestDistance = Infinity;
    let secondDistance = Infinity;
    for (let artIndex = 0; artIndex < artFeatures.length; artIndex += 1) {
      const distance = featureDescriptorDistance(card, artFeatures[artIndex]);
      if (distance < bestDistance) {
        secondDistance = bestDistance;
        bestDistance = distance;
        bestIndex = artIndex;
      } else if (distance < secondDistance) {
        secondDistance = distance;
      }
      if (distance < bestForArtDistance[artIndex]) {
        bestForArtDistance[artIndex] = distance;
        bestForArt[artIndex] = cardIndex;
      }
    }
    if (bestIndex >= 0 && bestDistance <= maximumDistance
      && (secondDistance === Infinity || bestDistance <= secondDistance * ratioThreshold)) {
      ratioCandidates.push({
        cardIndex,
        artIndex: bestIndex,
        distance: bestDistance,
        secondDistance: Number.isFinite(secondDistance) ? secondDistance : null,
      });
    }
  }
  const matches = ratioCandidates
    .filter((candidate) => bestForArt[candidate.artIndex] === candidate.cardIndex)
    .map((candidate) => ({
      ...candidate,
      card: cardFeatures[candidate.cardIndex],
      art: artFeatures[candidate.artIndex],
    }))
    .sort((left, right) => left.distance - right.distance
      || left.card.y - right.card.y
      || left.card.x - right.card.x
      || left.art.y - right.art.y
      || left.art.x - right.art.x);
  return {
    matches,
    ratioCandidateCount: ratioCandidates.length,
    rawPairCount: cardFeatures.length * artFeatures.length,
  };
}

function similarityFromPair(first, second) {
  const sourceX = second.card.x - first.card.x;
  const sourceY = second.card.y - first.card.y;
  const destinationX = second.art.x - first.art.x;
  const destinationY = second.art.y - first.art.y;
  const denominator = sourceX * sourceX + sourceY * sourceY;
  if (denominator < EPSILON) return null;
  const a = (sourceX * destinationX + sourceY * destinationY) / denominator;
  const b = (sourceX * destinationY - sourceY * destinationX) / denominator;
  const scale = Math.hypot(a, b);
  if (!Number.isFinite(scale) || scale < EPSILON) return null;
  return {
    a,
    b,
    tx: first.art.x - (a * first.card.x - b * first.card.y),
    ty: first.art.y - (b * first.card.x + a * first.card.y),
    scale,
    rotationDegrees: Math.atan2(b, a) * 180 / Math.PI,
  };
}

function mapSimilarity(model, point) {
  return {
    x: model.a * point.x - model.b * point.y + model.tx,
    y: model.b * point.x + model.a * point.y + model.ty,
  };
}

function residualForSimilarity(model, match) {
  const predicted = mapSimilarity(model, match.card);
  return Math.hypot(predicted.x - match.art.x, predicted.y - match.art.y);
}

function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[midpoint] : (ordered[midpoint - 1] + ordered[midpoint]) / 2;
}

function evaluateSimilarity(model, matches, threshold) {
  const inliers = [];
  const residuals = [];
  for (const match of matches) {
    const residual = residualForSimilarity(model, match);
    if (residual <= threshold) {
      inliers.push(match);
      residuals.push(residual);
    }
  }
  return {
    inliers,
    residuals,
    residualSum: residuals.reduce((total, value) => total + value, 0),
  };
}

function refineSimilarity(matches) {
  if (matches.length < 2) return null;
  let sourceX = 0;
  let sourceY = 0;
  let destinationX = 0;
  let destinationY = 0;
  for (const match of matches) {
    sourceX += match.card.x;
    sourceY += match.card.y;
    destinationX += match.art.x;
    destinationY += match.art.y;
  }
  sourceX /= matches.length;
  sourceY /= matches.length;
  destinationX /= matches.length;
  destinationY /= matches.length;
  let numeratorA = 0;
  let numeratorB = 0;
  let denominator = 0;
  for (const match of matches) {
    const x = match.card.x - sourceX;
    const y = match.card.y - sourceY;
    const targetX = match.art.x - destinationX;
    const targetY = match.art.y - destinationY;
    numeratorA += x * targetX + y * targetY;
    numeratorB += x * targetY - y * targetX;
    denominator += x * x + y * y;
  }
  if (denominator < EPSILON) return null;
  const a = numeratorA / denominator;
  const b = numeratorB / denominator;
  const scale = Math.hypot(a, b);
  if (scale < EPSILON || !Number.isFinite(scale)) return null;
  return {
    a,
    b,
    tx: destinationX - (a * sourceX - b * sourceY),
    ty: destinationY - (b * sourceX + a * sourceY),
    scale,
    rotationDegrees: Math.atan2(b, a) * 180 / Math.PI,
  };
}

function sampleIndexes(count, size, iteration, salt) {
  if (count < size) return null;
  let state = (0x9e3779b9 ^ Math.imul(iteration + 1, 0x85ebca6b) ^ salt) >>> 0;
  const result = [];
  while (result.length < size) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const index = state % count;
    if (!result.includes(index)) result.push(index);
  }
  return result;
}

function betterConsensus(candidate, best) {
  if (!best) return true;
  if (candidate.inliers.length !== best.inliers.length) return candidate.inliers.length > best.inliers.length;
  if (Math.abs(candidate.residualSum - best.residualSum) > EPSILON) return candidate.residualSum < best.residualSum;
  const candidateRotation = Math.abs(candidate.model.rotationDegrees);
  const bestRotation = Math.abs(best.model.rotationDegrees);
  return candidateRotation < bestRotation;
}

function runSimilarityRansac(matches, config, shouldCancel) {
  if (matches.length < 2) return null;
  const threshold = Math.max(1, finiteOr(config.inlierThresholdPx, 4.5));
  const iterations = Math.max(1, Math.floor(finiteOr(config.ransacIterations, 640)));
  const minimumScale = Math.max(EPSILON, finiteOr(config.minimumModelScale, 0.2));
  const maximumScale = Math.max(minimumScale, finiteOr(config.maximumModelScale, 4));
  let best = null;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if ((iteration & 0x1f) === 0) throwIfCancelled(shouldCancel);
    const indexes = sampleIndexes(matches.length, 2, iteration, 0x6d2b79f5);
    const model = similarityFromPair(matches[indexes[0]], matches[indexes[1]]);
    if (!model || model.scale < minimumScale || model.scale > maximumScale) continue;
    const evidence = evaluateSimilarity(model, matches, threshold);
    const candidate = { model, ...evidence };
    if (betterConsensus(candidate, best)) best = candidate;
  }
  if (!best) return null;
  for (let pass = 0; pass < 2; pass += 1) {
    const refined = refineSimilarity(best.inliers);
    if (!refined) break;
    const evidence = evaluateSimilarity(refined, matches, threshold);
    if (!betterConsensus({ model: refined, ...evidence }, best)
      && evidence.inliers.length < best.inliers.length) break;
    best = { model: refined, ...evidence };
  }
  return {
    ...best,
    inlierRatio: best.inliers.length / Math.max(1, matches.length),
    medianResidualPx: median(best.residuals),
  };
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) return null;
    if (pivot !== column) [augmented[pivot], augmented[column]] = [augmented[column], augmented[pivot]];
    const divisor = augmented[column][column];
    for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (Math.abs(factor) < EPSILON) continue;
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

function normalizedMatch(match, cardWidth, cardHeight, artWidth, artHeight) {
  return {
    sourceX: match.card.x / cardWidth,
    sourceY: match.card.y / cardHeight,
    destinationX: match.art.x / artWidth,
    destinationY: match.art.y / artHeight,
  };
}

function homographyRows(match, cardWidth, cardHeight, artWidth, artHeight) {
  const point = normalizedMatch(match, cardWidth, cardHeight, artWidth, artHeight);
  const { sourceX: x, sourceY: y, destinationX: targetX, destinationY: targetY } = point;
  return [
    { row: [x, y, 1, 0, 0, 0, -x * targetX, -y * targetX], value: targetX },
    { row: [0, 0, 0, x, y, 1, -x * targetY, -y * targetY], value: targetY },
  ];
}

function fitHomography(matches, cardWidth, cardHeight, artWidth, artHeight) {
  if (matches.length < 4) return null;
  const normal = Array.from({ length: 8 }, () => Array(8).fill(0));
  const rhs = Array(8).fill(0);
  for (const match of matches) {
    for (const { row, value } of homographyRows(match, cardWidth, cardHeight, artWidth, artHeight)) {
      for (let left = 0; left < 8; left += 1) {
        rhs[left] += row[left] * value;
        for (let right = 0; right < 8; right += 1) normal[left][right] += row[left] * row[right];
      }
    }
  }
  const values = solveLinearSystem(normal, rhs);
  if (!values || values.some((value) => !Number.isFinite(value))) return null;
  return [...values, 1];
}

function mapHomography(model, point, cardWidth, cardHeight, artWidth, artHeight) {
  const x = point.x / cardWidth;
  const y = point.y / cardHeight;
  const denominator = model[6] * x + model[7] * y + 1;
  if (Math.abs(denominator) < EPSILON) return null;
  return {
    x: ((model[0] * x + model[1] * y + model[2]) / denominator) * artWidth,
    y: ((model[3] * x + model[4] * y + model[5]) / denominator) * artHeight,
  };
}

function evaluateHomography(model, matches, threshold, cardWidth, cardHeight, artWidth, artHeight) {
  const inliers = [];
  const residuals = [];
  for (const match of matches) {
    const predicted = mapHomography(model, match.card, cardWidth, cardHeight, artWidth, artHeight);
    if (!predicted) continue;
    const residual = Math.hypot(predicted.x - match.art.x, predicted.y - match.art.y);
    if (residual <= threshold) {
      inliers.push(match);
      residuals.push(residual);
    }
  }
  return {
    inliers,
    residuals,
    residualSum: residuals.reduce((total, value) => total + value, 0),
  };
}

function runHomographyRansac(matches, cardWidth, cardHeight, artWidth, artHeight, config, shouldCancel) {
  if (matches.length < 4) return null;
  const threshold = Math.max(1, finiteOr(config.inlierThresholdPx, 4.5));
  const iterations = Math.max(1, Math.floor(finiteOr(config.homographyIterations, 420)));
  let best = null;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if ((iteration & 0x1f) === 0) throwIfCancelled(shouldCancel);
    const indexes = sampleIndexes(matches.length, 4, iteration, 0x27d4eb2d);
    const sample = indexes.map((index) => matches[index]);
    const model = fitHomography(sample, cardWidth, cardHeight, artWidth, artHeight);
    if (!model) continue;
    const evidence = evaluateHomography(model, matches, threshold, cardWidth, cardHeight, artWidth, artHeight);
    const candidate = { model, ...evidence };
    if (!best
      || candidate.inliers.length > best.inliers.length
      || (candidate.inliers.length === best.inliers.length && candidate.residualSum < best.residualSum)) {
      best = candidate;
    }
  }
  if (!best) return null;
  const refined = fitHomography(best.inliers, cardWidth, cardHeight, artWidth, artHeight);
  if (refined) {
    const evidence = evaluateHomography(refined, matches, threshold, cardWidth, cardHeight, artWidth, artHeight);
    if (evidence.inliers.length >= best.inliers.length) best = { model: refined, ...evidence };
  }
  return {
    ...best,
    inlierRatio: best.inliers.length / Math.max(1, matches.length),
    medianResidualPx: median(best.residuals),
  };
}

function spatialCoverage(inliers, cardWidth, cardHeight) {
  if (!inliers.length) {
    return {
      roiCount: 0,
      rowCount: 0,
      columnCount: 0,
      spreadX: 0,
      spreadY: 0,
    };
  }
  const rois = new Set(inliers.map((match) => match.card.roi));
  const rows = new Set(inliers.map((match) => match.card.row));
  const columns = new Set(inliers.map((match) => match.card.column));
  const xs = inliers.map((match) => match.card.x);
  const ys = inliers.map((match) => match.card.y);
  return {
    roiCount: rois.size,
    rowCount: rows.size,
    columnCount: columns.size,
    spreadX: (Math.max(...xs) - Math.min(...xs)) / Math.max(EPSILON, cardWidth),
    spreadY: (Math.max(...ys) - Math.min(...ys)) / Math.max(EPSILON, cardHeight),
  };
}

function similarityCardBox(model, cardWidth, cardHeight) {
  if (!model) return null;
  const corners = [
    mapSimilarity(model, { x: 0, y: 0 }),
    mapSimilarity(model, { x: cardWidth, y: 0 }),
    mapSimilarity(model, { x: cardWidth, y: cardHeight }),
    mapSimilarity(model, { x: 0, y: cardHeight }),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    centerX: corners.reduce((total, point) => total + point.x, 0) / corners.length,
    centerY: corners.reduce((total, point) => total + point.y, 0) / corners.length,
  };
}

function shapeCompatibility(model, cardWidth, cardHeight, artWidth, artHeight) {
  if (!model) return null;
  const sourceCorners = [
    { x: 0, y: 0 },
    { x: cardWidth, y: 0 },
    { x: cardWidth, y: cardHeight },
    { x: 0, y: cardHeight },
  ];
  const corners = sourceCorners.map((point) => mapHomography(model, point, cardWidth, cardHeight, artWidth, artHeight));
  if (corners.some((point) => !point)) return null;
  const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
  const top = distance(corners[0], corners[1]);
  const right = distance(corners[1], corners[2]);
  const bottom = distance(corners[2], corners[3]);
  const left = distance(corners[3], corners[0]);
  const average = (...values) => values.reduce((total, value) => total + value, 0) / values.length;
  const widthAverage = average(top, bottom);
  const heightAverage = average(left, right);
  const scaleValues = [top / cardWidth, bottom / cardWidth, left / cardHeight, right / cardHeight];
  const scaleAverage = average(...scaleValues);
  const topVector = { x: corners[1].x - corners[0].x, y: corners[1].y - corners[0].y };
  const leftVector = { x: corners[3].x - corners[0].x, y: corners[3].y - corners[0].y };
  const denominator = Math.max(EPSILON, Math.hypot(topVector.x, topVector.y) * Math.hypot(leftVector.x, leftVector.y));
  return {
    perspectiveDistortion: Math.max(
      Math.abs(top - bottom) / Math.max(EPSILON, widthAverage),
      Math.abs(left - right) / Math.max(EPSILON, heightAverage),
    ),
    affineDistortion: (Math.max(...scaleValues) - Math.min(...scaleValues)) / Math.max(EPSILON, scaleAverage),
    orthogonalityError: Math.abs((topVector.x * leftVector.x + topVector.y * leftVector.y) / denominator),
  };
}

function safeSimilarity(model) {
  if (!model) return null;
  return {
    scale: model.scale,
    rotationDegrees: model.rotationDegrees,
    translationX: model.tx,
    translationY: model.ty,
  };
}

function safeHomography(result, cardWidth, cardHeight, artWidth, artHeight) {
  if (!result) return null;
  return {
    inlierCount: result.inliers.length,
    inlierRatio: result.inlierRatio,
    medianResidualPx: result.medianResidualPx,
    shape: shapeCompatibility(result.model, cardWidth, cardHeight, artWidth, artHeight),
  };
}

// Exposed as a narrow deterministic seam for geometry-only regression tests.
// The image path below feeds it only cross-checked local descriptor matches;
// callers never need to provide image data, filenames, or descriptors here.
export function estimateFeatureGeometry({
  matches = [],
  cardWidth,
  cardHeight,
  artWidth,
  artHeight,
  config = MATCHER_CONFIG.features,
  keypointGate = true,
  shouldCancel,
} = {}) {
  const matcherConfig = mergeFeatureConfig(config);
  const similarity = runSimilarityRansac(matches, matcherConfig, shouldCancel);
  const homography = runHomographyRansac(
    matches,
    cardWidth,
    cardHeight,
    artWidth,
    artHeight,
    matcherConfig,
    shouldCancel,
  );
  const spatial = spatialCoverage(similarity?.inliers || [], cardWidth, cardHeight);
  const candidateGate = matches.length >= matcherConfig.minimumCandidateMatches;
  const inlierGate = (similarity?.inliers.length || 0) >= matcherConfig.minimumInliers;
  const ratioGate = (similarity?.inlierRatio || 0) >= matcherConfig.minimumInlierRatio;
  const roiGate = spatial.roiCount >= matcherConfig.minimumRois;
  const rowsGate = spatial.rowCount >= matcherConfig.minimumRows;
  const columnsGate = spatial.columnCount >= matcherConfig.minimumColumns;
  const spreadGate = spatial.spreadX >= matcherConfig.minimumSpreadX
    && spatial.spreadY >= matcherConfig.minimumSpreadY;
  const featureEvidencePassed = keypointGate && candidateGate && inlierGate && ratioGate
    && roiGate && rowsGate && columnsGate && spreadGate;
  const homographyStrong = Boolean(homography
    && homography.inliers.length >= matcherConfig.minimumInliers
    && homography.inlierRatio >= matcherConfig.minimumInlierRatio);
  // A projective fit is evidence only.  RANSAC can freely use its extra
  // degrees of freedom to describe a small, otherwise valid similarity
  // consensus as slightly projective.  Treat it as a renderer rejection only
  // when it materially explains more of the correspondence than similarity.
  const homographyMateriallyImprovesEvidence = Boolean(homographyStrong
    && homography.inliers.length >= Math.max(
      matcherConfig.minimumInliers,
      Math.ceil((similarity?.inliers.length || 0) * 1.25),
    )
    && homography.inlierRatio >= (similarity?.inlierRatio || 0) + 0.08);
  const homographySummary = safeHomography(homography, cardWidth, cardHeight, artWidth, artHeight);
  const shape = homographySummary?.shape || null;
  let rejectionReason = null;
  if (homographyMateriallyImprovesEvidence && shape?.perspectiveDistortion > matcherConfig.maximumPerspectiveDistortion) {
    rejectionReason = "PERSPECTIVE_BEYOND_RENDERER_CONTRACT";
  } else if (homographyMateriallyImprovesEvidence && (shape?.affineDistortion > matcherConfig.maximumAffineDistortion
    || shape?.orthogonalityError > matcherConfig.maximumAffineDistortion)) {
    rejectionReason = "AFFINE_BEYOND_RENDERER_CONTRACT";
  } else if (featureEvidencePassed && Math.abs(similarity?.model.rotationDegrees || 0) > matcherConfig.maximumRotationDegrees) {
    rejectionReason = "ROTATION_BEYOND_RENDERER_CONTRACT";
  }
  return {
    inliers: {
      count: similarity?.inliers.length || 0,
      ratio: similarity?.inlierRatio || 0,
      medianResidualPx: similarity?.medianResidualPx ?? null,
      thresholdPx: matcherConfig.inlierThresholdPx,
      spatialCoverage: spatial,
    },
    similarity: safeSimilarity(similarity?.model),
    homography: homographySummary,
    estimatedCardBox: similarityCardBox(similarity?.model, cardWidth, cardHeight),
    compatibility: {
      compatible: featureEvidencePassed && !rejectionReason,
      rejectionReason,
      maximumRotationDegrees: matcherConfig.maximumRotationDegrees,
      maximumPerspectiveDistortion: matcherConfig.maximumPerspectiveDistortion,
      maximumAffineDistortion: matcherConfig.maximumAffineDistortion,
      homographyMateriallyImprovesEvidence,
    },
    confidenceGates: {
      keypoints: keypointGate,
      candidateMatches: candidateGate,
      inliers: inlierGate,
      inlierRatio: ratioGate,
      rois: roiGate,
      rows: rowsGate,
      columns: columnsGate,
      spatialSpread: spreadGate,
      homographyMateriallyImprovesEvidence,
      passed: featureEvidencePassed,
    },
    correspondenceFound: featureEvidencePassed || Boolean(rejectionReason),
  };
}

// This is deliberately image-model-free: a local contrast pyramid, compact
// binary descriptors, cross-checked matches, and fixed-seed RANSAC make the
// result reproducible in a static worker while ignoring card UI that has no
// counterpart in the artwork scene.
export function matchLocalFeatures({
  art,
  artWidth,
  artHeight,
  card,
  cardWidth,
  cardHeight,
  config = MATCHER_CONFIG.features,
  onProgress,
  shouldCancel,
} = {}) {
  const startedAt = Date.now();
  const matcherConfig = mergeFeatureConfig(config);
  const invalidInput = !art || !card || !artWidth || !artHeight || !cardWidth || !cardHeight;
  const belowFeatureFloor = Math.min(cardWidth || 0, cardHeight || 0) < matcherConfig.minimumInputDimension;
  if (invalidInput || belowFeatureFloor) {
    return {
      strategy: FEATURE_MATCHER_STRATEGY,
      version: matcherConfig.version || FEATURE_MATCHER_VERSION,
      reason: invalidInput
        ? "Local feature matching received incomplete image pixels."
        : "The card-reference raster is below the deterministic local-feature size floor.",
      keypoints: { art: { total: 0, levels: [] }, card: { total: 0, levels: [] } },
      descriptors: { type: "brief-128-local-contrast", bits: 128, artCount: 0, cardCount: 0 },
      candidateMatches: { rawPairCount: 0, ratioCandidateCount: 0, crossCheckedCount: 0 },
      inliers: { count: 0, ratio: 0, medianResidualPx: null, spatialCoverage: spatialCoverage([], 1, 1) },
      similarity: null,
      homography: null,
      estimatedCardBox: null,
      compatibility: { compatible: false, rejectionReason: "INCOMPLETE_FEATURE_INPUT" },
      confidenceGates: { passed: false },
      correspondenceFound: false,
      elapsedMs: Date.now() - startedAt,
    };
  }

  onProgress?.({ stage: "Finding local card features", completedWork: 0, totalWork: 4, progress: 28 });
  const cardPyramid = buildFeaturePyramid(card, cardWidth, cardHeight, matcherConfig, shouldCancel);
  onProgress?.({ stage: "Finding local artwork features", completedWork: 1, totalWork: 4, progress: 39 });
  const artPyramid = buildFeaturePyramid(art, artWidth, artHeight, matcherConfig, shouldCancel);
  onProgress?.({ stage: "Matching local feature descriptors", completedWork: 2, totalWork: 4, progress: 51 });
  const matching = matchDescriptors(cardPyramid.features, artPyramid.features, matcherConfig, shouldCancel);
  const matches = matching.matches;
  onProgress?.({ stage: "Estimating robust local transform", completedWork: 3, totalWork: 4, progress: 62 });
  const keypointGate = cardPyramid.features.length >= matcherConfig.minimumKeypoints
    && artPyramid.features.length >= matcherConfig.minimumKeypoints;
  const geometry = estimateFeatureGeometry({
    matches,
    cardWidth,
    cardHeight,
    artWidth,
    artHeight,
    config: matcherConfig,
    keypointGate,
    shouldCancel,
  });
  throwIfCancelled(shouldCancel);
  onProgress?.({ stage: "Assessing renderer compatibility", completedWork: 4, totalWork: 4, progress: 65 });

  return {
    strategy: FEATURE_MATCHER_STRATEGY,
    version: matcherConfig.version || FEATURE_MATCHER_VERSION,
    keypoints: {
      art: { total: artPyramid.features.length, levels: artPyramid.levels, base: artPyramid.base },
      card: { total: cardPyramid.features.length, levels: cardPyramid.levels, base: cardPyramid.base },
      roiGrid: { ...matcherConfig.roiGrid },
    },
    descriptors: {
      type: "brief-128-local-contrast",
      bits: matcherConfig.descriptorBits,
      artCount: artPyramid.features.length,
      cardCount: cardPyramid.features.length,
      ratioThreshold: matcherConfig.ratioThreshold,
      maximumDistance: matcherConfig.maximumDescriptorDistance,
      rotationProbesDegrees: [...DESCRIPTOR_ROTATION_PROBES],
    },
    candidateMatches: {
      rawPairCount: matching.rawPairCount,
      ratioCandidateCount: matching.ratioCandidateCount,
      crossCheckedCount: matches.length,
    },
    ...geometry,
    elapsedMs: Date.now() - startedAt,
  };
}
