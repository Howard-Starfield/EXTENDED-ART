import {
  MATCHER_CONFIG,
  MATCHER_CONFIG_VERSION,
  MATCH_GATES as CONFIG_GATES,
} from "./matcher-config.js";
import { matchLocalFeatures } from "./feature-matcher.js";

export { MATCHER_CONFIG, MATCHER_CONFIG_VERSION };

export const MATCHER_VERSION = MATCHER_CONFIG_VERSION;
export const MATCH_GATES = CONFIG_GATES;

const EPSILON = 1e-6;
const LUMINANCE = [0.2126, 0.7152, 0.0722];

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeTransform(transform = {}) {
  return {
    zoom: finiteOr(Number(transform.zoom), 1) > EPSILON ? finiteOr(Number(transform.zoom), 1) : 1,
    offsetX: finiteOr(Number(transform.offsetX), 0),
    offsetY: finiteOr(Number(transform.offsetY), 0),
  };
}

export function rgbaToGray(rgba, width, height) {
  const gray = new Float32Array(width * height);
  for (let index = 0, pixel = 0; index < gray.length; index += 1, pixel += 4) {
    gray[index] = rgba[pixel] * LUMINANCE[0]
      + rgba[pixel + 1] * LUMINANCE[1]
      + rgba[pixel + 2] * LUMINANCE[2];
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

function sobelGradientPlanes(source, width, height) {
  const horizontalPlane = new Float32Array(source.length);
  const verticalPlane = new Float32Array(source.length);
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
      const index = y * width + x;
      horizontalPlane[index] = horizontal;
      verticalPlane[index] = vertical;
    }
  }
  return { horizontal: horizontalPlane, vertical: verticalPlane };
}

function gradientMagnitude(horizontalPlane, verticalPlane) {
  const output = new Float32Array(horizontalPlane.length);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Math.sqrt(
      horizontalPlane[index] * horizontalPlane[index]
      + verticalPlane[index] * verticalPlane[index],
    );
  }
  return standardize(output);
}

export function sobelMagnitude(source, width, height) {
  const planes = sobelGradientPlanes(source, width, height);
  return gradientMagnitude(planes.horizontal, planes.vertical);
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
  const normalized = normalizeTransform(transform);
  const baseScale = Math.max(masterWidth / artWidth, masterHeight / artHeight);
  const scale = baseScale * normalized.zoom;
  const drawWidth = artWidth * scale;
  const drawHeight = artHeight * scale;
  const left = (masterWidth - drawWidth) / 2 + normalized.offsetX * masterWidth;
  const top = (masterHeight - drawHeight) / 2 + normalized.offsetY * masterHeight;
  return { baseScale, scale, drawWidth, drawHeight, left, top };
}

export function coverageDiagnostics(
  artWidth,
  artHeight,
  masterWidth,
  masterHeight,
  transform,
  config = MATCHER_CONFIG,
) {
  const geometry = coverGeometry(artWidth, artHeight, masterWidth, masterHeight, transform);
  const edgeClearancePx = {
    left: -geometry.left,
    top: -geometry.top,
    right: geometry.left + geometry.drawWidth - masterWidth,
    bottom: geometry.top + geometry.drawHeight - masterHeight,
  };
  const tolerancePx = Math.max(0, finiteOr(Number(config.coverage?.tolerancePx), EPSILON));
  const requiredOverscanPx = Math.max(0, finiteOr(Number(config.coverage?.fixedOverscanPx), 0));
  const minimumOverscanPx = Math.min(...Object.values(edgeClearancePx));
  const covered = Object.values(edgeClearancePx).every((value) => value >= -tolerancePx);
  return {
    covered,
    edgeClearancePx,
    minimumOverscanPx,
    requiredOverscanPx,
    overscanSatisfied: minimumOverscanPx >= requiredOverscanPx - tolerancePx,
    tolerancePx,
    geometry,
  };
}

export function coversMaster(artWidth, artHeight, masterWidth, masterHeight, transform) {
  return coverageDiagnostics(
    artWidth,
    artHeight,
    masterWidth,
    masterHeight,
    transform,
    { coverage: { tolerancePx: EPSILON, fixedOverscanPx: 0 } },
  ).covered;
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

function sampleArtworkPlane({ source, sourceWidth, sourceHeight, masterWidth, masterHeight, cardBox, transform, width, height }) {
  const geometry = coverGeometry(sourceWidth, sourceHeight, masterWidth, masterHeight, transform);
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
      const sample = sampleBilinear(source, sourceWidth, sourceHeight, sourceX, sourceY);
      if (sample === null) return null;
      output[y * width + x] = sample;
    }
  }
  return output;
}

export function sampleArtworkCard({ art, artWidth, artHeight, masterWidth, masterHeight, cardBox, transform, width, height }) {
  return sampleArtworkPlane({
    source: art,
    sourceWidth: artWidth,
    sourceHeight: artHeight,
    masterWidth,
    masterHeight,
    cardBox,
    transform,
    width,
    height,
  });
}

function valuesBetween(start, end, step) {
  const values = [];
  const safeStep = Math.abs(finiteOr(Number(step), 0));
  if (safeStep < EPSILON) return [Number(Number(start).toFixed(6))];
  for (let value = start, index = 0; value <= end + EPSILON && index < 10_000; value += safeStep, index += 1) {
    values.push(Number(Math.min(value, end).toFixed(6)));
  }
  if (!values.length || values[values.length - 1] < end - EPSILON) {
    values.push(Number(end.toFixed(6)));
  }
  return values;
}

function transformKey(transform) {
  return `${transform.zoom.toFixed(6)}:${transform.offsetX.toFixed(6)}:${transform.offsetY.toFixed(6)}`;
}

function mergeConfig(config = MATCHER_CONFIG) {
  return {
    ...MATCHER_CONFIG,
    ...config,
    comparison: {
      ...MATCHER_CONFIG.comparison,
      ...(config.comparison || {}),
      levels: config.comparison?.levels || MATCHER_CONFIG.comparison.levels,
    },
    search: {
      ...MATCHER_CONFIG.search,
      ...(config.search || {}),
      zoom: { ...MATCHER_CONFIG.search.zoom, ...(config.search?.zoom || {}) },
      offset: { ...MATCHER_CONFIG.search.offset, ...(config.search?.offset || {}) },
      refinement: { ...MATCHER_CONFIG.search.refinement, ...(config.search?.refinement || {}) },
    },
    scoring: { ...MATCHER_CONFIG.scoring, ...(config.scoring || {}) },
    features: {
      ...MATCHER_CONFIG.features,
      ...(config.features || {}),
      roiGrid: { ...MATCHER_CONFIG.features.roiGrid, ...(config.features?.roiGrid || {}) },
      pyramidScales: config.features?.pyramidScales || MATCHER_CONFIG.features.pyramidScales,
    },
    coverage: { ...MATCHER_CONFIG.coverage, ...(config.coverage || {}) },
  };
}

function comparisonLevels(comparisonHeight, cardAspect, config) {
  const requestedHeight = Math.max(1, Math.round(finiteOr(Number(comparisonHeight), 240)));
  return config.comparison.levels.map((definition, index) => {
    const scale = Math.max(EPSILON, finiteOr(Number(definition.scale), 1));
    const height = Math.max(config.comparison.minHeight, Math.round(requestedHeight * scale));
    const width = Math.max(config.comparison.minWidth, Math.round(height * cardAspect));
    return {
      index,
      id: definition.id || `level-${index + 1}`,
      scale,
      width,
      height,
    };
  });
}

function regionGrid(width, height, config) {
  const columns = Math.max(1, Math.floor(finiteOr(Number(config.regionGrid?.columns), 3)));
  const rows = Math.max(1, Math.floor(finiteOr(Number(config.regionGrid?.rows), 3)));
  const border = clamp(
    finiteOr(Number(config.borderExclusion), finiteOr(Number(config.borderExclusionFraction), 0.03)),
    0,
    0.25,
  );
  const innerLeft = width * border;
  const innerTop = height * border;
  const innerWidth = width * (1 - border * 2);
  const innerHeight = height * (1 - border * 2);
  const regions = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = Math.max(0, Math.ceil(innerLeft + (column / columns) * innerWidth));
      const x1 = Math.min(width, Math.ceil(innerLeft + ((column + 1) / columns) * innerWidth));
      const y0 = Math.max(0, Math.ceil(innerTop + (row / rows) * innerHeight));
      const y1 = Math.min(height, Math.ceil(innerTop + ((row + 1) / rows) * innerHeight));
      regions.push({
        id: `r${row}c${column}`,
        row,
        column,
        weight: 1,
        normalizedBounds: [
          border + ((1 - border * 2) * column) / columns,
          border + ((1 - border * 2) * row) / rows,
          border + ((1 - border * 2) * (column + 1)) / columns,
          border + ((1 - border * 2) * (row + 1)) / rows,
        ],
        pixelBounds: [x0, y0, Math.max(x0 + 1, x1), Math.max(y0 + 1, y1)],
      });
    }
  }
  return {
    columns,
    rows,
    borderExclusion: border,
    innerPixelBounds: [
      Math.min(width - 1, Math.ceil(innerLeft)),
      Math.min(height - 1, Math.ceil(innerTop)),
      Math.max(1, Math.floor(innerLeft + innerWidth)),
      Math.max(1, Math.floor(innerTop + innerHeight)),
    ],
    regions,
  };
}

function regionCorrelation(left, right, width, pixelBounds) {
  const [x0, y0, x1, y1] = pixelBounds;
  const count = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  if (count < 2) return 0;
  let leftMean = 0;
  let rightMean = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = y * width + x;
      leftMean += left[index];
      rightMean += right[index];
    }
  }
  leftMean /= count;
  rightMean /= count;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = y * width + x;
      leftVariance += (left[index] - leftMean) ** 2;
      rightVariance += (right[index] - rightMean) ** 2;
    }
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  if (denominator < EPSILON) return 0;
  let numerator = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = y * width + x;
      numerator += (left[index] - leftMean) * (right[index] - rightMean);
    }
  }
  return clamp(numerator / denominator, -1, 1);
}

function scoreRegions(candidateTone, candidateEdges, level, config) {
  const edgeWeight = Math.max(0, finiteOr(Number(config.scoring.edgeWeight), 0.7));
  const toneWeight = Math.max(0, finiteOr(Number(config.scoring.toneWeight), 0.3));
  const featureWeight = Math.max(EPSILON, edgeWeight + toneWeight);
  const supportThreshold = finiteOr(Number(config.scoring.regionSupportThreshold), 0.62);
  const regionResults = level.regions.regions.map((region) => {
    const toneScore = regionCorrelation(candidateTone, level.cardTone, level.width, region.pixelBounds);
    const edgeScore = regionCorrelation(candidateEdges, level.cardEdges, level.width, region.pixelBounds);
    const score = clamp((edgeScore * edgeWeight + toneScore * toneWeight) / featureWeight, -1, 1);
    return {
      id: region.id,
      row: region.row,
      column: region.column,
      weight: region.weight,
      normalizedBounds: [...region.normalizedBounds],
      pixelBounds: [...region.pixelBounds],
      toneScore,
      edgeScore,
      score,
      supported: score >= supportThreshold,
    };
  });
  let weightedScore = 0;
  let weightTotal = 0;
  for (const region of regionResults) {
    weightedScore += region.score * region.weight;
    weightTotal += region.weight;
  }
  const supported = regionResults.filter((region) => region.supported);
  const supportedRows = [...new Set(supported.map((region) => region.row))].sort((a, b) => a - b);
  const supportedColumns = [...new Set(supported.map((region) => region.column))].sort((a, b) => a - b);
  const supportFraction = supported.length / Math.max(1, regionResults.length);
  const pooledToneScore = regionCorrelation(
    candidateTone,
    level.cardTone,
    level.width,
    level.regions.innerPixelBounds,
  );
  const pooledEdgeScore = regionCorrelation(
    candidateEdges,
    level.cardEdges,
    level.width,
    level.regions.innerPixelBounds,
  );
  const pooledScore = clamp(
    (pooledEdgeScore * edgeWeight + pooledToneScore * toneWeight) / featureWeight,
    -1,
    1,
  );
  const regionalScore = weightedScore / Math.max(EPSILON, weightTotal);
  const pooledWeight = clamp(finiteOr(Number(config.scoring.pooledWeight), 0.65), 0, 1);
  const regionalWeight = clamp(finiteOr(Number(config.scoring.regionalWeight), 0.35), 0, 1);
  const aggregateWeight = Math.max(EPSILON, pooledWeight + regionalWeight);
  const crossRegionSupport = supported.length >= config.scoring.minimumSupportedRegions
    && supportFraction >= config.scoring.minimumSupportFraction
    && supportedRows.length >= config.scoring.minimumSupportedRows
    && supportedColumns.length >= config.scoring.minimumSupportedColumns;
  return {
    score: clamp((pooledScore * pooledWeight + regionalScore * regionalWeight) / aggregateWeight, -1, 1),
    pooledToneScore,
    pooledEdgeScore,
    pooledScore,
    regionalScore: clamp(regionalScore, -1, 1),
    regionScores: regionResults.map((region) => region.score),
    regionSupport: regionResults.map((region) => region.supported),
    regions: regionResults,
    supportedRegionCount: supported.length,
    supportFraction,
    supportedRows,
    supportedColumns,
    crossRegionSupport,
  };
}

function buildLevel(card, cardWidth, cardHeight, level, cardBox, masterWidth, masterHeight, config) {
  const cardTone = resizeGray(card, cardWidth, cardHeight, level.width, level.height);
  return {
    ...level,
    cardTone,
    cardEdges: sobelMagnitude(cardTone, level.width, level.height),
    regions: regionGrid(level.width, level.height, config),
    cardBox,
    masterWidth,
    masterHeight,
  };
}

function scoreCandidateAtLevel(input, level, transform, config) {
  const coverage = coverageDiagnostics(
    input.artWidth,
    input.artHeight,
    input.masterWidth,
    input.masterHeight,
    transform,
    config,
  );
  if (!coverage.covered) {
    return { valid: false, score: -1, coverage, reason: "artwork does not cover the master" };
  }
  const candidateTone = sampleArtworkPlane({
    source: input.art,
    sourceWidth: input.artWidth,
    sourceHeight: input.artHeight,
    masterWidth: input.masterWidth,
    masterHeight: input.masterHeight,
    cardBox: input.cardBox,
    transform,
    width: level.width,
    height: level.height,
  });
  const candidateHorizontal = sampleArtworkPlane({
    source: input.artGradient.horizontal,
    sourceWidth: input.artWidth,
    sourceHeight: input.artHeight,
    masterWidth: input.masterWidth,
    masterHeight: input.masterHeight,
    cardBox: input.cardBox,
    transform,
    width: level.width,
    height: level.height,
  });
  const candidateVertical = sampleArtworkPlane({
    source: input.artGradient.vertical,
    sourceWidth: input.artWidth,
    sourceHeight: input.artHeight,
    masterWidth: input.masterWidth,
    masterHeight: input.masterHeight,
    cardBox: input.cardBox,
    transform,
    width: level.width,
    height: level.height,
  });
  if (!candidateTone || !candidateHorizontal || !candidateVertical) {
    return { valid: false, score: -1, coverage, reason: "comparison sample falls outside the artwork" };
  }
  const candidateEdges = gradientMagnitude(candidateHorizontal, candidateVertical);
  return {
    valid: true,
    coverage,
    ...scoreRegions(candidateTone, candidateEdges, level, config),
  };
}

function rankRecords(records, levelIndex) {
  return [...records]
    .filter((record) => record.levels[levelIndex]?.valid)
    .sort((left, right) => {
      const scoreDelta = right.levels[levelIndex].score - left.levels[levelIndex].score;
      if (Math.abs(scoreDelta) > EPSILON) return scoreDelta;
      return transformKey(left.transform).localeCompare(transformKey(right.transform));
    });
}

function refinementValues(seed, config) {
  const zoomSearch = config.search.zoom;
  const offsetSearch = config.search.offset;
  const refinement = config.search.refinement;
  return {
    zooms: valuesBetween(
      Math.max(zoomSearch.min, seed.zoom - refinement.zoomRadius),
      Math.min(zoomSearch.max, seed.zoom + refinement.zoomRadius),
      refinement.zoomStep,
    ),
    offsetsX: valuesBetween(
      Math.max(offsetSearch.min, seed.offsetX - refinement.offsetRadius),
      Math.min(offsetSearch.max, seed.offsetX + refinement.offsetRadius),
      refinement.offsetStep,
    ),
    offsetsY: valuesBetween(
      Math.max(offsetSearch.min, seed.offsetY - refinement.offsetRadius),
      Math.min(offsetSearch.max, seed.offsetY + refinement.offsetRadius),
      refinement.offsetStep,
    ),
  };
}

function levelDiagnostics(levels, record) {
  return levels.map((level, index) => {
    const evidence = record?.levels[index];
    return {
      id: level.id,
      index: level.index,
      scale: level.scale,
      width: level.width,
      height: level.height,
      score: evidence?.valid ? evidence.score : null,
      supportedRegionCount: evidence?.valid ? evidence.supportedRegionCount : 0,
      supportFraction: evidence?.valid ? evidence.supportFraction : 0,
      crossRegionSupport: Boolean(evidence?.valid && evidence.crossRegionSupport),
    };
  });
}

function failureReasons({ scoreGate, marginGate, supportGate, levelGate, periodicityGate, coverageGate, bestEvidence }) {
  const reasons = [];
  if (!scoreGate) reasons.push("best aggregate score is below the acceptance gate");
  if (!marginGate) reasons.push("best-versus-second margin is ambiguous");
  if (!supportGate) reasons.push("card evidence does not support enough independent regions");
  if (!levelGate) reasons.push("the match is not stable across comparison levels");
  if (!periodicityGate) reasons.push("the reference texture is too periodic");
  if (!coverageGate) reasons.push("the artwork leaves part of the master uncovered");
  if (!reasons.length && !bestEvidence) reasons.push("no valid comparison candidate was produced");
  return reasons;
}

export function searchCorrelationTransforms({
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
  config = MATCHER_CONFIG,
  onProgress,
  shouldCancel,
}) {
  const startedAt = Date.now();
  const matcherConfig = mergeConfig(config);
  const normalizedBaseline = normalizeTransform(baseline);
  const cardBoxWidth = Math.max(EPSILON, (cardBox[2] - cardBox[0]) * masterWidth);
  const cardBoxHeight = Math.max(EPSILON, (cardBox[3] - cardBox[1]) * masterHeight);
  const cardAspect = cardBoxWidth / cardBoxHeight;
  const levels = comparisonLevels(comparisonHeight, cardAspect, matcherConfig);
  const preparedLevels = levels.map((level) => buildLevel(
    card,
    cardWidth,
    cardHeight,
    level,
    cardBox,
    masterWidth,
    masterHeight,
    matcherConfig,
  ));
  const input = {
    art,
    artWidth,
    artHeight,
    artGradient: sobelGradientPlanes(art, artWidth, artHeight),
    masterWidth,
    masterHeight,
    cardBox,
  };
  const fineLevel = preparedLevels[preparedLevels.length - 1];
  const cardPeriodicity = periodicityScore(fineLevel.cardTone, fineLevel.width, fineLevel.height);
  const records = new Map();
  let candidateEvaluations = 0;
  let coverageRejected = 0;

  function evaluateCandidate(transform, levelIndex) {
    const normalized = {
      zoom: Number(finiteOr(Number(transform.zoom), 1).toFixed(6)),
      offsetX: Number(finiteOr(Number(transform.offsetX), 0).toFixed(6)),
      offsetY: Number(finiteOr(Number(transform.offsetY), 0).toFixed(6)),
    };
    const key = transformKey(normalized);
    let record = records.get(key);
    if (!record) {
      record = { transform: normalized, levels: Array(preparedLevels.length), coverage: null };
      records.set(key, record);
    }
    if (record.levels[levelIndex] !== undefined) return record;
    const evidence = scoreCandidateAtLevel(input, preparedLevels[levelIndex], normalized, matcherConfig);
    record.levels[levelIndex] = evidence;
    record.coverage = record.coverage || evidence.coverage;
    candidateEvaluations += 1;
    if (!evidence.valid && levelIndex === 0) coverageRejected += 1;
    return record;
  }

  function emitProgress(stage, completed, total, start, span) {
    if (shouldCancel?.()) {
      const error = new Error("Cancellation requested by the caller.");
      error.name = "AbortError";
      throw error;
    }
    onProgress?.({
      stage,
      completedWork: completed,
      totalWork: total,
      progress: start + (completed / Math.max(1, total)) * span,
    });
  }

  const zoomValues = valuesBetween(
    matcherConfig.search.zoom.min,
    matcherConfig.search.zoom.max,
    matcherConfig.search.zoom.step,
  );
  const offsetValues = valuesBetween(
    matcherConfig.search.offset.min,
    matcherConfig.search.offset.max,
    matcherConfig.search.offset.step,
  );
  const coarseTotal = zoomValues.length * offsetValues.length * offsetValues.length;
  let coarseCompleted = 0;
  for (const zoom of zoomValues) {
    for (const offsetY of offsetValues) {
      for (const offsetX of offsetValues) {
        if ((coarseCompleted & 0x0f) === 0 && shouldCancel?.()) {
          const error = new Error("Cancellation requested by the caller.");
          error.name = "AbortError";
          throw error;
        }
        evaluateCandidate({ zoom, offsetX, offsetY }, 0);
        coarseCompleted += 1;
        if (coarseCompleted % 8 === 0 || coarseCompleted === coarseTotal) {
          emitProgress("Matching coarse transforms", coarseCompleted, coarseTotal, 25, 20);
        }
      }
    }
  }

  const topCandidates = Math.max(1, Math.floor(matcherConfig.search.refinement.topCandidates));
  let seeds = rankRecords(records.values(), 0).slice(0, topCandidates);
  let refinementEvaluations = 0;
  for (let levelIndex = 1; levelIndex < preparedLevels.length; levelIndex += 1) {
    const candidates = seeds.flatMap((seed) => {
      const values = refinementValues(seed.transform, matcherConfig);
      const transforms = [];
      for (const zoom of values.zooms) {
        for (const offsetY of values.offsetsY) {
          for (const offsetX of values.offsetsX) {
            transforms.push({ zoom, offsetX, offsetY });
          }
        }
      }
      return transforms;
    });
    const total = Math.max(1, candidates.length);
    let completed = 0;
      for (const transform of candidates) {
        if ((completed & 0x0f) === 0 && shouldCancel?.()) {
          const error = new Error("Cancellation requested by the caller.");
          error.name = "AbortError";
          throw error;
        }
        evaluateCandidate(transform, levelIndex);
      completed += 1;
      refinementEvaluations += 1;
      if (completed % 10 === 0 || completed === total) {
        emitProgress(
          levelIndex === preparedLevels.length - 1 ? "Refining top candidates" : "Comparing pyramid level",
          completed,
          total,
          45 + (levelIndex - 1) * (45 / Math.max(1, preparedLevels.length - 1)),
          45 / Math.max(1, preparedLevels.length - 1),
        );
      }
    }
    seeds = rankRecords(records.values(), levelIndex).slice(0, topCandidates);
  }

  let finalCandidates = rankRecords(records.values(), preparedLevels.length - 1);
  let bestRecord = finalCandidates[0] || null;
  let secondRecord = finalCandidates[1] || null;
  // The winning transforms are cheap to rescore at every level and this gives
  // the result an explicit multi-scale stability diagnostic without rerunning
  // Sobel for every candidate.
  for (const record of [bestRecord, secondRecord]) {
    if (!record) continue;
    for (let levelIndex = 0; levelIndex < preparedLevels.length; levelIndex += 1) {
      evaluateCandidate(record.transform, levelIndex);
    }
  }
  finalCandidates = rankRecords(records.values(), preparedLevels.length - 1);
  bestRecord = finalCandidates[0] || null;
  secondRecord = finalCandidates[1] || null;

  const fallbackCoverage = coverageDiagnostics(
    artWidth,
    artHeight,
    masterWidth,
    masterHeight,
    normalizedBaseline,
    matcherConfig,
  );
  const bestTransform = bestRecord?.transform || normalizedBaseline;
  const secondTransform = secondRecord?.transform || null;
  const bestEvidence = bestRecord?.levels[preparedLevels.length - 1]?.valid
    ? bestRecord.levels[preparedLevels.length - 1]
    : null;
  const secondEvidence = secondRecord?.levels[preparedLevels.length - 1]?.valid
    ? secondRecord.levels[preparedLevels.length - 1]
    : null;
  const bestScore = bestEvidence?.score ?? 0;
  const secondScore = secondEvidence?.score ?? 0;
  const scoreMargin = bestScore - secondScore;
  const bestCoverage = bestRecord?.coverage || fallbackCoverage;
  const bestLevelEvidence = bestRecord
    ? bestRecord.levels
    : preparedLevels.map((level) => scoreCandidateAtLevel(input, level, normalizedBaseline, matcherConfig));
  const supportedEvidenceLevels = bestLevelEvidence.filter((evidence) => (
    evidence?.valid && evidence.score >= matcherConfig.scoring.minimumEvidenceScore
  )).length;
  const scoreGate = bestScore >= matcherConfig.scoring.minimumScore;
  const marginGate = scoreMargin >= matcherConfig.scoring.minimumMargin;
  const supportGate = Boolean(bestEvidence?.crossRegionSupport);
  const levelGate = supportedEvidenceLevels >= matcherConfig.scoring.minimumEvidenceLevels;
  const repeatedPattern = cardPeriodicity >= matcherConfig.scoring.maximumPeriodicity;
  const periodicityGate = !repeatedPattern;
  const coverageGate = Boolean(bestCoverage?.covered);
  const reasons = failureReasons({
    scoreGate,
    marginGate,
    supportGate,
    levelGate,
    periodicityGate,
    coverageGate,
    bestEvidence,
  });
  const accepted = scoreGate
    && marginGate
    && supportGate
    && levelGate
    && periodicityGate
    && coverageGate;
  const status = accepted ? "MATCH_APPLIED" : "MATCH_UNCERTAIN";
  const legacyStatus = accepted ? "MATCHED" : "NO_RELIABLE_MATCH";
  const gates = {
    ...MATCH_GATES,
    regionSupportThreshold: matcherConfig.scoring.regionSupportThreshold,
    minimumSupportedRegions: matcherConfig.scoring.minimumSupportedRegions,
    minimumSupportFraction: matcherConfig.scoring.minimumSupportFraction,
    minimumSupportedRows: matcherConfig.scoring.minimumSupportedRows,
    minimumSupportedColumns: matcherConfig.scoring.minimumSupportedColumns,
    minimumEvidenceLevels: matcherConfig.scoring.minimumEvidenceLevels,
    minimumEvidenceScore: matcherConfig.scoring.minimumEvidenceScore,
    maximumPeriodicity: matcherConfig.scoring.maximumPeriodicity,
    score: scoreGate,
    margin: marginGate,
    regions: supportGate,
    levels: levelGate,
    periodicity: periodicityGate,
    coverage: coverageGate,
    passed: accepted,
  };
  onProgress?.({ stage: "Preparing match result", completedWork: 1, totalWork: 1, progress: 100 });
  return {
    matcherVersion: MATCHER_VERSION,
    configVersion: matcherConfig.version || MATCHER_CONFIG_VERSION,
    status,
    legacyStatus,
    accepted,
    zoom: accepted ? bestTransform.zoom : normalizedBaseline.zoom,
    offsetX: accepted ? bestTransform.offsetX : normalizedBaseline.offsetX,
    offsetY: accepted ? bestTransform.offsetY : normalizedBaseline.offsetY,
    bestScore,
    secondScore,
    scoreMargin,
    regionScores: bestEvidence?.regionScores || [],
    regionSupport: bestEvidence?.regionSupport || [],
    regions: bestEvidence?.regions || [],
    pooledToneScore: bestEvidence?.pooledToneScore ?? 0,
    pooledEdgeScore: bestEvidence?.pooledEdgeScore ?? 0,
    pooledScore: bestEvidence?.pooledScore ?? 0,
    regionalScore: bestEvidence?.regionalScore ?? 0,
    supportedRegionCount: bestEvidence?.supportedRegionCount || 0,
    supportFraction: bestEvidence?.supportFraction || 0,
    supportedRows: bestEvidence?.supportedRows || [],
    supportedColumns: bestEvidence?.supportedColumns || [],
    crossRegionSupport: supportGate,
    coverage: bestCoverage,
    coverageDiagnostics: bestCoverage,
    periodicityScore: cardPeriodicity,
    repeatedPattern,
    comparisonSize: [fineLevel.width, fineLevel.height],
    comparisonLevels: levelDiagnostics(preparedLevels, bestRecord),
    supportedEvidenceLevels,
    elapsedMs: Date.now() - startedAt,
    candidateCount: records.size,
    validCandidateCount: finalCandidates.length,
    candidateEvaluations,
    refinementEvaluations,
    coverageRejected,
    bestCandidate: { ...bestTransform, score: bestScore },
    secondCandidate: secondTransform ? { ...secondTransform, score: secondScore } : null,
    reason: accepted
      ? "Aggregate card evidence passed the score, margin, coverage, and ambiguity gates."
      : reasons.join("; ") || "No reliable automatic match was produced.",
    gates,
  };
}

function copyBox(box) {
  if (!box) return null;
  return {
    left: box.left,
    top: box.top,
    right: box.right,
    bottom: box.bottom,
    width: box.width,
    height: box.height,
    centerX: box.centerX,
    centerY: box.centerY,
  };
}

function scaleBox(box, scaleX, scaleY) {
  if (!box) return null;
  return {
    left: box.left * scaleX,
    top: box.top * scaleY,
    right: box.right * scaleX,
    bottom: box.bottom * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
    centerX: box.centerX * scaleX,
    centerY: box.centerY * scaleY,
  };
}

function normalizeBox(box, width, height) {
  if (!box || width <= 0 || height <= 0) return null;
  return {
    left: box.left / width,
    top: box.top / height,
    right: box.right / width,
    bottom: box.bottom / height,
    width: box.width / width,
    height: box.height / height,
    centerX: box.centerX / width,
    centerY: box.centerY / height,
  };
}

function scaleMargins(margins, scaleX, scaleY) {
  return {
    left: margins.left * scaleX,
    right: margins.right * scaleX,
    top: margins.top * scaleY,
    bottom: margins.bottom * scaleY,
    width: margins.width * scaleX,
    height: margins.height * scaleY,
  };
}

function overscanDiagnostics({
  coverage,
  estimatedCardBox,
  artWidth,
  artHeight,
  artSourceWidth,
  artSourceHeight,
  masterWidth,
  masterHeight,
}) {
  const geometry = coverage.geometry;
  const requiredBounds = {
    left: (0 - geometry.left) / geometry.scale,
    top: (0 - geometry.top) / geometry.scale,
    right: (masterWidth - geometry.left) / geometry.scale,
    bottom: (masterHeight - geometry.top) / geometry.scale,
  };
  const requiredMargins = {
    left: Math.max(0, estimatedCardBox.left - requiredBounds.left),
    right: Math.max(0, requiredBounds.right - estimatedCardBox.right),
    top: Math.max(0, estimatedCardBox.top - requiredBounds.top),
    bottom: Math.max(0, requiredBounds.bottom - estimatedCardBox.bottom),
    width: 0,
    height: 0,
  };
  const availableMargins = {
    left: Math.max(0, estimatedCardBox.left),
    right: Math.max(0, artWidth - estimatedCardBox.right),
    top: Math.max(0, estimatedCardBox.top),
    bottom: Math.max(0, artHeight - estimatedCardBox.bottom),
    width: 0,
    height: 0,
  };
  const shortfall = {
    left: Math.max(0, requiredMargins.left - availableMargins.left),
    right: Math.max(0, requiredMargins.right - availableMargins.right),
    top: Math.max(0, requiredMargins.top - availableMargins.top),
    bottom: Math.max(0, requiredMargins.bottom - availableMargins.bottom),
    width: 0,
    height: 0,
  };
  requiredMargins.width = requiredMargins.left + estimatedCardBox.width + requiredMargins.right;
  requiredMargins.height = requiredMargins.top + estimatedCardBox.height + requiredMargins.bottom;
  availableMargins.width = availableMargins.left + estimatedCardBox.width + availableMargins.right;
  availableMargins.height = availableMargins.top + estimatedCardBox.height + availableMargins.bottom;
  shortfall.width = shortfall.left + shortfall.right;
  shortfall.height = shortfall.top + shortfall.bottom;
  const sourceScaleX = finiteOr(artSourceWidth, artWidth) / artWidth;
  const sourceScaleY = finiteOr(artSourceHeight, artHeight) / artHeight;
  const sourceRequiredBounds = {
    left: requiredBounds.left * sourceScaleX,
    top: requiredBounds.top * sourceScaleY,
    right: requiredBounds.right * sourceScaleX,
    bottom: requiredBounds.bottom * sourceScaleY,
    width: (requiredBounds.right - requiredBounds.left) * sourceScaleX,
    height: (requiredBounds.bottom - requiredBounds.top) * sourceScaleY,
  };
  return {
    covered: coverage.covered,
    workingPx: {
      requiredCanvas: {
        width: requiredBounds.right - requiredBounds.left,
        height: requiredBounds.bottom - requiredBounds.top,
      },
      requiredSurroundingMargins: requiredMargins,
      availableSurroundingMargins: availableMargins,
      shortfall,
    },
    sourcePx: {
      requiredCanvas: { width: sourceRequiredBounds.width, height: sourceRequiredBounds.height },
      requiredBounds: sourceRequiredBounds,
      requiredSurroundingMargins: scaleMargins(requiredMargins, sourceScaleX, sourceScaleY),
      availableSurroundingMargins: scaleMargins(availableMargins, sourceScaleX, sourceScaleY),
      shortfall: scaleMargins(shortfall, sourceScaleX, sourceScaleY),
    },
  };
}

function overscanReason(overscan) {
  const shortfall = overscan?.sourcePx?.shortfall;
  if (!shortfall) return "Card artwork was found, but the image needs more surrounding artwork.";
  const parts = [
    ["left", shortfall.left],
    ["right", shortfall.right],
    ["top", shortfall.top],
    ["bottom", shortfall.bottom],
  ]
    .filter(([, value]) => value > 0.5)
    .map(([side, value]) => `${Math.ceil(value)} px ${side}`);
  const canvas = overscan.sourcePx.requiredCanvas;
  if (!parts.length) {
    return `Card artwork was found, but the image needs more surrounding artwork to reach about ${Math.ceil(canvas.width)} x ${Math.ceil(canvas.height)} px.`;
  }
  return `Card artwork was found, but the image needs more surrounding artwork. Extend it by at least ${parts.join(", ")} (about ${Math.ceil(canvas.width)} x ${Math.ceil(canvas.height)} px total).`;
}

function featureEvidenceItems({ accepted, rejectionClassification, overscan, repeatedPattern }) {
  if (accepted) {
    return ["Local card-art features passed deterministic RANSAC, compatibility, and coverage gates."];
  }
  if (rejectionClassification === "INSUFFICIENT_OVERSCAN") {
    return ["Card artwork was found, but the image needs more surrounding artwork.", overscanReason(overscan)];
  }
  if (rejectionClassification === "ROTATION_BEYOND_RENDERER_CONTRACT") {
    return ["Card artwork was found, but its rotation exceeds the zoom-and-translation renderer tolerance."];
  }
  if (["PERSPECTIVE_BEYOND_RENDERER_CONTRACT", "AFFINE_BEYOND_RENDERER_CONTRACT"].includes(rejectionClassification)) {
    return ["Card artwork was found, but perspective or non-uniform distortion exceeds the zoom-and-translation renderer contract."];
  }
  if (repeatedPattern) return ["The reference texture was too repetitive to distinguish uniquely."];
  return ["The matcher did not find enough distinct local feature evidence for an automatic apply."];
}

function featureResult({
  feature,
  artWidth,
  artHeight,
  artSourceWidth = artWidth,
  artSourceHeight = artHeight,
  cardWidth,
  cardHeight,
  masterWidth,
  masterHeight,
  cardBox,
  baseline,
  matcherConfig,
  periodicity,
}) {
  if (!feature?.correspondenceFound) return null;
  const baselineTransform = normalizeTransform(baseline);
  const featureConfig = matcherConfig.features;
  const estimatedCardBox = feature.estimatedCardBox;
  const similarity = feature.similarity;
  const periodicityGate = periodicity < matcherConfig.scoring.maximumPeriodicity;
  const repeatedPattern = !periodicityGate;
  let rejectionClassification = feature.compatibility?.rejectionReason || null;
  let requiredTransform = null;
  let coverage = null;
  let overscan = null;
  let aspectMismatch = null;

  if (similarity && estimatedCardBox) {
    const targetWidth = (cardBox[2] - cardBox[0]) * masterWidth;
    const targetHeight = (cardBox[3] - cardBox[1]) * masterHeight;
    const requiredScaleX = targetWidth / Math.max(EPSILON, similarity.scale * cardWidth);
    const requiredScaleY = targetHeight / Math.max(EPSILON, similarity.scale * cardHeight);
    aspectMismatch = Math.abs(requiredScaleX - requiredScaleY) / Math.max(EPSILON, (requiredScaleX + requiredScaleY) / 2);
    if (!rejectionClassification && aspectMismatch > featureConfig.maximumScaleMismatch) {
      rejectionClassification = "ASPECT_RATIO_BEYOND_RENDERER_CONTRACT";
    }
    const scale = (requiredScaleX + requiredScaleY) / 2;
    const cardCenterX = (cardBox[0] + cardBox[2]) * masterWidth / 2;
    const cardCenterY = (cardBox[1] + cardBox[3]) * masterHeight / 2;
    const left = cardCenterX - estimatedCardBox.centerX * scale;
    const top = cardCenterY - estimatedCardBox.centerY * scale;
    const baseScale = Math.max(masterWidth / artWidth, masterHeight / artHeight);
    requiredTransform = {
      zoom: scale / baseScale,
      offsetX: (left - (masterWidth - artWidth * scale) / 2) / masterWidth,
      offsetY: (top - (masterHeight - artHeight * scale) / 2) / masterHeight,
    };
    coverage = coverageDiagnostics(artWidth, artHeight, masterWidth, masterHeight, requiredTransform, matcherConfig);
    overscan = overscanDiagnostics({
      coverage,
      estimatedCardBox,
      artWidth,
      artHeight,
      artSourceWidth,
      artSourceHeight,
      masterWidth,
      masterHeight,
    });
  }

  const featureEvidenceGate = Boolean(feature.confidenceGates?.passed);
  const compatibilityGate = !rejectionClassification && similarity && estimatedCardBox && requiredTransform;
  const coverageGate = Boolean(coverage?.covered);
  if (!rejectionClassification && featureEvidenceGate && periodicityGate && compatibilityGate && !coverageGate) {
    rejectionClassification = "INSUFFICIENT_OVERSCAN";
  }
  const accepted = featureEvidenceGate && periodicityGate && compatibilityGate && coverageGate;
  const status = accepted ? "MATCH_APPLIED" : "MATCH_UNCERTAIN";
  const sourceScaleX = finiteOr(artSourceWidth, artWidth) / artWidth;
  const sourceScaleY = finiteOr(artSourceHeight, artHeight) / artHeight;
  const sourceEstimatedCardBox = scaleBox(estimatedCardBox, sourceScaleX, sourceScaleY);
  const estimatedArtCardBox = {
    workingPx: copyBox(estimatedCardBox),
    sourcePx: sourceEstimatedCardBox,
    normalized: {
      working: normalizeBox(estimatedCardBox, artWidth, artHeight),
      source: normalizeBox(sourceEstimatedCardBox, artSourceWidth, artSourceHeight),
    },
  };
  const similarityDiagnostics = feature.similarity && {
    ...feature.similarity,
    residual: {
      medianPx: feature.inliers?.medianResidualPx ?? null,
      thresholdPx: feature.inliers?.thresholdPx ?? null,
    },
  };
  const diagnostics = {
    strategy: feature.strategy,
    version: feature.version,
    keypoints: feature.keypoints,
    descriptors: feature.descriptors,
    candidateMatches: feature.candidateMatches,
    inliers: feature.inliers,
    inlierRatio: feature.inliers?.ratio ?? 0,
    similarity: similarityDiagnostics,
    homography: feature.homography,
    estimatedArtCardBox,
    requiredTransform,
    overscan,
    compatibility: {
      ...(feature.compatibility || {}),
      compatible: Boolean(compatibilityGate),
      aspectMismatch,
      rejectionReason: rejectionClassification,
    },
    rejectionClassification,
    confidenceGates: {
      ...(feature.confidenceGates || {}),
      periodicity: periodicityGate,
      compatibility: Boolean(compatibilityGate),
      coverage: coverageGate,
      passed: accepted,
    },
  };
  const evidence = featureEvidenceItems({
    accepted,
    rejectionClassification,
    overscan,
    repeatedPattern,
  });
  const reason = accepted
    ? "Local feature correspondence passed deterministic RANSAC, renderer compatibility, and coverage gates."
    : rejectionClassification === "INSUFFICIENT_OVERSCAN"
      ? overscanReason(overscan)
      : rejectionClassification === "ROTATION_BEYOND_RENDERER_CONTRACT"
        ? "Card artwork was found with rotation beyond the renderer's zoom-and-translation tolerance."
        : ["PERSPECTIVE_BEYOND_RENDERER_CONTRACT", "AFFINE_BEYOND_RENDERER_CONTRACT", "ASPECT_RATIO_BEYOND_RENDERER_CONTRACT"].includes(rejectionClassification)
          ? "Card artwork was found, but its geometric distortion is incompatible with the zoom-and-translation renderer."
          : repeatedPattern
            ? "The reference texture is too periodic for a unique automatic local-feature match."
            : "Local feature evidence did not clear the automatic apply gates.";
  return {
    matcherVersion: MATCHER_VERSION,
    configVersion: matcherConfig.version || MATCHER_CONFIG_VERSION,
    strategy: feature.strategy,
    status,
    legacyStatus: accepted ? "MATCHED" : "NO_RELIABLE_MATCH",
    accepted,
    autoApplied: accepted,
    zoom: accepted ? requiredTransform.zoom : baselineTransform.zoom,
    offsetX: accepted ? requiredTransform.offsetX : baselineTransform.offsetX,
    offsetY: accepted ? requiredTransform.offsetY : baselineTransform.offsetY,
    requiredTransform,
    bestScore: null,
    secondScore: null,
    scoreMargin: null,
    candidateCount: feature.candidateMatches?.crossCheckedCount || 0,
    validCandidateCount: feature.inliers?.count || 0,
    estimatedCardBox: estimatedArtCardBox,
    similarity: similarityDiagnostics,
    periodicityScore: periodicity,
    repeatedPattern,
    coverage,
    coverageDiagnostics: coverage,
    overscan,
    compatibility: diagnostics.compatibility,
    rejectionClassification,
    diagnostics,
    evidence,
    reason,
    elapsedMs: feature.elapsedMs,
    gates: {
      ...MATCH_GATES,
      localFeatures: featureEvidenceGate,
      periodicity: periodicityGate,
      compatibility: Boolean(compatibilityGate),
      coverage: coverageGate,
      passed: accepted,
    },
  };
}

function featurePeriodicity(card, cardWidth, cardHeight) {
  if (!card || !cardWidth || !cardHeight) return 0;
  const targetHeight = Math.max(36, Math.min(140, Math.round(cardHeight)));
  const targetWidth = Math.max(28, Math.round(targetHeight * cardWidth / cardHeight));
  const resized = resizeGray(card, cardWidth, cardHeight, targetWidth, targetHeight);
  return periodicityScore(resized, targetWidth, targetHeight);
}

// The v4 path deliberately tries local correspondence first. Correlation is
// still retained for weak feature evidence and legacy small synthetic inputs;
// it is never allowed to overwrite a strong feature finding that fails only
// because the renderer cannot cover the selected output.
export function searchTransforms(input = {}) {
  const matcherConfig = mergeConfig(input.config || MATCHER_CONFIG);
  const localFeatures = matchLocalFeatures({
    art: input.art,
    artWidth: input.artWidth,
    artHeight: input.artHeight,
    card: input.card,
    cardWidth: input.cardWidth,
    cardHeight: input.cardHeight,
    config: matcherConfig.features,
    shouldCancel: input.shouldCancel || input.isCancelled,
    onProgress: input.onProgress,
  });
  const periodicity = featurePeriodicity(input.card, input.cardWidth, input.cardHeight);
  const localResult = featureResult({
    ...input,
    matcherConfig,
    periodicity,
    feature: localFeatures,
  });
  if (localResult) {
    input.onProgress?.({ stage: "Preparing match result", completedWork: 1, totalWork: 1, progress: 100 });
    return localResult;
  }
  const fallback = searchCorrelationTransforms({
    ...input,
    config: matcherConfig,
    onProgress: (event = {}) => input.onProgress?.({
      ...event,
      progress: 65 + Math.max(0, Math.min(100, finiteOr(event.progress, 0))) * 0.35,
    }),
  });
  return {
    ...fallback,
    matcherVersion: MATCHER_VERSION,
    configVersion: matcherConfig.version || MATCHER_CONFIG_VERSION,
    strategy: "correlation-fallback",
    autoApplied: Boolean(fallback.accepted),
    featureDiagnostics: localFeatures,
    diagnostics: {
      strategy: "correlation-fallback",
      version: matcherConfig.version || MATCHER_CONFIG_VERSION,
      localFeatures,
    },
  };
}
