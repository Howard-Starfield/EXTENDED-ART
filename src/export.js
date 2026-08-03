import { fallbackPapers, psaLabelBox } from "./profiles.js";
import { getOutputMaskGeometry } from "./output-geometry.js";
import { createPageLayout } from "./page-layout.js";
import {
  getPieceGeometry,
  getPrintablePieceGeometry,
  renderCutReadyPieceFromMaster,
  renderMasterToCanvas,
  renderPieceFromMaster,
} from "./pieces.js";
import { createCutReadyPdf, createFullArtPdf, createPrintGuidePdf, createWithCardReferencePdf } from "./pdf-export.js";
import { buildPrintPackage, estimatePeakMemory } from "./package.js";
import { safeSlug, outputNames } from "./names.js";
import { buildQualityReport, serializeAlignmentDiagnostics } from "./quality-report.js";
import { imageSize } from "./state.js";
import { withPrintMetadata } from "./png.js";

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The output image could not be encoded.")), "image/png");
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

function cardCanvas({ profile, cardImage, documentRef }) {
  const cardCutout = getOutputMaskGeometry(profile).find((cutout) => cutout.id === "CARD");
  const width = cardCutout?.pixels.width || profile.insert_px[0];
  const height = cardCutout?.pixels.height || profile.insert_px[1];
  const canvas = documentRef.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  const size = imageSize(cardImage);
  const scale = Math.max(width / size.width, height / size.height);
  const drawWidth = size.width * scale;
  const drawHeight = size.height * scale;
  context.drawImage(cardImage, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  return canvas;
}

function outputOptions(options = {}) {
  return {
    includePieces: Boolean(options.includePieces),
    includeMaster: Boolean(options.includeMaster),
    includeFullArtPdf: Boolean(options.includeFullArtPdf),
    includeWithCardPdf: Boolean(options.includeWithCardPdf),
    includeSecondPaper: Boolean(options.includeSecondPaper),
    includeCard: Boolean(options.includeCard),
  };
}

function timestampForFilename(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function printInstructions({ profile, papers, layouts, options, memory }) {
  const paperSummary = papers.map((item) => `${item.label} (${item.size_mm.join(" x ")} mm)`).join("; ");
  const lines = [
    "EXTENDEDART PRINT INSTRUCTIONS",
    "",
    "1. Print the cut-ready PDF at 100% / Actual Size.",
    "2. Disable Fit to Page, Shrink to Printable Area, and other scaling.",
    "3. Measure the 50 mm calibration square on the print guide before cutting.",
    `4. Product: ${profile.label}; sheets: ${paperSummary}; physical output remains exact size.`,
    "5. The uploaded original card is an alignment reference and is not included in the default cut-ready output.",
    options.includePieces ? "6. Optional piece PNGs contain artwork only; use the PDF guides for cutting." : "6. Cut along the dashed guides; internal chamber guides are inside the white area to be removed.",
    "",
    "Test the actual printer, paper, sleeve, and holder combination before making a final cut.",
  ];
  const warnings = layouts.flatMap((item) => item.warnings);
  if (warnings.length) lines.push("", `WARNING: ${warnings.join(" ")}`);
  if (memory.warning) lines.push("", `MEMORY: ${memory.warning}`);
  return lines.join("\n") + "\n";
}

function sourceManifest(state, profile, paper, alignment, options, layout, papers, layouts) {
  const serializedAlignment = serializeAlignmentDiagnostics(alignment, {
    currentTransform: { zoom: state.zoom, offsetX: state.offsetX, offsetY: state.offsetY },
    preservedAlignment: Boolean(state.lastStableAlignment),
  });
  return {
    appVersion: "0.1.0",
    profile: profile.name,
    profileVersion: profile.version || null,
    paper: paper.name,
    paperSizeMm: [...paper.size_mm],
    paperSet: papers.map((item) => ({ name: item.name, label: item.label, sizeMm: [...item.size_mm] })),
    alignment: serializedAlignment ? {
      ...serializedAlignment,
      profileVersion: alignment?.profileVersion || profile.version || null,
    } : null,
    exportOptions: options,
    source: {
      artwork: state.artDimensions ? { ...state.artDimensions, mime: state.artFile?.type || null, bytes: state.artFile?.size || null } : null,
      card: state.cardDimensions ? { ...state.cardDimensions, mime: state.cardFile?.type || null, bytes: state.cardFile?.size || null } : null,
    },
    pageLayout: {
      status: layout.status,
      pageCount: layout.pageCount,
      warnings: layout.warnings,
      placements: layout.placements.map(({ pieceId, pageIndex, xPt, yPt, widthPt, heightPt, scale }) => ({ pieceId, pageIndex, xPt, yPt, widthPt, heightPt, scale })),
    },
    pageLayouts: layouts.map((item) => ({
      paper: item.paper,
      pageSizeMm: [...item.pageSizeMm],
      pageCount: item.pageCount,
      status: item.status,
      warnings: [...item.warnings],
      placements: item.placements.map(({ pieceId, pageIndex, xPt, yPt, widthPt, heightPt, scale }) => ({ pieceId, pageIndex, xPt, yPt, widthPt, heightPt, scale })),
    })),
  };
}

function outputPapers({ paper, papers, includeSecondPaper }) {
  if (!includeSecondPaper) return [paper];
  const otherName = paper.name === "a4" ? "letter" : "a4";
  const other = papers?.[otherName] || fallbackPapers[otherName];
  return other && other.name !== paper.name ? [paper, other] : [paper];
}

export async function createBrowserPrintPackage({
  state,
  profile,
  paper,
  exportOptions: requestedOptions = {},
  documentRef = globalThis.document,
  createdAt = new Date(),
  onProgress,
  signal,
}) {
  if (!state?.artImage || !state?.cardImage) throw new Error("Upload both the extended artwork and original card before exporting.");
  const options = outputOptions(requestedOptions);
  const labelBox = profile.name === "psa" ? psaLabelBox(profile, state.psaLabelWidthMm, state.psaLabelHeightMm) : null;
  const outputPaperSet = outputPapers({ paper, papers: state.papers, includeSecondPaper: options.includeSecondPaper });
  const layouts = outputPaperSet.map((item) => createPageLayout(profile, item));
  const layout = layouts[0];
  const fullLayouts = options.includeWithCardPdf
    ? outputPaperSet.map((item) => createPageLayout(profile, item, { includeCenter: true }))
    : null;
  const pieceGeometry = options.includeWithCardPdf ? getPieceGeometry(profile) : getPrintablePieceGeometry(profile);
  const memory = estimatePeakMemory({
    decodedInputBytes: (state.artDimensions?.width * state.artDimensions?.height + state.cardDimensions?.width * state.cardDimensions?.height) * 4,
    rasterBytes: profile.master_px[0] * profile.master_px[1] * 4 * (options.includeWithCardPdf ? 5 : 3),
    pdfBytes: profile.master_px[0] * profile.master_px[1] * outputPaperSet.length,
    zipBytes: profile.master_px[0] * profile.master_px[1] * outputPaperSet.length,
  });
  if (memory.level === "blocked") throw new Error(memory.warning);

  onProgress?.({ stage: "Rendering master artwork", completedWork: 1, totalWork: 5, progress: 10 });
  ensureNotAborted(signal);
  const masterCanvas = renderMasterToCanvas({ profile, state, artImage: state.artImage, documentRef });
  const masterPng = await canvasPng(masterCanvas);
  const cutReadyPieces = new Map();
  const fullPieces = new Map();
  for (let index = 0; index < pieceGeometry.length; index += 1) {
    ensureNotAborted(signal);
    const piece = pieceGeometry[index];
    const fullCanvas = renderPieceFromMaster({ masterCanvas, piece, profile, cornerRadiusMm: state.cornerRadiusMm, documentRef });
    fullPieces.set(piece.id, await canvasPng(fullCanvas));
    releaseCanvas(fullCanvas);
    if (layout.placements.some((placement) => placement.pieceId === piece.id)) {
      const cutCanvas = renderCutReadyPieceFromMaster({ masterCanvas, piece, profile, cornerRadiusMm: state.cornerRadiusMm, labelBox, documentRef });
      cutReadyPieces.set(piece.id, await canvasPng(cutCanvas));
      releaseCanvas(cutCanvas);
    }
    onProgress?.({ stage: "Rendering printable pieces", completedWork: index + 1, totalWork: pieceGeometry.length, progress: 10 + ((index + 1) / pieceGeometry.length) * 40 });
  }
  const cardCanvasElement = cardCanvas({ profile, cardImage: state.cardImage, documentRef });
  const cardPng = await canvasPng(cardCanvasElement);
  releaseCanvas(cardCanvasElement);
  const slug = safeSlug(state.artFile?.name);
  const names = outputNames({ slug, profile: profile.name, paper: paper.name });
  onProgress?.({ stage: "Writing exact-size PDFs", completedWork: 3, totalWork: 5, progress: 60 });
  const entries = [];
  for (let index = 0; index < outputPaperSet.length; index += 1) {
    const outputPaper = outputPaperSet[index];
    const outputLayout = layouts[index];
    const outputNamesForPaper = outputNames({ slug, profile: profile.name, paper: outputPaper.name });
    const cutReadyPdf = await createCutReadyPdf({ profile, paper: outputPaper, pieceSources: cutReadyPieces, labelBox, cornerRadiusMm: state.cornerRadiusMm, layout: outputLayout });
    const printGuidePdf = await createPrintGuidePdf({ profile, paper: outputPaper, layout: outputLayout });
    entries.push(
      { path: outputNamesForPaper.cutReadyPdf, bytes: cutReadyPdf, mime: "application/pdf" },
      { path: outputNamesForPaper.printGuidePdf, bytes: printGuidePdf, mime: "application/pdf" },
    );
    if (options.includeWithCardPdf) {
      const withCardPdf = await createWithCardReferencePdf({ profile, paper: outputPaper, pieceSources: fullPieces, cardSource: cardPng, labelBox, cornerRadiusMm: state.cornerRadiusMm, layout: fullLayouts[index] });
      entries.push({ path: outputNamesForPaper.withCardPdf, bytes: withCardPdf, mime: "application/pdf" });
    }
    if (options.includeFullArtPdf) {
      entries.push({ path: `${slug}_${profile.name}_${outputPaper.name}_full_art_reference.pdf`, bytes: await createFullArtPdf({ profile, paper: outputPaper, masterSource: masterPng }), mime: "application/pdf" });
    }
  }
  if (options.includeMaster) entries.push({ path: names.masterPng, bytes: await blobBytes(masterPng), mime: "image/png" });
  if (options.includePieces) {
    for (const piece of getPrintablePieceGeometry(profile)) {
      entries.push({ path: names.piecePng(piece.id), bytes: await blobBytes(cutReadyPieces.get(piece.id)), mime: "image/png" });
    }
  }
  releaseCanvas(masterCanvas);
  const qualityReport = buildQualityReport({
    profile,
    paper,
    artDimensions: state.artDimensions,
    cardDimensions: state.cardDimensions,
    alignment: state.matcherDiagnostics,
    labelBox,
    cornerRadiusMm: state.cornerRadiusMm,
    exportOptions: options,
    papers: outputPaperSet,
    layouts,
    currentTransform: { zoom: state.zoom, offsetX: state.offsetX, offsetY: state.offsetY },
    preservedAlignment: Boolean(state.lastStableAlignment),
  });
  const manifest = sourceManifest(state, profile, paper, state.matcherDiagnostics, options, layout, outputPaperSet, layouts);
  const result = await buildPrintPackage({
    entries,
    manifest: { ...manifest, createdAt: createdAt.toISOString(), qualityStatus: qualityReport.overallStatus },
    instructions: printInstructions({ profile, papers: outputPaperSet, layouts, options, memory }),
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
