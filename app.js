import {
  cleanMeasure,
  cardPhysicalMm,
  cellCardOffset,
  cellFromCardOffset,
  cellName,
  fallbackPapers,
  fallbackProfiles,
  isSlabProfile,
  PROFILE_VERSION,
  pixelPair,
  profileSummary,
  psaLabelBox as makePsaLabelBox,
} from "./src/profiles.js";
import { createPageLayout } from "./src/page-layout.js";
import {
  ALIGNMENT_STATUSES,
  alignmentTransform,
  createInitialState,
  imageSize,
  normalizeAlignmentResult,
  releaseImage,
  snapshotAlignment,
} from "./src/state.js";
import { fileSummary, readImage, replacePreviewUrl } from "./src/image-io.js";
import { classifyEffectiveDpi } from "./src/quality.js";
import { alignmentEvidence, buildQualityReport, sanitizeDiagnosticText } from "./src/quality-report.js";
import { CENTER_FIT_ALIGNMENT } from "./src/alignment.js";
import { createMatcherJobRunner } from "./src/matcher.js";
import { drawAlignmentScene, drawArtworkProof } from "./src/renderer.js";
import { triggerDownload, withPrintMetadata } from "./src/png.js";

const $ = (selector) => document.querySelector(selector);
const canvas = $("#alignmentCanvas");
const shell = $("#canvasShell");
const ctx = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
const state = createInitialState(fallbackProfiles, fallbackPapers);

let toastTimer;
let renderQueued = false;
let exportController = null;
const intakeGeneration = { art: 0, card: 0 };
const intakeDecodedGeneration = { art: 0, card: 0 };
let suppressMatcherLifecycle = false;
let activeAlignmentContext = null;

function activeProfile() {
  return state.profiles[state.profile] || fallbackProfiles.standard;
}

function activePaper() {
  return state.papers[state.paper] || fallbackPapers.a4;
}

function currentPsaLabelBox() {
  return makePsaLabelBox(activeProfile(), state.psaLabelWidthMm, state.psaLabelHeightMm);
}

function includeCardRequested() {
  return $("#includeCard").checked;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function setRuler(element, total, divisions, suffix) {
  const values = [];
  const count = divisions > 1 ? divisions : 1;
  for (let index = 0; index <= count; index += 1) {
    const value = total * index / count;
    values.push(`<span>${cleanMeasure(value)}${index === count ? suffix : ""}</span>`);
  }
  element.innerHTML = values.join("");
}

function updateSetupSummary() {
  const profileName = document.querySelector('input[name="profile"]:checked')?.value || state.profile;
  const paperName = document.querySelector('input[name="paper"]:checked')?.value || state.paper;
  const profile = state.profiles[profileName] || fallbackProfiles[profileName] || fallbackProfiles.standard;
  const paper = state.papers[paperName] || fallbackPapers[paperName] || fallbackPapers.a4;
  if (!(profile && paper)) return;
  $("#setupSummaryName").textContent = profile.label;
  $("#setupSummaryPixels").textContent = `${pixelPair(profile.master_px)} px`;
  $("#setupSummarySize").textContent = `${cleanMeasure(profile.master_mm[0])} × ${cleanMeasure(profile.master_mm[1])} mm`;
  $("#setupSummarySheet").textContent = `${paper.label} / ${cleanMeasure(paper.size_mm[0])} × ${cleanMeasure(paper.size_mm[1])} mm`;
  $("#setupSummaryPackage").textContent = profileSummary(profile, paper);
}

function updateExportSummary() {
  const selected = [
    $("#includeSecondPaper").checked ? "A4 + US Letter" : "",
    $("#includePieces").checked ? "piece PNGs" : "",
    $("#includeMaster").checked ? "master PNG" : "",
    $("#includeFullArtPdf").checked ? "full-art PDF" : "",
    $("#includeWithCardPdf").checked ? "with-card PDF" : "",
  ].filter(Boolean);
  $("#exportButtonCopy").textContent = selected.length
    ? selected.join(", ") + " | cut-ready PDF + print guide included"
    : "Cut-ready PDF + print guide included";
  $("#exportButton").disabled = state.alignmentBusy
    || state.exportBusy
    || !(state.artImage && state.cardImage);
}

function updatePaperTools() {
  const profile = activeProfile();
  [
    ["a4", "#a4PaperTool", "#a4Fit"],
    ["letter", "#letterPaperTool", "#letterFit"],
  ].forEach(([paperName, buttonSelector, fitSelector]) => {
    const paper = state.papers[paperName] || fallbackPapers[paperName];
    const layout = createPageLayout(profile, paper);
    const selected = state.paper === paperName;
    const outputLabel = layout.pageCount > 1
      ? `${layout.pageCount} pages · exact size`
      : layout.warnings.length
        ? "Exact size · margin note"
        : "Exact size";
    const dimensions = `${paper.size_mm.map(cleanMeasure).join(" × ")} mm`;
    const button = $(buttonSelector);
    button.classList.toggle("active", selected);
    button.classList.toggle("scaled", layout.pageCount > 1 || layout.warnings.length > 0);
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("aria-label", `${paper.label} ${dimensions} millimetres, ${outputLabel}`);
    button.title = `${paper.label}: ${dimensions} mm | ${outputLabel}`;
    $(fitSelector).textContent = `${dimensions} · ${outputLabel}`;
  });
}

function updateSetupWizard() {
  const productStep = state.setupStep === "product";
  $("#setupProductStep").hidden = !productStep;
  $("#setupPaperStep").hidden = productStep;
  $("#setupStepLabel").textContent = productStep ? "Step 1 of 2" : "Step 2 of 2";
  $("#launchTitle").textContent = productStep ? "What are we making today?" : "Choose your paper size";
  const selectedPaper = document.querySelector('input[name="paper"]:checked');
  $("#startStudioButton").disabled = !selectedPaper;
}

function updateStudioContract() {
  const profile = activeProfile();
  const paper = activePaper();
  const isBinder = profile.grid[0] > 1;
  shell.style.aspectRatio = `${profile.master_px[0]} / ${profile.master_px[1]}`;
  shell.classList.toggle("photo-frame-mode", profile.name === "photo8x10");
  shell.classList.toggle("slab-mode", isSlabProfile(profile));
  const modeBadge = $("#frameModeBadge");
  const badgeText = profile.name === "photo8x10"
    ? "8 × 10 frame preview"
    : profile.name === "cardslab"
      ? "card slab · centered card"
      : "";
  modeBadge.textContent = badgeText;
  modeBadge.hidden = !badgeText;
  $(".light-table").dataset.paper = state.paper;
  $("#activeSpec").textContent = `${profile.label} | ${pixelPair(profile.master_px)} px | ${paper.label} | 300 DPI`;
  $("#artDropTitle").textContent = isBinder
    ? `Extended ${profile.grid[0]}×${profile.grid[1]} artwork`
    : `Extended ${profile.label} artwork`;
  $("#artDropCopy").textContent = isBinder
    ? "Drop or choose the continuous extended scene"
    : "Drop or choose the full display artwork";
  $("#methodCopy").textContent = isBinder
    ? "The original card is required for the automatic baseline. Drag the extended artwork underneath the fixed center reference until the edges meet."
    : "The original card is required for the automatic baseline. The card zone stays fixed while you refine the display scene underneath it.";
  $("#emptyStateCopy").textContent = isBinder
    ? `Drop the full ${profile.grid[0]}x${profile.grid[1]} image on the left to begin.`
    : `Drop the full ${profile.label} image on the left to begin.`;
  setRuler($("#rulerX"), profile.master_mm[0], profile.grid[0], " mm");
  setRuler($("#rulerY"), profile.master_mm[1], profile.grid[1], "");
  $("#masterContract").textContent = pixelPair(profile.master_px);
  $("#pieceContractLabel").textContent = profile.piece_count === 1 ? "Output" : "Insert";
  $("#pieceContract").textContent = pixelPair(profile.insert_px);
  $("#paperContract").textContent = `${paper.label} / ${paper.size_mm.map(cleanMeasure).join(" × ")} mm`;
  $("#includeCardHelp").textContent = "Off by default to save ink; the cut-ready package leaves the center/card chamber empty.";
  $("#cutReadyOutputHelp").textContent = profile.name === "psa" || profile.name === "psaMini"
    ? "White PSA label + card chambers with dotted guides"
    : profile.name === "cardslab" || profile.name === "psaCase"
      ? "White centered card chamber with dotted guide"
      : "Finished outer pieces with cut guides";
  $("#psaLabelControls").hidden = profile.name !== "psa" && profile.name !== "psaMini";
  $("#cardPositionControls").hidden = !profile.piece_count || profile.piece_count <= 1;
  syncCardPositionControls();
  updatePaperTools();
  updateExportSummary();
  updateQualityNotice();
  requestRender();
}

function focusVisibleSetupControl() {
  const selector = state.setupStep === "product" ? 'input[name="profile"]' : 'input[name="paper"]';
  const control = document.querySelector(`${selector}:checked`) || document.querySelector(selector);
  window.setTimeout(() => control?.focus(), 0);
}

function openSetup() {
  state.setupStep = state.profile ? "paper" : "product";
  const gate = $("#launchGate");
  document.querySelectorAll('input[name="profile"], input[name="paper"]').forEach((input) => {
    input.checked = input.name === "profile" ? input.value === state.profile : input.value === state.paper;
  });
  updateSetupSummary();
  updateSetupWizard();
  gate.hidden = false;
  document.body.classList.add("setup-open");
  $(".topbar").inert = true;
  $(".studio-shell").inert = true;
  focusVisibleSetupControl();
}

function closeSetup() {
  $("#launchGate").hidden = true;
  document.body.classList.remove("setup-open");
  $(".topbar").inert = false;
  $(".studio-shell").inert = false;
}

function applySetup(event) {
  event.preventDefault();
  if (state.setupStep !== "paper") return;
  const nextProfile = document.querySelector('input[name="profile"]:checked').value;
  const nextPaper = document.querySelector('input[name="paper"]:checked').value;
  const profileChanged = state.profile !== nextProfile;
  state.profile = nextProfile;
  state.paper = nextPaper;
  $("#includeCard").checked = false;
  if (profileChanged) {
    state.cornerRadiusMm = Number(activeProfile().recommended_corner_radius_mm || 0);
    $("#radiusRange").value = String(state.cornerRadiusMm);
    $("#radiusValue").textContent = `${cleanMeasure(state.cornerRadiusMm)} mm`;
    state.lastStableAlignment = null;
    state.alignmentSnapshot = null;
    applyCenterFit();
    // Reset the original-card cell back to the centre of the new profile so
    // an offset tuned for, say, "standard 3x3" doesn't strand the card in an
    // out-of-bounds position on "vaultx".
    const profile = activeProfile();
    if (profile.piece_count > 1) {
      const [cols, rows] = profile.grid;
      const [centerX, centerY] = cellCardOffset(profile, Math.floor(cols / 2), Math.floor(rows / 2));
      state.cardOffsetX = centerX;
      state.cardOffsetY = centerY;
    } else {
      state.cardOffsetX = 0;
      state.cardOffsetY = 0;
    }
    $("#autoAlignStatus").hidden = true;
  }
  updateStudioContract();
  closeSetup();
  $("#changeSetupButton").focus();
  if (profileChanged && state.artImage && state.cardImage) startAlignment("profile changed");
}

document.querySelectorAll('input[name="profile"], input[name="paper"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (input.name === "profile" && state.setupStep === "product") {
      state.setupStep = "paper";
    }
    updateSetupSummary();
    updateSetupWizard();
    if (input.name === "profile") focusVisibleSetupControl();
  });
});
$("#backSetupButton").addEventListener("click", () => {
  state.setupStep = "product";
  updateSetupWizard();
  focusVisibleSetupControl();
});
$("#setupForm").addEventListener("submit", applySetup);
$("#changeSetupButton").addEventListener("click", () => {
  if (!state.alignmentBusy) openSetup();
});
$("#launchGate").addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const focusable = [...$("#launchGate").querySelectorAll("input, button")]
    .filter((item) => !item.disabled && !item.closest("[hidden]"));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  window.requestAnimationFrame(render);
}

function updateQualityNotice() {
  const messages = [
    ...(state.artQuality?.warnings || []),
    ...(state.cardQuality?.warnings || []),
  ];
  const profile = activeProfile();
  if (state.artDimensions) {
    messages.push(classifyEffectiveDpi("Extended artwork", state.artDimensions, profile.master_mm[0]).message);
  }
  if (state.cardDimensions) {
    const cardMm = cardPhysicalMm(profile);
    messages.push(classifyEffectiveDpi("Original card", state.cardDimensions, cardMm[0]).message);
  }
  const notice = $("#qualityNotice");
  const uniqueMessages = [...new Set(messages)];
  if (!uniqueMessages.length) {
    notice.hidden = true;
    notice.textContent = "";
    return;
  }
  notice.textContent = uniqueMessages.join(" ");
  notice.hidden = false;
}

function updateAutoAlignAvailability() {
  const button = $("#autoAlignButton");
  button.disabled = state.alignmentBusy || !(state.artFile && state.cardFile) || Boolean(state.cardQuality?.blocksAlignment);
}

function syncAlignmentControls() {
  $("#zoomRange").value = String(Math.round(state.zoom * 100));
  $("#zoomValue").textContent = `${Math.round(state.zoom * 100)}%`;
}

function currentAlignmentSnapshot(metadata = {}) {
  return snapshotAlignment({
    zoom: state.zoom,
    offsetX: state.offsetX,
    offsetY: state.offsetY,
  }, metadata);
}

function rememberStableAlignment(method = "user-corrected") {
  state.lastStableAlignment = currentAlignmentSnapshot({ method, status: state.alignmentStatus });
  return state.lastStableAlignment;
}

function restoreAlignment(snapshot) {
  if (!snapshot) return;
  const transform = alignmentTransform(snapshot);
  state.zoom = transform.zoom;
  state.offsetX = transform.offsetX;
  state.offsetY = transform.offsetY;
  syncAlignmentControls();
  requestRender();
}

function applyCenterFit() {
  state.baseline = { ...CENTER_FIT_ALIGNMENT, status: "CENTERED_NOT_MATCHED", method: "center-fit" };
  state.zoom = state.baseline.zoom;
  state.offsetX = state.baseline.offsetX;
  state.offsetY = state.baseline.offsetY;
  syncAlignmentControls();
}

function applyReferenceTransform(result) {
  const source = result?.transform && typeof result.transform === "object" ? result.transform : result;
  if (![source?.zoom, source?.offsetX ?? source?.offset_x, source?.offsetY ?? source?.offset_y]
    .every((value) => Number.isFinite(Number(value)))) return false;
  const transform = alignmentTransform(result);
  state.baseline = {
    ...transform,
    status: result.status,
    method: "reference-match",
  };
  restoreAlignment(transform);
  state.lastStableAlignment = { ...transform, status: result.status, method: "reference-match" };
  return true;
}

function updateQualityReport(alignment = state.matcherDiagnostics) {
  const profile = activeProfile();
  const paper = activePaper();
  state.qualityReport = buildQualityReport({
    profile,
    paper,
    artDimensions: state.artDimensions,
    cardDimensions: state.cardDimensions,
    alignment,
    labelBox: profile.name === "psa" || profile.name === "psaMini" ? currentPsaLabelBox() : null,
    cornerRadiusMm: state.cornerRadiusMm,
    currentTransform: currentAlignmentSnapshot(),
    preservedAlignment: Boolean(state.lastStableAlignment),
    exportOptions: {
      includeCard: includeCardRequested(),
      includePieces: $("#includePieces").checked,
      includeMaster: $("#includeMaster").checked,
      includeFullArtPdf: $("#includeFullArtPdf").checked,
      includeWithCardPdf: $("#includeWithCardPdf").checked,
    },
  });
}

function setProgressVisible(visible) {
  $("#alignmentProgress").hidden = !visible;
  document.body.classList.toggle("alignment-busy", visible);
  $(".studio-shell").inert = visible;
  $(".topbar").inert = visible;
  $(".studio-shell").setAttribute("aria-busy", String(visible));
  $(".alignment-progress").setAttribute("aria-busy", String(visible));
  if (visible) window.setTimeout(() => $("#cancelAlignmentButton").focus(), 0);
}

function setExportProgress(event) {
  $("#progressJob").textContent = "PKG";
  $("#progressTitle").textContent = "Creating print package";
  $("#progressMessage").textContent = "The controls are locked while exact-size PDFs and the ZIP are assembled locally.";
  $("#progressStage").textContent = event.stage;
  const roundedProgress = Math.max(0, Math.min(100, Math.round(event.progress || 0)));
  $("#progressPercent").textContent = `${roundedProgress}%`;
  $("#progressBar").style.width = `${roundedProgress}%`;
}

function showAlignmentProgress({ jobId, label, progress }) {
  $("#progressJob").textContent = `JOB ${String(jobId).padStart(4, "0")}`;
  $("#progressTitle").textContent = "Aligning locally";
  $("#progressMessage").textContent = "The controls are locked while the original card and scene are prepared.";
  $("#progressStage").textContent = label;
  const roundedProgress = Math.max(0, Math.min(100, Math.round(progress || 0)));
  $("#progressPercent").textContent = `${roundedProgress}%`;
  $("#progressBar").style.width = `${roundedProgress}%`;
}

function alignmentUserMessage(result) {
  const status = result?.status;
  const evidence = alignmentEvidence(result).join(" ");
  const evidenceText = evidence ? ` Evidence: ${evidence}` : "";
  const reason = sanitizeDiagnosticText(result?.reason);
  const rejection = result?.rejectionClassification
    || result?.diagnostics?.rejectionClassification
    || result?.diagnostics?.compatibility?.rejectionReason;
  if (status === ALIGNMENT_STATUSES.APPLIED) {
    return `Reference match applied.${evidenceText} Inspect the card edges and fine-tune if needed.`;
  }
  if (status === ALIGNMENT_STATUSES.UNCERTAIN) {
    if (rejection === "INSUFFICIENT_OVERSCAN") {
      return `${reason || "Card artwork was found, but the image needs more surrounding artwork."} The current alignment was kept; use a scene with the required surrounding canvas before printing.`;
    }
    if (typeof rejection === "string" && rejection.endsWith("_BEYOND_RENDERER_CONTRACT")) {
      return `${reason || "Card artwork was found, but its geometry is incompatible with the zoom-and-translation renderer."} The current alignment was kept.`;
    }
    return `Automatic reference matching was inconclusive.${evidenceText} Manual correction is required; the current alignment was kept.`;
  }
  if (status === ALIGNMENT_STATUSES.TIMED_OUT) {
    return `Reference matching timed out.${reason ? ` ${reason}.` : ""} The current alignment was kept; retry or continue manually.`;
  }
  if (status === ALIGNMENT_STATUSES.CANCELLED) {
    return "Alignment cancelled. The current alignment was kept; retry or continue manually.";
  }
  return `Reference matching failed.${reason ? ` ${reason}.` : ""} The current alignment was kept; retry or continue manually.`;
}

function setAlignmentStatus(result, { toast = true } = {}) {
  state.alignmentStatus = result.status;
  state.matcherDiagnostics = result;
  updateQualityReport(result);
  const status = $("#autoAlignStatus");
  status.dataset.alignmentStatus = result.status;
  status.textContent = alignmentUserMessage(result);
  status.classList.toggle("low", result.status !== ALIGNMENT_STATUSES.APPLIED);
  status.hidden = false;
  if (toast) {
    showToast(result.status === ALIGNMENT_STATUSES.APPLIED
      ? "Reference match applied."
      : result.status === ALIGNMENT_STATUSES.UNCERTAIN
        ? alignmentUserMessage(result)
        : alignmentUserMessage(result));
  }
}

function finishAlignmentCancel(details = {}) {
  if (!state.alignmentBusy) return;
  restoreAlignment(state.alignmentSnapshot);
  state.alignmentRequestId += 1;
  state.alignmentBusy = false;
  state.alignmentRestartPending = false;
  state.alignmentJobId = details.jobId || state.alignmentJobId;
  activeAlignmentContext = null;
  const result = normalizeAlignmentResult({
    ...details,
    status: ALIGNMENT_STATUSES.CANCELLED,
    accepted: false,
    reason: details.reason || "Cancellation requested by caller.",
    preservedAlignment: Boolean(state.lastStableAlignment),
  });
  setAlignmentStatus(result);
  $("#autoAlignButton").classList.remove("is-loading");
  setProgressVisible(false);
  updateAutoAlignAvailability();
  window.setTimeout(() => $("#autoAlignButton").focus(), 0);
}

function finishAlignmentError(error, jobId = 0) {
  if (jobId && state.alignmentJobId && jobId !== state.alignmentJobId) return;
  if (jobId && activeAlignmentContext?.jobId && jobId !== activeAlignmentContext.jobId) return;
  if (!state.alignmentBusy) return;
  restoreAlignment(state.alignmentSnapshot);
  const candidateStatus = error?.status || error?.resultStatus || error?.result_status
    || (/timed?\s*out|timeout/i.test(error?.message || "") ? ALIGNMENT_STATUSES.TIMED_OUT : ALIGNMENT_STATUSES.FAILED);
  const knownStatus = [ALIGNMENT_STATUSES.TIMED_OUT, ALIGNMENT_STATUSES.FAILED, ALIGNMENT_STATUSES.CANCELLED]
    .includes(candidateStatus) ? candidateStatus : ALIGNMENT_STATUSES.FAILED;
  if (knownStatus === ALIGNMENT_STATUSES.CANCELLED) {
    finishAlignmentCancel({ jobId, reason: error?.reason });
    return;
  }
  state.alignmentBusy = false;
  state.alignmentRequestId += 1;
  state.alignmentRestartPending = false;
  state.alignmentJobId = jobId || state.alignmentJobId;
  activeAlignmentContext = null;
  const result = normalizeAlignmentResult({
    status: knownStatus,
    accepted: false,
    jobId: jobId || state.alignmentJobId,
    stage: error?.stage,
    stageVersion: error?.stageVersion,
    reason: error?.reason || error?.originalMessage || error?.message || "The local matcher failed.",
    preservedAlignment: Boolean(state.lastStableAlignment),
  });
  setAlignmentStatus(result);
  $("#autoAlignButton").classList.remove("is-loading");
  setProgressVisible(false);
  updateAutoAlignAvailability();
}

const matcherRunner = createMatcherJobRunner({
  onProgress: (event) => {
    if (event.jobId !== state.alignmentJobId) return;
    showAlignmentProgress(event);
  },
  onComplete: (result) => {
    const context = activeAlignmentContext;
    if (!context || result.jobId !== state.alignmentJobId || result.jobId !== context.jobId
      || context.requestId !== state.alignmentRequestId || !generationsReady(context.generations)) return;
    const normalized = normalizeAlignmentResult(result, { preservedAlignment: Boolean(state.lastStableAlignment) });
    const preserved = context.preserved;
    if (normalized.status === ALIGNMENT_STATUSES.APPLIED && !applyReferenceTransform(normalized)) {
      normalized.status = ALIGNMENT_STATUSES.FAILED;
      normalized.resultStatus = ALIGNMENT_STATUSES.FAILED;
      normalized.accepted = false;
      normalized.reason = "The matcher applied no readable transform.";
    } else if (normalized.status !== ALIGNMENT_STATUSES.APPLIED) {
      restoreAlignment(preserved);
      if (!state.lastStableAlignment) {
        state.lastStableAlignment = { ...preserved, status: "CENTERED_NOT_MATCHED", method: "center-fit" };
      }
    }
    state.alignmentBusy = false;
    state.lastCompletedJobId = result.jobId;
    state.alignmentSnapshot = null;
    state.alignmentJobId = result.jobId;
    activeAlignmentContext = null;
    setAlignmentStatus({
      ...normalized,
      preservedAlignment: Boolean(state.lastStableAlignment),
    }, { toast: true });
    $("#autoAlignButton").classList.remove("is-loading");
    setProgressVisible(false);
    $("#proofButton").disabled = ![ALIGNMENT_STATUSES.APPLIED, ALIGNMENT_STATUSES.UNCERTAIN]
      .includes(normalized.status);
    updateAutoAlignAvailability();
    updateExportSummary();
    requestRender();
    window.setTimeout(() => $("#proofButton").focus(), 0);
  },
  onCancel: (details) => {
    if (!suppressMatcherLifecycle) finishAlignmentCancel(details);
  },
  onError: finishAlignmentError,
});

$("#alignmentProgress").addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  event.preventDefault();
  $("#cancelAlignmentButton").focus();
});

async function cloneForMatcher(image) {
  if (typeof createImageBitmap === "function" && typeof OffscreenCanvas !== "undefined") {
    return createImageBitmap(image);
  }
  const { width: sourceWidth, height: sourceHeight } = imageSize(image);
  if (!sourceWidth || !sourceHeight) {
    throw new Error("This browser could not read the image dimensions for local matching.");
  }
  const scale = Math.min(1, 1200 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const fallbackCanvas = document.createElement("canvas");
  fallbackCanvas.width = width;
  fallbackCanvas.height = height;
  const fallbackContext = fallbackCanvas.getContext("2d", { alpha: false, colorSpace: "srgb" })
    || fallbackCanvas.getContext("2d", { alpha: false });
  if (!fallbackContext) {
    throw new Error("This browser cannot prepare pixels for local reference matching. You can still align manually.");
  }
  fallbackContext.drawImage(image, 0, 0, width, height);
  return {
    width,
    height,
    sourceWidth,
    sourceHeight,
    pixelFormat: "rgba",
    data: fallbackContext.getImageData(0, 0, width, height).data,
  };
}

function generationsReady(generations = { art: intakeGeneration.art, card: intakeGeneration.card }) {
  return Boolean(state.artImage && state.cardImage)
    && intakeDecodedGeneration.art === generations.art
    && intakeDecodedGeneration.card === generations.card
    && intakeGeneration.art === generations.art
    && intakeGeneration.card === generations.card;
}

function cancelMatcherForTransition(reason) {
  state.alignmentRequestId += 1;
  const previous = suppressMatcherLifecycle;
  suppressMatcherLifecycle = true;
  try {
    matcherRunner.cancel(reason);
  } finally {
    suppressMatcherLifecycle = previous;
  }
  state.alignmentJobId = 0;
  activeAlignmentContext = null;
}

function queueAlignmentRestart(reason) {
  if (!state.alignmentBusy) return;
  state.alignmentRestartPending = true;
  state.alignmentRestartReason = reason;
  state.alignmentStatus = "RUNNING";
  cancelMatcherForTransition(reason);
  showAlignmentProgress({ jobId: 0, label: `Waiting for ${reason}`, progress: 0 });
}

function maybeStartAlignment(reason = "both images ready") {
  const generations = { art: intakeGeneration.art, card: intakeGeneration.card };
  if (!(state.artImage && state.cardImage) || state.cardQuality?.blocksAlignment) return;
  if (!generationsReady(generations)) return;
  if (state.alignmentBusy) {
    if (state.alignmentRestartPending) {
      state.alignmentRestartPending = false;
      startAlignment(state.alignmentRestartReason || reason);
    }
    return;
  }
  startAlignment(reason);
}

async function startAlignment(reason = "both images ready") {
  if (!(state.artFile && state.cardFile) || state.cardQuality?.blocksAlignment) return;
  if (state.alignmentBusy) cancelMatcherForTransition("A newer alignment request replaced this one.");
  const requestId = state.alignmentRequestId + 1;
  state.alignmentRequestId = requestId;
  const generations = { art: intakeGeneration.art, card: intakeGeneration.card };
  const preserved = currentAlignmentSnapshot({
    method: state.lastStableAlignment?.method || "user-corrected",
    status: state.alignmentStatus,
  });
  state.alignmentSnapshot = preserved;
  if (!state.baseline) state.baseline = { ...preserved, status: "CENTERED_NOT_MATCHED", method: "center-fit" };
  state.alignmentBusy = true;
  state.alignmentStatus = "RUNNING";
  state.matcherDiagnostics = null;
  state.qualityReport = null;
  state.alignmentJobId = 0;
  state.alignmentSourceGenerations = generations;
  state.alignmentRestartPending = false;
  activeAlignmentContext = { requestId, generations, preserved, jobId: 0 };
  $("#autoAlignStatus").hidden = true;
  $("#autoAlignButton").classList.add("is-loading");
  updateAutoAlignAvailability();
  showAlignmentProgress({ jobId: 0, label: `Preparing ${reason}`, progress: 0 });
  setProgressVisible(true);
  let matchArt;
  let matchCard;
  try {
    [matchArt, matchCard] = await Promise.all([
      cloneForMatcher(state.artImage),
      cloneForMatcher(state.cardImage),
    ]);
    if (!state.alignmentBusy || requestId !== state.alignmentRequestId || !generationsReady(generations)) {
      releaseImage(matchArt);
      releaseImage(matchCard);
      return;
    }
    const jobId = matcherRunner.start({
      artImage: matchArt,
      cardImage: matchCard,
      profile: activeProfile(),
      baseline: preserved,
      profileVersion: PROFILE_VERSION,
    });
    if (!state.alignmentBusy || requestId !== state.alignmentRequestId) {
      releaseImage(matchArt);
      releaseImage(matchCard);
      return;
    }
    state.alignmentJobId = jobId;
    if (activeAlignmentContext) activeAlignmentContext.jobId = jobId;
    showAlignmentProgress({ jobId, label: "Starting reference matcher", progress: 0 });
  } catch (error) {
    releaseImage(matchArt);
    releaseImage(matchCard);
    if (requestId === state.alignmentRequestId) finishAlignmentError(error);
  }
}

$("#cancelAlignmentButton").addEventListener("click", () => {
  if (state.exportBusy) {
    exportController?.abort();
    return;
  }
  if (!matcherRunner.cancel()) finishAlignmentCancel();
  $("#autoAlignButton").classList.remove("is-loading");
});
$("#autoAlignButton").addEventListener("click", () => startAlignment("manual retry"));

function setPreview(kind, file) {
  const key = `${kind}PreviewUrl`;
  state[key] = replacePreviewUrl(state[key], file);
  const preview = $(`#${kind}Preview`);
  preview.src = state[key];
  preview.hidden = false;
}

async function loadFile(kind, file) {
  if (!file || state.exportBusy) return;
  if (state.alignmentBusy) queueAlignmentRestart(`${kind} replacement`);
  const generation = ++intakeGeneration[kind];
  try {
    const decoded = await readImage(file, kind);
    if (generation !== intakeGeneration[kind]) {
      releaseImage(decoded.image);
      return;
    }
    const oldImage = state[`${kind}Image`];
    releaseImage(oldImage);
    state[`${kind}File`] = file;
    state[`${kind}Image`] = decoded.image;
    state[`${kind}Quality`] = decoded;
    state[`${kind}Dimensions`] = { width: decoded.width, height: decoded.height };
    intakeDecodedGeneration[kind] = generation;
    state.lastCompletedJobId = 0;
    state.matcherDiagnostics = null;
    state.qualityReport = null;
    setPreview(kind, file);
    $(`#${kind}Meta`).textContent = fileSummary(file, decoded);
    $(`#${kind}Drop`).classList.add("loaded");
    if (kind === "art") {
      $("#emptyState").hidden = true;
    }
    state.alignmentStatus = "NEEDS_REFERENCE";
    $("#proofButton").disabled = true;
    $("#autoAlignStatus").hidden = true;
    updateQualityNotice();
    updateAutoAlignAvailability();
    updateExportSummary();
    requestRender();
    if (state.cardQuality?.blocksAlignment) {
      if (state.alignmentBusy) {
        finishAlignmentError({
          status: ALIGNMENT_STATUSES.FAILED,
          reason: state.cardQuality.blockingIssues.join(" "),
        });
      } else {
        $("#autoAlignStatus").textContent = state.cardQuality.blockingIssues.join(" ");
        $("#autoAlignStatus").classList.add("low");
        $("#autoAlignStatus").hidden = false;
      }
    } else {
      maybeStartAlignment("both images ready");
    }
  } catch (error) {
    if (generation === intakeGeneration[kind] && state.alignmentBusy) {
      finishAlignmentError({
        status: ALIGNMENT_STATUSES.FAILED,
        reason: `The ${kind} image could not be decoded; the current alignment was kept.`,
      });
    } else {
      showToast(sanitizeDiagnosticText(error?.message) || "The image could not be decoded.");
    }
  }
}

function bindDropZone(zoneSelector, inputSelector, kind) {
  const zone = $(zoneSelector);
  const input = $(inputSelector);
  input.addEventListener("change", () => loadFile(kind, input.files[0]));
  ["dragenter", "dragover"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (!state.alignmentBusy) zone.classList.add("dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    zone.addEventListener(eventName, () => zone.classList.remove("dragging"));
  });
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    if (state.alignmentBusy) return;
    const file = event.dataTransfer.files[0];
    if (file) loadFile(kind, file);
  });
}

bindDropZone("#artDrop", "#artInput", "art");
bindDropZone("#cardDrop", "#cardInput", "card");

function render() {
  renderQueued = false;
  const profile = activeProfile();
  const rect = shell.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const result = drawAlignmentScene({
    context: ctx,
    width: rect.width,
    height: rect.height,
    profile,
    state,
    artImage: state.artImage,
    cardImage: state.cardImage,
    includeCard: includeCardRequested(),
    labelBox: profile.name === "psa" || profile.name === "psaMini" ? currentPsaLabelBox() : null,
  });
  state.offsetX = result.offsetX;
  state.offsetY = result.offsetY;
  const xPixels = Math.round(state.offsetX * profile.master_px[0]);
  const yPixels = Math.round(state.offsetY * profile.master_px[1]);
  $("#offsetValue").textContent = `X ${xPixels} / Y ${yPixels}`;
}

function resetAlignment(announce = true, remember = true) {
  const baseline = state.baseline || CENTER_FIT_ALIGNMENT;
  restoreAlignment(baseline);
  const profile = activeProfile();
  if (profile.piece_count > 1) {
    const [cols, rows] = profile.grid;
    const [centerX, centerY] = cellCardOffset(profile, Math.floor(cols / 2), Math.floor(rows / 2));
    state.cardOffsetX = centerX;
    state.cardOffsetY = centerY;
  } else {
    state.cardOffsetX = 0;
    state.cardOffsetY = 0;
  }
  syncCardPositionControls();
  if (remember) rememberStableAlignment("user-corrected");
  if (announce) showToast("Artwork fit to the full page.");
}

shell.addEventListener("pointerdown", (event) => {
  if (state.alignmentBusy || !state.artImage) return;
  state.dragging = true;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  shell.setPointerCapture(event.pointerId);
});
shell.addEventListener("pointermove", (event) => {
  if (state.alignmentBusy || !state.dragging) return;
  const rect = shell.getBoundingClientRect();
  state.offsetX += (event.clientX - state.pointerX) / rect.width;
  state.offsetY += (event.clientY - state.pointerY) / rect.height;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  rememberStableAlignment("user-corrected");
  requestRender();
});
["pointerup", "pointercancel"].forEach((eventName) => {
  shell.addEventListener(eventName, () => { state.dragging = false; });
});
shell.addEventListener("wheel", (event) => {
  if (state.alignmentBusy || !state.artImage) return;
  event.preventDefault();
  const direction = event.deltaY > 0 ? -0.03 : 0.03;
  state.zoom = Math.min(2.5, Math.max(1, state.zoom + direction));
  const percent = Math.round(state.zoom * 100);
  $("#zoomRange").value = String(percent);
  $("#zoomValue").textContent = `${percent}%`;
  rememberStableAlignment("user-corrected");
  requestRender();
}, { passive: false });

function nudge(dx, dy, amount = 1) {
  if (state.alignmentBusy) return;
  const profile = activeProfile();
  state.offsetX += (dx * amount) / profile.master_px[0];
  state.offsetY += (dy * amount) / profile.master_px[1];
  rememberStableAlignment("user-corrected");
  requestRender();
}

shell.addEventListener("keydown", (event) => {
  const moves = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  if (state.alignmentBusy || !moves[event.key]) return;
  event.preventDefault();
  const amount = event.shiftKey ? 10 : 1;
  nudge(moves[event.key][0], moves[event.key][1], amount);
});
document.querySelectorAll("[data-nudge]").forEach((button) => {
  button.addEventListener("click", () => {
    const values = button.dataset.nudge.split(",").map(Number);
    nudge(values[0], values[1], 4);
  });
});
$("#resetButton").addEventListener("click", () => resetAlignment());

// Card position cell picker (binders only — UI is hidden otherwise).
// Each of the 9 buttons snaps the original card to that binder cell and the
// export cutout follows. The on-screen reference chamber stays anchored.
function setCardCell(col, row) {
  const profile = activeProfile();
  if (!profile || !profile.piece_count || profile.piece_count <= 1) return;
  const [offsetX, offsetY] = cellCardOffset(profile, col, row);
  state.cardOffsetX = offsetX;
  state.cardOffsetY = offsetY;
  syncCardPositionControls();
  showToast(`Card snapped to ${cellName(col, row)}.`);
}
function syncCardPositionControls() {
  const profile = activeProfile();
  if (!profile) return;
  const [col, row] = cellFromCardOffset(profile, state.cardOffsetX, state.cardOffsetY);
  document.querySelectorAll("#cardCellPicker [data-card-cell]").forEach((button) => {
    const [bcol, brow] = button.dataset.cardCell.split(",").map(Number);
    const selected = bcol === col && brow === row;
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  const cellLabel = $("#cardCellLabel");
  if (cellLabel) cellLabel.textContent = cellName(col, row);
  const cellReadout = $("#cardOffsetValue");
  if (cellReadout) cellReadout.textContent = `col ${col} / row ${row}`;
  requestRender();
}
document.querySelectorAll("#cardCellPicker [data-card-cell]").forEach((button) => {
  button.addEventListener("click", () => {
    const [col, row] = button.dataset.cardCell.split(",").map(Number);
    setCardCell(col, row);
  });
});
$("#resetCardPosition")?.addEventListener("click", () => {
  const profile = activeProfile();
  if (!profile) return;
  const [cols, rows] = profile.grid;
  setCardCell(Math.floor(cols / 2), Math.floor(rows / 2));
  showToast("Card position reset to center.");
});

$("#zoomRange").addEventListener("input", (event) => {
  if (state.alignmentBusy) return;
  state.zoom = Number(event.target.value) / 100;
  $("#zoomValue").textContent = `${event.target.value}%`;
  rememberStableAlignment("user-corrected");
  requestRender();
});
$("#opacityRange").addEventListener("input", (event) => {
  if (state.alignmentBusy) return;
  state.opacity = Number(event.target.value) / 100;
  $("#opacityValue").textContent = `${event.target.value}%`;
  requestRender();
});
$("#radiusRange").addEventListener("input", (event) => {
  if (state.alignmentBusy) return;
  state.cornerRadiusMm = Number(event.target.value);
  $("#radiusValue").textContent = `${cleanMeasure(state.cornerRadiusMm)} mm`;
  requestRender();
});

function updatePsaLabelDimensions() {
  if (state.alignmentBusy) return;
  const widthInput = $("#psaLabelWidth");
  const heightInput = $("#psaLabelHeight");
  if (!(widthInput.checkValidity() && heightInput.checkValidity())) return;
  state.psaLabelWidthMm = Number(widthInput.value);
  state.psaLabelHeightMm = Number(heightInput.value);
  $(".dimension-hint").textContent = `${(state.psaLabelWidthMm / 25.4).toFixed(2)} × ${(state.psaLabelHeightMm / 25.4).toFixed(2)} in · ${Math.round(state.psaLabelWidthMm / 25.4 * 300)} × ${Math.round(state.psaLabelHeightMm / 25.4 * 300)} px at 300 DPI`;
  requestRender();
}
$("#psaLabelWidth").addEventListener("input", updatePsaLabelDimensions);
$("#psaLabelHeight").addEventListener("input", updatePsaLabelDimensions);

function bindToggle(selector, stateKey) {
  $(selector).addEventListener("click", (event) => {
    if (state.alignmentBusy) return;
    state[stateKey] = !state[stateKey];
    event.currentTarget.classList.toggle("active", state[stateKey]);
    event.currentTarget.setAttribute("aria-pressed", String(state[stateKey]));
    requestRender();
  });
}
bindToggle("#gridToggle", "showGrid");
bindToggle("#cardToggle", "showCard");
bindToggle("#differenceToggle", "difference");

function choosePaper(paperName) {
  if (state.alignmentBusy || !(paperName in state.papers)) return;
  state.paper = paperName;
  const setupChoice = document.querySelector(`input[name="paper"][value="${paperName}"]`);
  if (setupChoice) setupChoice.checked = true;
  updateSetupSummary();
  updateStudioContract();
  if (state.matcherDiagnostics) updateQualityReport();
}
$("#a4PaperTool").addEventListener("click", () => choosePaper("a4"));
$("#letterPaperTool").addEventListener("click", () => choosePaper("letter"));
$("#includeCard").addEventListener("change", (event) => {
  if (state.alignmentBusy) {
    event.currentTarget.checked = false;
    return;
  }
  if (state.matcherDiagnostics) updateQualityReport();
  requestRender();
});
$("#exitAppButton").addEventListener("click", () => {
  if (!state.alignmentBusy) window.location.reload();
});
["#includeSecondPaper", "#includePieces", "#includeMaster", "#includeFullArtPdf", "#includeWithCardPdf"].forEach((selector) => {
  $(selector).addEventListener("change", (event) => {
    if (state.alignmentBusy) {
      event.currentTarget.checked = false;
      return;
    }
    updateExportSummary();
    if (state.matcherDiagnostics) updateQualityReport();
  });
});
$("#exportButton").addEventListener("click", async () => {
  if (state.alignmentBusy || state.exportBusy) return;
  if (!(state.artImage && state.cardImage)) return;
  if (state.qualityReport?.overallStatus === "BLOCKED") {
    showToast("Resolve the blocked source-quality warning before exporting.");
    return;
  }
  state.exportBusy = true;
  state.alignmentBusy = true;
  exportController = new AbortController();
  updateExportSummary();
  setProgressVisible(true);
  setExportProgress({ stage: "Preparing package", progress: 0 });
  try {
    const { createBrowserPrintPackage } = await import("./src/export.js");
    const result = await createBrowserPrintPackage({
      state,
      profile: activeProfile(),
      paper: activePaper(),
      exportOptions: {
        includeSecondPaper: $("#includeSecondPaper").checked,
        includePieces: $("#includePieces").checked,
        includeMaster: $("#includeMaster").checked,
        includeFullArtPdf: $("#includeFullArtPdf").checked,
        includeWithCardPdf: $("#includeWithCardPdf").checked,
        includeCard: includeCardRequested(),
      },
      documentRef: document,
      signal: exportController.signal,
      onProgress: setExportProgress,
    });
    if (state.packageUrl) URL.revokeObjectURL(state.packageUrl);
    const packageBlob = new Blob([result.bytes], { type: "application/zip" });
    state.packageUrl = URL.createObjectURL(packageBlob);
    $("#resultName").textContent = result.filename;
    $("#resultNotes").textContent = `${result.entries.length} files · ${Math.round(result.bytes.byteLength / 1024)} KB · ${result.qualityReport.overallStatus}`;
    const download = $("#downloadButton");
    download.href = state.packageUrl;
    download.download = result.filename;
    $("#resultPanel").hidden = false;
    triggerDownload(packageBlob, result.filename);
    showToast("Print package created and downloaded.");
  } catch (error) {
    if (error.name === "AbortError") showToast("Package export cancelled.");
    else showToast(error.message || "The print package could not be created.");
  } finally {
    exportController = null;
    state.exportBusy = false;
    state.alignmentBusy = false;
    setProgressVisible(false);
    updateAutoAlignAvailability();
    updateExportSummary();
    $("#exportButton").focus();
  }
});

function proofName() {
  const base = (state.artFile?.name || "extended-art").replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "extended-art";
  return `${base}_${state.profile}_alignment_proof_300dpi.png`;
}

function canvasBlob(source) {
  return new Promise((resolve, reject) => {
    source.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The proof image could not be encoded.")), "image/png");
  });
}

async function downloadProof() {
  if (!(state.artImage && state.lastCompletedJobId)) return;
  const button = $("#proofButton");
  button.disabled = true;
  try {
    const profile = activeProfile();
    const proofCanvas = document.createElement("canvas");
    proofCanvas.width = profile.master_px[0];
    proofCanvas.height = profile.master_px[1];
    const proofContext = proofCanvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
    drawArtworkProof({ context: proofContext, width: proofCanvas.width, height: proofCanvas.height, state, artImage: state.artImage });
    const encoded = await canvasBlob(proofCanvas);
    const output = await withPrintMetadata(encoded, 300);
    triggerDownload(output, proofName());
    showToast(`Proof exported at ${pixelPair(profile.master_px)} px with 300-DPI metadata.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}
$("#proofButton").addEventListener("click", downloadProof);

new ResizeObserver(requestRender).observe(shell);
window.addEventListener("resize", requestRender);
window.addEventListener("beforeunload", () => {
  ["art", "card"].forEach((kind) => {
    const previewUrl = state[`${kind}PreviewUrl`];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    releaseImage(state[`${kind}Image`]);
  });
  if (state.packageUrl) URL.revokeObjectURL(state.packageUrl);
});
updateSetupSummary();
updateStudioContract();
openSetup();
