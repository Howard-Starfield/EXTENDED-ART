import { describe, expect, it } from "vitest";
import {
  CARD_RATIO,
  cardCropRect,
  MAX_DECODED_PIXELS,
  MAX_DIMENSION,
  MAX_UPLOAD_BYTES,
  classifyEffectiveDpi,
  validateDecodedImage,
  validateFile,
} from "../src/quality.js";

function pngFile(size, name = "source.png") {
  const bytes = new Uint8Array(size);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  return new File([bytes], name, { type: "image/png" });
}

describe("image intake and quality limits", () => {
  it("accepts the exact compressed byte limit and rejects the next byte", async () => {
    await expect(validateFile(pngFile(MAX_UPLOAD_BYTES))).resolves.toMatchObject({ mime: "image/png" });
    await expect(validateFile(pngFile(MAX_UPLOAD_BYTES + 1))).rejects.toThrow("50 MB");
  });

  it("rejects empty files and extension/signature mismatches", async () => {
    await expect(validateFile(new File([], "empty.png", { type: "image/png" }))).rejects.toThrow("empty");
    await expect(validateFile(pngFile(16, "source.jpg"))).rejects.toThrow("genuine PNG");
  });

  it("enforces decoded pixel and dimension boundaries", () => {
    expect(validateDecodedImage("art", { width: 10_000, height: 8_000 })).toMatchObject({
      width: 10_000,
      height: 8_000,
    });
    expect(10_000 * 8_000).toBe(MAX_DECODED_PIXELS);
    expect(() => validateDecodedImage("art", { width: 10_001, height: 8_000 })).toThrow("80 megapixel");
    expect(validateDecodedImage("art", { width: MAX_DIMENSION, height: 1 })).toMatchObject({ width: MAX_DIMENSION });
    expect(() => validateDecodedImage("art", { width: MAX_DIMENSION + 1, height: 1 })).toThrow("16,384");
  });

  it("keeps padded card references usable and provides a safe center crop", () => {
    const valid = validateDecodedImage("card", { width: 630, height: 880 });
    expect(valid.blocksAlignment).toBe(false);
    expect(valid.width / valid.height).toBeCloseTo(CARD_RATIO, 8);
    const invalid = validateDecodedImage("card", { width: 1000, height: 1000 });
    expect(invalid.blocksAlignment).toBe(false);
    expect(invalid.cropRect).toMatchObject({ x: 142, y: 0, width: 716, height: 1000 });
    expect(invalid.warnings[0]).toContain("center-cropped");
    expect(cardCropRect(1600, 900)).toBeNull();
  });

  it("classifies effective DPI without reading file metadata", () => {
    expect(classifyEffectiveDpi("Artwork", { width: 2339 }, 198).level).toBe("pass");
    expect(classifyEffectiveDpi("Artwork", { width: 1800 }, 198).level).toBe("warning");
    expect(classifyEffectiveDpi("Artwork", { width: 1000 }, 198).level).toBe("strong-warning");
    expect(classifyEffectiveDpi("Artwork", { width: 500 }, 198).blocksPackage).toBe(true);
  });
});
