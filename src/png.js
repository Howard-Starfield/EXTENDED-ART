const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(value) {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function chunk(type, data) {
  const typeBytes = [...new TextEncoder().encode(type)];
  const body = [...typeBytes, ...data];
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

export async function withPrintMetadata(blob, dpi = 300) {
  const source = new Uint8Array(await blob.arrayBuffer());
  if (!PNG_SIGNATURE.every((value, index) => source[index] === value)) return blob;
  const pixelsPerMeter = Math.round(dpi / 0.0254);
  const phys = chunk("pHYs", [...u32(pixelsPerMeter), ...u32(pixelsPerMeter), 1]);
  const srgb = chunk("sRGB", [0]);
  const output = [...source.slice(0, 8)];
  let offset = 8;
  let insertedPhys = false;
  let insertedSrgb = false;
  while (offset + 12 <= source.length) {
    const length = (source[offset] << 24) | (source[offset + 1] << 16) | (source[offset + 2] << 8) | source[offset + 3];
    const end = offset + 12 + length;
    if (end > source.length) return blob;
    const type = new TextDecoder().decode(source.slice(offset + 4, offset + 8));
    output.push(...source.slice(offset, end));
    if (type === "IHDR") {
      output.push(...srgb, ...phys);
      insertedSrgb = true;
      insertedPhys = true;
    }
    offset = end;
    if (type === "IEND") break;
  }
  if (!insertedSrgb || !insertedPhys) return blob;
  return new Blob([new Uint8Array(output)], { type: "image/png" });
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
