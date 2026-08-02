export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_DECODED_PIXELS = 80_000_000;
export const MAX_DIMENSION = 16_384;
export const CARD_RECOMMENDED = { width: 630, height: 880 };
export const CARD_MINIMUM = { width: 252, height: 352 };
export const CARD_RATIO = 63 / 88;

const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const EXTENSION_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
]);

function hasBytes(bytes, offset, values) {
  return values.every((value, index) => bytes[offset + index] === value);
}

export async function sniffImageType(file) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (hasBytes(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (hasBytes(bytes, 0, [255, 216, 255])) return "image/jpeg";
  if (hasBytes(bytes, 0, [82, 73, 70, 70]) && hasBytes(bytes, 8, [87, 69, 66, 80])) return "image/webp";
  return null;
}

export async function validateFile(file) {
  if (!file) throw new Error("Choose an image file first.");
  if (!file.size) throw new Error("That image is empty. Choose a PNG, JPG, or WebP with pixel data.");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("That image is over the 50 MB limit. Export a smaller source and try again.");
  }
  const signature = await sniffImageType(file);
  const mime = MIME_TYPES.has(file.type) ? file.type : signature;
  const extension = String(file.name || "").split(".").pop()?.toLowerCase();
  const extensionMime = EXTENSION_TYPES.get(extension);
  if (!mime || (signature && mime !== signature) || (signature && extensionMime && extensionMime !== signature)) {
    throw new Error("Use a genuine PNG, JPG, or WebP image.");
  }
  return { mime, signature };
}

export function decodedDimensions(image) {
  return { width: image?.naturalWidth || image?.width || 0, height: image?.naturalHeight || image?.height || 0 };
}

export function validateDecodedImage(kind, image) {
  const { width, height } = decodedDimensions(image);
  if (!width || !height) throw new Error("This image has no readable dimensions.");
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(`Image dimensions cannot exceed ${MAX_DIMENSION.toLocaleString()} px on either side.`);
  }
  if (width * height > MAX_DECODED_PIXELS) {
    throw new Error("This image decodes above the 80 megapixel safety limit.");
  }
  const warnings = [];
  const blockingIssues = [];
  if (kind === "card") {
    const ratio = width / height;
    const ratioDelta = Math.abs(ratio - CARD_RATIO) / CARD_RATIO;
    if (ratioDelta > 0.05) {
      const message = "Card ratio is outside the expected 63:88 shape; crop to the card edges before alignment.";
      warnings.push(message);
      blockingIssues.push(message);
    }
    if (width < CARD_RECOMMENDED.width || height < CARD_RECOMMENDED.height) {
      warnings.push("Card reference is below the recommended 630 × 880 px quality target.");
    }
    if (width < CARD_MINIMUM.width || height < CARD_MINIMUM.height) {
      throw new Error("The original card must be at least 252 × 352 px.");
    }
  }
  return { width, height, warnings, blockingIssues, blocksAlignment: blockingIssues.length > 0 };
}

export function effectiveDpi(pixelWidth, physicalMm) {
  return (pixelWidth / (physicalMm / 25.4));
}

export function qualityMessage(kind, dimensions, physicalMm) {
  return classifyEffectiveDpi(kind, dimensions, physicalMm).message;
}

export function classifyEffectiveDpi(kind, dimensions, physicalMm) {
  const dpi = effectiveDpi(dimensions.width, physicalMm);
  const rounded = Math.round(dpi);
  if (rounded < 100) {
    return {
      dpi,
      level: "block-package",
      blocksPackage: true,
      message: `${kind} source is about ${rounded} effective DPI at output size; below 100 DPI, so final package export will require acknowledgement.`,
    };
  }
  if (rounded < 200) {
    return {
      dpi,
      level: "strong-warning",
      blocksPackage: false,
      message: `${kind} source is about ${rounded} effective DPI at output size; print detail may soften substantially.`,
    };
  }
  if (rounded < 300) {
    return {
      dpi,
      level: "warning",
      blocksPackage: false,
      message: `${kind} source is about ${rounded} effective DPI at output size; 300 DPI is recommended.`,
    };
  }
  return {
    dpi,
    level: "pass",
    blocksPackage: false,
    message: `${kind} source supports about ${rounded} effective DPI at output size.`,
  };
}
