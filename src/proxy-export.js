import { createPageLayout } from "./page-layout.js";
import { createCutReadyPdf, createPrintGuidePdf } from "./pdf-export.js";
import { applyRoundedAlphaMask, getPieceGeometry, mmToPixels, roundedMaskRadiusPx } from "./pieces.js";
import { buildPrintPackage, estimatePeakMemory } from "./package.js";
import { safeSlug, outputNames } from "./names.js";
import { withPrintMetadata } from "./png.js";
import { drawProxyCover, filledProxyIds, proxySlotId } from "./proxy-board.js";

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The output image could not be encoded."))), "image/png");
  });
}

async function canvasPng(canvas) {
  return withPrintMetadata(await canvasBlob(canvas), 300);
}

async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
}

function ensureNotAborted(signal) {
  if (signal?.aborted) throw new DOMException("Package export cancelled.", "AbortError");
}

function timestampForFilename(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function createCanvas({ width, height, documentRef, canvasFactory }) {
  const canvas = canvasFactory
    ? canvasFactory(width, height)
    : documentRef?.createElement?.("canvas");
  if (!canvas) throw new Error("A canvas factory is required for output rendering.");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function renderProxySlotCanvas({
  slot,
  profile,
  cornerRadiusMm = profile.recommended_corner_radius_mm || 0,
  documentRef = globalThis.document,
  canvasFactory,
}) {
  const [width, height] = profile.insert_px;
  const canvas = createCanvas({ width, height, documentRef, canvasFactory });
  const context = canvas.getContext("2d", { alpha: true, colorSpace: "srgb" });
  if (!context) throw new Error("The proxy slot canvas could not be created.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  drawProxyCover(context, slot.image, width, height, slot.transform);
  applyRoundedAlphaMask(context, width, height, roundedMaskRadiusPx(profile, cornerRadiusMm));
  return canvas;
}

function proxyInstructions({ profile, papers, layouts, memory, filledCount }) {
  const paperSummary = papers.map((item) => `${item.label} (${item.size_mm.join(" x ")} mm)`).join("; ");
  const lines = [
    "EXTENDEDART PROXIES PRINT INSTRUCTIONS",
    "",
    "1. Print the cut-ready PDF at 100% / Actual Size.",
    "2. Disable Fit to Page, Shrink to Printable Area, and other scaling.",
    "3. Measure the 50 mm calibration square on the print guide before cutting.",
    `4. Product: ${profile.label}; sheets: ${paperSummary}; each card is 63 x 88 mm.`,
    `5. This package contains ${filledCount} printable proxy card(s) on a 3x3 seat grid.`,
    "6. Cut along the dotted teal guides outside each card.",
    "",
    "Test the actual printer, paper, and sleeve combination before making a final cut.",
  ];
  const warnings = layouts.flatMap((item) => item.warnings);
  if (warnings.length) lines.push("", `WARNING: ${warnings.join(" ")}`);
  if (memory.warning) lines.push("", `MEMORY: ${memory.warning}`);
  return `${lines.join("\n")}\n`;
}

function proxyQualityReport({ profile, paper, board, layouts, cornerRadiusMm, papers }) {
  const slots = board.slots.map((slot, index) => {
    const id = proxySlotId(index);
    if (!slot) return { id, filled: false };
    const widthMm = 63;
    const effectiveDpi = slot.dimensions?.width
      ? (slot.dimensions.width / widthMm) * 25.4 * (slot.transform?.zoom || 1)
      : null;
    return {
      id,
      filled: true,
      sourcePx: slot.dimensions,
      sequence: slot.sequence,
      zoom: slot.transform?.zoom ?? 1,
      estimatedEffectiveDpi: effectiveDpi,
    };
  });
  return {
    overallStatus: slots.some((slot) => slot.filled) ? "READY" : "BLOCKED",
    profile: profile.name,
    profileVersion: profile.version || null,
    paper: paper.name,
    cornerRadiusMm,
    guideContract: {
      strokePt: 0.5,
      clearancePt: 0.25,
      dash: [3, 2],
    },
    physical: {
      insertMm: [...profile.insert_mm],
      insertPx: [...profile.insert_px],
      masterMm: [...profile.master_mm],
      masterPx: [...profile.master_px],
    },
    slots,
    pageLayouts: layouts.map((item) => ({
      paper: item.paper,
      pageCount: item.pageCount,
      status: item.status,
      warnings: [...item.warnings],
      placements: item.placements.map(({ pieceId, pageIndex, xPt, yPt, widthPt, heightPt }) => ({
        pieceId, pageIndex, xPt, yPt, widthPt, heightPt,
      })),
    })),
    papers: papers.map((item) => ({ name: item.name, label: item.label, sizeMm: [...item.size_mm] })),
  };
}

export async function createProxiesPrintPackage({
  board,
  profile,
  paper,
  papers,
  cornerRadiusMm = profile.recommended_corner_radius_mm || 0,
  includePieces = false,
  includeSecondPaper = false,
  documentRef = globalThis.document,
  createdAt = new Date(),
  onProgress,
  signal,
}) {
  const pieceIds = filledProxyIds(board);
  if (!pieceIds.length) throw new Error("Add at least one proxy card before exporting.");

  const outputPaperSet = includeSecondPaper && papers
    ? [paper, papers[paper.name === "a4" ? "letter" : "a4"]].filter(Boolean)
      .filter((item, index, list) => list.findIndex((entry) => entry.name === item.name) === index)
    : [paper];

  const layouts = outputPaperSet.map((item) => createPageLayout(profile, item, { pieceIds }));
  const layout = layouts[0];
  const geometry = getPieceGeometry(profile);
  const filledSlots = board.slots
    .map((slot, index) => (slot ? { slot, id: proxySlotId(index), piece: geometry.find((entry) => entry.id === proxySlotId(index)) } : null))
    .filter(Boolean);

  const decodedInputBytes = filledSlots.reduce(
    (sum, entry) => sum + (entry.slot.dimensions?.width || 0) * (entry.slot.dimensions?.height || 0) * 4,
    0,
  );
  const memory = estimatePeakMemory({
    decodedInputBytes,
    rasterBytes: profile.insert_px[0] * profile.insert_px[1] * 4 * filledSlots.length,
    pdfBytes: profile.master_px[0] * profile.master_px[1] * outputPaperSet.length,
    zipBytes: profile.master_px[0] * profile.master_px[1] * outputPaperSet.length,
  });
  if (memory.level === "blocked") throw new Error(memory.warning);

  onProgress?.({ stage: "Rendering proxy cards", completedWork: 0, totalWork: filledSlots.length, progress: 5 });
  const cutReadyPieces = new Map();
  for (let index = 0; index < filledSlots.length; index += 1) {
    ensureNotAborted(signal);
    const entry = filledSlots[index];
    const canvas = renderProxySlotCanvas({
      slot: entry.slot,
      profile,
      cornerRadiusMm,
      documentRef,
    });
    cutReadyPieces.set(entry.id, await canvasPng(canvas));
    releaseCanvas(canvas);
    onProgress?.({
      stage: "Rendering proxy cards",
      completedWork: index + 1,
      totalWork: filledSlots.length,
      progress: 5 + ((index + 1) / filledSlots.length) * 45,
    });
  }

  const slug = safeSlug(filledSlots[0]?.slot.file?.name || "proxies");
  const names = outputNames({ slug, profile: profile.name, paper: paper.name });
  onProgress?.({ stage: "Writing exact-size PDFs", completedWork: 3, totalWork: 5, progress: 60 });

  const entries = [];
  for (let index = 0; index < outputPaperSet.length; index += 1) {
    const outputPaper = outputPaperSet[index];
    const outputLayout = layouts[index];
    const outputNamesForPaper = outputNames({ slug, profile: profile.name, paper: outputPaper.name });
    const cutReadyPdf = await createCutReadyPdf({
      profile,
      paper: outputPaper,
      pieceSources: cutReadyPieces,
      cornerRadiusMm,
      layout: outputLayout,
      title: "ExtendedArt proxies cut-ready package",
    });
    const printGuidePdf = await createPrintGuidePdf({ profile, paper: outputPaper, layout: outputLayout });
    entries.push(
      { path: outputNamesForPaper.cutReadyPdf, bytes: cutReadyPdf, mime: "application/pdf" },
      { path: outputNamesForPaper.printGuidePdf, bytes: printGuidePdf, mime: "application/pdf" },
    );
  }

  if (includePieces) {
    for (const id of pieceIds) {
      entries.push({ path: names.piecePng(id), bytes: await blobBytes(cutReadyPieces.get(id)), mime: "image/png" });
    }
  }

  const qualityReport = proxyQualityReport({
    profile,
    paper,
    board,
    layouts,
    cornerRadiusMm,
    papers: outputPaperSet,
  });
  const manifest = {
    appVersion: "0.2.0",
    profile: profile.name,
    profileVersion: profile.version || null,
    intake: "slot-fill",
    paper: paper.name,
    paperSizeMm: [...paper.size_mm],
    paperSet: outputPaperSet.map((item) => ({ name: item.name, label: item.label, sizeMm: [...item.size_mm] })),
    filledPieceIds: pieceIds,
    guideContract: qualityReport.guideContract,
    pageLayout: {
      status: layout.status,
      pageCount: layout.pageCount,
      warnings: layout.warnings,
      placements: layout.placements.map(({ pieceId, pageIndex, xPt, yPt, widthPt, heightPt, scale }) => ({
        pieceId, pageIndex, xPt, yPt, widthPt, heightPt, scale,
      })),
    },
  };

  const result = await buildPrintPackage({
    entries,
    manifest: { ...manifest, createdAt: createdAt.toISOString(), qualityStatus: qualityReport.overallStatus },
    instructions: proxyInstructions({
      profile,
      papers: outputPaperSet,
      layouts,
      memory,
      filledCount: pieceIds.length,
    }),
    qualityReport,
    onProgress: (event) => onProgress?.({ ...event, progress: 60 + event.progress * 0.4 }),
    signal,
  });

  onProgress?.({ stage: "Package ready", completedWork: 5, totalWork: 5, progress: 100 });
  return {
    ...result,
    filename: names.packageZip(outputPaperSet.map((item) => item.name).join("_"), timestampForFilename(createdAt)),
    qualityReport,
    layout,
    layouts,
    papers: outputPaperSet,
    memory,
  };
}

export function proxyPixelContract() {
  return {
    widthPx: Math.round(mmToPixels(63)),
    heightPx: Math.round(mmToPixels(88)),
  };
}
