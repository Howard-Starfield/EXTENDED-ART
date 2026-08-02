import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { withPrintMetadata } from "../src/png.js";

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function tinyPng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return new Blob([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 255, 255, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ], { type: "image/png" });
}

function chunks(bytes) {
  const output = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    const type = new TextDecoder().decode(bytes.slice(offset + 4, offset + 8));
    const data = bytes.slice(offset + 8, offset + 8 + length);
    output.push({ type, data });
    offset += 12 + length;
  }
  return output;
}

describe("proof PNG metadata", () => {
  it("adds sRGB and the exact 300 DPI pHYs metadata", async () => {
    const result = await withPrintMetadata(tinyPng(), 300);
    const bytes = new Uint8Array(await result.arrayBuffer());
    const entries = chunks(bytes);
    const phys = entries.find((entry) => entry.type === "pHYs");
    const srgb = entries.find((entry) => entry.type === "sRGB");
    expect(new DataView(phys.data.buffer, phys.data.byteOffset, 4).getUint32(0)).toBe(11811);
    expect(new DataView(phys.data.buffer, phys.data.byteOffset + 4, 4).getUint32(0)).toBe(11811);
    expect(phys.data[8]).toBe(1);
    expect(srgb.data[0]).toBe(0);
  });
});
