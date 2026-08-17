import { validateDecodedImage, validateFile } from "./quality.js";

function loadHtmlImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("This image could not be opened."));
    image.src = url;
  });
}

function cropCanvas(source, crop) {
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(crop.width, crop.height)
    : typeof document !== "undefined"
      ? Object.assign(document.createElement("canvas"), { width: crop.width, height: crop.height })
      : null;
  if (!canvas) throw new Error("This browser cannot prepare a cropped card reference.");
  const context = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" })
    || canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser cannot prepare a cropped card reference.");
  context.imageSmoothingEnabled = true;
  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return canvas;
}

async function prepareDecodedImage(image, kind, orientation) {
  const sourceQuality = validateDecodedImage(kind, image);
  const crop = kind === "card" ? sourceQuality.cropRect : null;
  if (!crop) return { image, ...sourceQuality, orientation };

  try {
    const canvas = cropCanvas(image, crop);
    let croppedImage = canvas;
    if (typeof createImageBitmap === "function") {
      try {
        croppedImage = await createImageBitmap(canvas);
      } catch {
        // The canvas remains a valid CanvasImageSource fallback.
      }
    }
    if (typeof image.close === "function") image.close();
    const croppedQuality = validateDecodedImage(kind, croppedImage);
    const cropMessage = `Card reference was automatically center-cropped from ${crop.sourceWidth} × ${crop.sourceHeight} px to ${crop.width} × ${crop.height} px before alignment.`;
    return {
      image: croppedImage,
      ...croppedQuality,
      warnings: [cropMessage, ...croppedQuality.warnings],
      autoCrop: crop,
      sourceDimensions: { width: crop.sourceWidth, height: crop.sourceHeight },
      orientation,
    };
  } catch {
    return {
      image,
      ...sourceQuality,
      warnings: [
        ...sourceQuality.warnings,
        "The card reference could not be auto-cropped; it remains available for manual alignment.",
      ],
      autoCrop: null,
      orientation,
    };
  }
}

export async function readImage(file, kind) {
  await validateFile(file);
  const url = URL.createObjectURL(file);
  try {
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        return prepareDecodedImage(bitmap, kind, "from-image");
      } catch (error) {
        if (error?.message?.includes("megapixel") || error?.message?.includes("dimensions") || error?.message?.includes("card")) throw error;
      }
    }
    const image = await loadHtmlImage(url);
    return prepareDecodedImage(image, kind, "browser-default");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function fileSummary(file, dimensions) {
  const megabytes = (file.size / 1024 / 1024).toFixed(1);
  return `${dimensions.width} × ${dimensions.height} px | ${megabytes} MB`;
}

export function replacePreviewUrl(previousUrl, file) {
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  return URL.createObjectURL(file);
}
