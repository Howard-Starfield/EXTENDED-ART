import { rgbaToGray, searchTransforms } from "./matcher-core.js";

const MAX_COMPARISON_LONGEST = 1200;

function imageDimensions(image) {
  return {
    width: image?.width || image?.naturalWidth || 0,
    height: image?.height || image?.naturalHeight || 0,
  };
}

function rasterize(image) {
  const { width: sourceWidth, height: sourceHeight } = imageDimensions(image);
  if (!sourceWidth || !sourceHeight) throw new Error("The matcher received an image without readable dimensions.");
  const scale = Math.min(1, MAX_COMPARISON_LONGEST / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  image.close?.();
  return { gray: rgbaToGray(pixels, width, height), width, height };
}

function progress(jobId, profileVersion, stage, completedWork, totalWork, value) {
  self.postMessage({
    type: "progress",
    job_id: jobId,
    stage,
    completed_work: completedWork,
    total_work: totalWork,
    progress: value,
    profile_version: profileVersion,
  });
}

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type !== "match") return;
  const jobId = message.job_id;
  const profileVersion = message.profile_version || "phase2-profiles-1";
  try {
    progress(jobId, profileVersion, "Preparing comparison images", 0, 4, 8);
    const art = rasterize(message.art_image);
    progress(jobId, profileVersion, "Preparing comparison images", 1, 4, 16);
    const card = rasterize(message.card_image);
    progress(jobId, profileVersion, "Preparing comparison images", 2, 4, 24);
    const result = searchTransforms({
      art: art.gray,
      artWidth: art.width,
      artHeight: art.height,
      card: card.gray,
      cardWidth: card.width,
      cardHeight: card.height,
      masterWidth: message.profile.master_px[0],
      masterHeight: message.profile.master_px[1],
      cardBox: message.profile.card_box,
      baseline: message.baseline,
      onProgress: (eventValue) => progress(
        jobId,
        profileVersion,
        eventValue.stage,
        eventValue.completedWork,
        eventValue.totalWork,
        eventValue.progress,
      ),
    });
    self.postMessage({
      type: "complete",
      job_id: jobId,
      profile_version: profileVersion,
      result,
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      job_id: jobId,
      profile_version: profileVersion,
      message: error?.message || "The local matcher could not process these images.",
    });
  }
};
