import { searchTransforms } from "./matcher-core.js";

const MAX_COMPARISON_LONGEST = 1200;
const TRANSPORT_VERSION = "alignment-worker-v4";
const MATCH_APPLIED = "MATCH_APPLIED";
const MATCH_UNCERTAIN = "MATCH_UNCERTAIN";
const TIMED_OUT = "TIMED_OUT";
const FAILED = "FAILED";
const CANCELLED = "CANCELLED";

let activeJobId = null;
let cancelRequested = false;
let cancelView = null;
let currentStageKey = "start";

function stageId(stageKey) {
  return `${TRANSPORT_VERSION}:${stageKey}`;
}

function normalizeStatus(value) {
  if (typeof value !== "string") return null;
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function resultTransportStatus(result) {
  const explicitStatus = [
    result?.resultStatus,
    result?.result_status,
    result?.transportStatus,
    result?.transport_status,
    result?.status,
  ].map(normalizeStatus).find(Boolean);
  if (explicitStatus === MATCH_APPLIED || explicitStatus === "MATCHED") return MATCH_APPLIED;
  if ([MATCH_UNCERTAIN, "NO_RELIABLE_MATCH", "UNCERTAIN"].includes(explicitStatus)) return MATCH_UNCERTAIN;
  if ([TIMED_OUT, FAILED, CANCELLED].includes(explicitStatus)) return explicitStatus;
  if (result?.accepted === true || result?.applied === true || result?.autoApplied === true) return MATCH_APPLIED;
  if (result?.accepted === false || result?.uncertain === true) return MATCH_UNCERTAIN;
  return null;
}

function matcherError(status, stageKey, reason) {
  const error = new Error(reason);
  error.status = status;
  error.stageKey = stageKey;
  error.stage = stageId(stageKey);
  error.reason = reason;
  return error;
}

function isCancellationBuffer(value) {
  return typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer;
}

function cancellationRequested() {
  if (cancelRequested) return true;
  if (!cancelView) return false;
  try {
    return Atomics.load(cancelView, 0) !== 0;
  } catch {
    return false;
  }
}

function throwIfCancelled(stageKey = currentStageKey) {
  if (cancellationRequested()) {
    throw matcherError(CANCELLED, stageKey, "Cancellation requested by the caller.");
  }
}

function imageDimensions(image) {
  return {
    width: Number(image?.width || image?.naturalWidth || 0),
    height: Number(image?.height || image?.naturalHeight || 0),
  };
}

function typedPixelData(image) {
  const candidate = image?.data
    ?? image?.pixels
    ?? image?.pixelData
    ?? image?.pixel_data
    ?? image?.pixelBuffer
    ?? image?.pixel_buffer;
  if (ArrayBuffer.isView?.(candidate)) return candidate;
  if (typeof ArrayBuffer !== "undefined" && candidate instanceof ArrayBuffer) return new Uint8Array(candidate);
  return null;
}

function pixelFormat(image, pixels, width, height) {
  const explicit = String(image?.pixelFormat || image?.pixel_format || image?.format || "").toLowerCase();
  if (explicit.includes("gray") || explicit.includes("luma") || Number(image?.channels) === 1) return "gray";
  if (explicit.includes("rgb") && !explicit.includes("rgba")) return "rgb";
  if (Number(image?.channels) === 3) return "rgb";
  if (pixels.length === width * height) return "gray";
  if (pixels.length === width * height * 3) return "rgb";
  return "rgba";
}

function grayscaleFromPixels(pixels, width, height, format) {
  const pixelCount = width * height;
  const gray = new Float32Array(pixelCount);
  const channels = format === "gray" ? 1 : format === "rgb" ? 3 : 4;
  if (pixels.length < pixelCount * channels) {
    throw matcherError(FAILED, currentStageKey, `The ${format} pixel buffer is shorter than ${width}x${height} pixels.`);
  }
  for (let index = 0; index < pixelCount; index += 1) {
    if ((index & 0x3fff) === 0) throwIfCancelled(currentStageKey);
    const pixel = index * channels;
    if (channels === 1) {
      gray[index] = Number(pixels[index]);
    } else {
      gray[index] = Number(pixels[pixel]) * 0.2126
        + Number(pixels[pixel + 1]) * 0.7152
        + Number(pixels[pixel + 2]) * 0.0722;
    }
  }
  throwIfCancelled(currentStageKey);
  return gray;
}

function resizeGray(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return source;
  const output = new Float32Array(targetWidth * targetHeight);
  const scaleX = sourceWidth / targetWidth;
  const scaleY = sourceHeight / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    if ((y & 0x1f) === 0) throwIfCancelled(currentStageKey);
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
  throwIfCancelled(currentStageKey);
  return output;
}

function rasterizePixelPayload(image) {
  const { width: sourceWidth, height: sourceHeight } = imageDimensions(image);
  const pixels = typedPixelData(image);
  if (!pixels || !sourceWidth || !sourceHeight) return null;
  currentStageKey = "rasterize";
  const gray = grayscaleFromPixels(pixels, sourceWidth, sourceHeight, pixelFormat(image, pixels, sourceWidth, sourceHeight));
  const scale = Math.min(1, MAX_COMPARISON_LONGEST / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return {
    gray: resizeGray(gray, sourceWidth, sourceHeight, width, height),
    width,
    height,
    sourceWidth: Number(image?.sourceWidth ?? image?.source_width ?? sourceWidth) || sourceWidth,
    sourceHeight: Number(image?.sourceHeight ?? image?.source_height ?? sourceHeight) || sourceHeight,
  };
}

function rasterizeBitmap(image) {
  const { width: sourceWidth, height: sourceHeight } = imageDimensions(image);
  if (!sourceWidth || !sourceHeight) {
    throw matcherError(FAILED, currentStageKey, "The matcher received an image without readable dimensions.");
  }
  if (typeof OffscreenCanvas === "undefined") {
    throw matcherError(
      FAILED,
      currentStageKey,
      "OffscreenCanvas is unavailable for bitmap input; provide an ImageData or typed RGBA pixel payload instead.",
    );
  }
  const scale = Math.min(1, MAX_COMPARISON_LONGEST / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" })
    || canvas.getContext("2d", { alpha: false });
  if (!context) throw matcherError(FAILED, currentStageKey, "The worker could not create a 2D rasterization context.");
  try {
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    return {
      gray: grayscaleFromPixels(pixels, width, height, "rgba"),
      width,
      height,
      sourceWidth,
      sourceHeight,
    };
  } finally {
    image.close?.();
  }
}

function rasterize(image) {
  const raw = rasterizePixelPayload(image);
  if (raw) return raw;
  return rasterizeBitmap(image);
}

function coreProgressStage(coreStage) {
  const label = String(coreStage || "Matching transforms");
  const normalized = label.toLowerCase();
  if (normalized.includes("feature") && normalized.includes("descriptor")) return { key: "feature-match", label };
  if (normalized.includes("robust")) return { key: "feature-ransac", label };
  if (normalized.includes("compatib")) return { key: "feature-coverage", label };
  if (normalized.includes("feature")) return { key: "features", label };
  if (normalized.includes("coarse")) return { key: "match-coarse", label };
  if (normalized.includes("refin")) return { key: "match-refine", label };
  if (normalized.includes("result")) return { key: "result", label };
  return { key: "match", label };
}

function progress(jobId, profileVersion, stageKey, label, completedWork, totalWork, value, detail) {
  currentStageKey = stageKey;
  throwIfCancelled(stageKey);
  self.postMessage({
    type: "progress",
    job_id: jobId,
    transport_version: TRANSPORT_VERSION,
    stage: stageId(stageKey),
    stage_key: stageKey,
    stage_version: TRANSPORT_VERSION,
    stage_label: label,
    completed_work: completedWork,
    total_work: totalWork,
    progress: value,
    profile_version: profileVersion,
    detail,
  });
}

function cancellationView(value) {
  if (!isCancellationBuffer(value)) return null;
  try {
    return new Int32Array(value);
  } catch {
    return null;
  }
}

function postFailure(jobId, profileVersion, error) {
  const status = error?.status || FAILED;
  const stageKey = error?.stageKey || currentStageKey || "error";
  const reason = error?.reason || error?.message || "The local matcher could not process these images.";
  const messageType = status === CANCELLED ? "cancelled" : "error";
  self.postMessage({
    type: messageType,
    job_id: jobId,
    transport_version: TRANSPORT_VERSION,
    status,
    stage: stageId(stageKey),
    stage_key: stageKey,
    stage_version: TRANSPORT_VERSION,
    completed_work: 0,
    total_work: 0,
    progress: 0,
    profile_version: profileVersion,
    reason,
    message: `${status} [${stageId(stageKey)}]: ${reason}`,
    last_stage: currentStageKey,
  });
}

async function runMatch(message) {
  const jobId = message.job_id;
  const profileVersion = message.profile_version || "phase2-profiles-1";
  currentStageKey = "start";
  progress(jobId, profileVersion, "prepare-art", "Preparing artwork pixels", 0, 1, 5);
  const art = rasterize(message.art_image);
  progress(jobId, profileVersion, "prepare-card", "Preparing card-reference pixels", 0, 1, 15);
  const card = rasterize(message.card_image);
  progress(jobId, profileVersion, "match", "Starting reference transform search", 0, 1, 25);
  const masterPixels = message.profile?.master_px;
  const cardBox = message.profile?.card_box;
  if (!Array.isArray(masterPixels) || masterPixels.length < 2 || !Array.isArray(cardBox) || cardBox.length < 4) {
    throw matcherError(FAILED, "match", "The worker received an incomplete profile geometry payload.");
  }
  const result = await searchTransforms({
    art: art.gray,
    artWidth: art.width,
    artHeight: art.height,
    artSourceWidth: art.sourceWidth,
    artSourceHeight: art.sourceHeight,
    card: card.gray,
    cardWidth: card.width,
    cardHeight: card.height,
    cardSourceWidth: card.sourceWidth,
    cardSourceHeight: card.sourceHeight,
    masterWidth: masterPixels[0],
    masterHeight: masterPixels[1],
    cardBox,
    baseline: message.baseline,
    // Current matcher-core ignores unknown options; upgraded cores can use either
    // spelling without requiring a transport rewrite.
    shouldCancel: cancellationRequested,
    isCancelled: cancellationRequested,
    onProgress: (eventValue = {}) => {
      const stage = coreProgressStage(eventValue.stage);
      progress(
        jobId,
        profileVersion,
        stage.key,
        stage.label,
        eventValue.completedWork,
        eventValue.totalWork,
        eventValue.progress,
        { coreStage: eventValue.stage },
      );
      throwIfCancelled(stage.key);
    },
  });
  throwIfCancelled("result");
  progress(jobId, profileVersion, "result", "Preparing match result", 1, 1, 100);
  self.postMessage({
    type: "complete",
    job_id: jobId,
    transport_version: TRANSPORT_VERSION,
    stage: stageId("result"),
    stage_key: "result",
    stage_version: TRANSPORT_VERSION,
    completed_work: 1,
    total_work: 1,
    progress: 100,
    profile_version: profileVersion,
    transport_status: resultTransportStatus(result),
    result,
  });
}

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type === "cancel") {
    if (message.job_id === activeJobId) {
      cancelRequested = true;
      if (cancelView) {
        try {
          Atomics.store(cancelView, 0, 1);
        } catch {
          // The local cancellation flag remains the fallback.
        }
      }
    }
    return;
  }
  if (message.type !== "match") return;
  const jobId = message.job_id;
  const profileVersion = message.profile_version || "phase2-profiles-1";
  if (activeJobId !== null && activeJobId !== jobId) {
    postFailure(jobId, profileVersion, matcherError(FAILED, "start", "The worker is already processing another matcher job."));
    return;
  }
  activeJobId = jobId;
  cancelRequested = false;
  cancelView = cancellationView(message.cancel_buffer);
  try {
    await runMatch(message);
  } catch (error) {
    postFailure(jobId, profileVersion, cancellationRequested() || error?.name === "AbortError"
      ? matcherError(CANCELLED, currentStageKey, "Cancellation requested by the caller.")
      : error);
  } finally {
    if (activeJobId === jobId) {
      activeJobId = null;
      cancelView = null;
      cancelRequested = false;
    }
  }
};
