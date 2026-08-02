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

export async function readImage(file, kind) {
  await validateFile(file);
  const url = URL.createObjectURL(file);
  try {
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        const quality = validateDecodedImage(kind, bitmap);
        return { image: bitmap, ...quality, orientation: "from-image" };
      } catch (error) {
        if (error?.message?.includes("megapixel") || error?.message?.includes("dimensions") || error?.message?.includes("card")) throw error;
      }
    }
    const image = await loadHtmlImage(url);
    const quality = validateDecodedImage(kind, image);
    return { image, ...quality, orientation: "browser-default" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function fileSummary(file, dimensions) {
  const megabytes = (file.size / 1024 / 1024).toFixed(1);
  return `${dimensions.width} × ${dimensions.height} px | ${megabytes} MB`;
}
