import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

export const PACKAGE_VERSION = "phase3.0";
export const MEMORY_WARNING_BYTES = 512 * 1024 * 1024;
export const MEMORY_BLOCK_BYTES = 1024 * 1024 * 1024;

export function textBytes(value) {
  return new TextEncoder().encode(String(value));
}

export function estimatePeakMemory({ decodedInputBytes = 0, rasterBytes = 0, pdfBytes = 0, zipBytes = 0 } = {}) {
  const bytes = decodedInputBytes + rasterBytes + pdfBytes + zipBytes;
  return {
    bytes,
    level: bytes >= MEMORY_BLOCK_BYTES ? "blocked" : bytes >= MEMORY_WARNING_BYTES ? "warning" : "ok",
    warning: bytes >= MEMORY_BLOCK_BYTES
      ? "This package is too large for a safe browser export on the current memory budget."
      : bytes >= MEMORY_WARNING_BYTES
        ? "This package is large; keep other tabs closed while the browser assembles the ZIP."
        : null,
  };
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot calculate package checksums.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function normalizeBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return textBytes(bytes);
}

function comparePaths(left, right) {
  const leftLower = left.path.toLowerCase();
  const rightLower = right.path.toLowerCase();
  if (leftLower < rightLower) return -1;
  if (leftLower > rightLower) return 1;
  if (left.path < right.path) return -1;
  if (left.path > right.path) return 1;
  return 0;
}

export async function createZipArchive(entries, { onProgress, signal } = {}) {
  const sorted = [...entries]
    .map((entry) => ({ path: entry.path.replaceAll("\\", "/"), bytes: normalizeBytes(entry.bytes), mime: entry.mime || "application/octet-stream" }))
    .sort(comparePaths);
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false, level: 6 });
  try {
    for (let index = 0; index < sorted.length; index += 1) {
      if (signal?.aborted) throw new DOMException("Package export cancelled.", "AbortError");
      const entry = sorted[index];
      await writer.add(entry.path, new Uint8ArrayReader(entry.bytes), { level: 6 });
      onProgress?.({ completedWork: index + 1, totalWork: sorted.length, progress: ((index + 1) / sorted.length) * 100, stage: "Compressing package" });
    }
    return await writer.close();
  } catch (error) {
    try { await writer.close(); } catch { /* release a partial archive */ }
    throw error;
  }
}

export async function buildPrintPackage({
  entries,
  manifest,
  instructions,
  qualityReport,
  onProgress,
  signal,
}) {
  const outputEntries = [
    ...(entries || []),
    { path: "PRINT_INSTRUCTIONS.txt", bytes: textBytes(instructions), mime: "text/plain" },
    { path: "quality_report.json", bytes: textBytes(JSON.stringify(qualityReport, null, 2)), mime: "application/json" },
  ];
  const hashed = [];
  for (const entry of outputEntries) {
    const bytes = normalizeBytes(entry.bytes);
    hashed.push({
      ...entry,
      bytes,
      byteSize: bytes.byteLength,
      sha256: await sha256(bytes),
    });
  }
  const finalManifest = {
    schemaVersion: "phase3.0",
    packageVersion: PACKAGE_VERSION,
    ...manifest,
    files: hashed
      .map(({ path, byteSize, sha256: checksum }) => ({ path, byteSize, sha256: checksum }))
      .sort(comparePaths),
  };
  const manifestEntry = {
    path: "manifest.json",
    bytes: textBytes(JSON.stringify(finalManifest, null, 2) + "\n"),
    mime: "application/json",
  };
  const zipBytes = await createZipArchive([...hashed, manifestEntry], { onProgress, signal });
  return {
    bytes: zipBytes,
    manifest: finalManifest,
    entries: [...hashed, manifestEntry].sort(comparePaths),
  };
}
