/**
 * Pure routing for page-wide and canvas file drops.
 * Align modes have two seats; proxies have one multi-seat board.
 */

export function isFileDragEvent(event) {
  const types = event?.dataTransfer?.types;
  if (!types) return false;
  return [...types].includes("Files");
}

export function imageFilesFromList(fileList) {
  return [...(fileList || [])].filter((file) => {
    if (!file) return false;
    if (file.type?.startsWith("image/")) return true;
    return /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name || "");
  });
}

/**
 * @param {{ files: File[], hasArt: boolean, hasCard: boolean }} input
 * @returns {{ kind: "art" | "card", file: File }[]}
 */
export function routeAlignDroppedFiles({ files, hasArt, hasCard }) {
  const images = imageFilesFromList(files);
  if (!images.length) return [];
  if (images.length >= 2) {
    return [
      { kind: "art", file: images[0] },
      { kind: "card", file: images[1] },
    ];
  }
  const file = images[0];
  if (!hasArt) return [{ kind: "art", file }];
  if (!hasCard) return [{ kind: "card", file }];
  return [{ kind: "art", file }];
}

/**
 * @param {{ intake: "align" | "slot-fill", files: File[], hasArt: boolean, hasCard: boolean }} input
 * @returns {{ mode: "proxies", files: File[] } | { mode: "align", assignments: { kind: "art" | "card", file: File }[] }}
 */
export function routeStudioDroppedFiles({ intake, files, hasArt, hasCard }) {
  const images = imageFilesFromList(files);
  if (!images.length) return { mode: intake === "slot-fill" ? "proxies" : "align", files: [], assignments: [] };
  if (intake === "slot-fill") {
    return { mode: "proxies", files: images };
  }
  return {
    mode: "align",
    assignments: routeAlignDroppedFiles({ files: images, hasArt, hasCard }),
  };
}
