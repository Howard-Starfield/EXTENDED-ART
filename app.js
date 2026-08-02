import {
  cleanMeasure,
  cardPhysicalMm,
  fallbackPapers,
  fallbackProfiles,
  PROFILE_VERSION,
  paperFit,
  pixelPair,
  profileSummary,
  psaLabelBox as makePsaLabelBox,
} from "./src/profiles.js";
import { createInitialState, imageSize, releaseImage } from "./src/state.js";
import { fileSummary, readImage, replacePreviewUrl } from "./src/image-io.js";
import { classifyEffectiveDpi } from "./src/quality.js";
import { buildQualityReport } from "./src/quality-report.js";
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
const intakeGeneration = { art: 0, card: 0 };

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
  const profile = state.profiles[profileName] || fallbackProfiles[profileName];
  const paper = state.papers[paperName] || fallbackPapers[paperName];
  if (!(profile && paper)) return;
  $("#setupSummaryName").textContent = profile.label;
  $("#setupSummaryPixels").textContent = `${pixelPair(profile.master_px)} px`;
  $("#setupSummarySize").textContent = `${cleanMeasure(profile.master_mm[0])} × ${cleanMeasure(profile.master_mm[1])} mm`;
  $("#setupSummaryPackage").textContent = profileSummary(profile, paper);
}

function updateExportSummary() {
  const selected = [
    $("#includePieces").checked ? "piece PNGs" : "",
    $("#includeMaster").checked ? "master PNG" : "",
    $("#includeFullArtPdf").checked ? "full-art PDF" : "",
    $("#includeWithCardPdf").checked ? "with-card PDF" : "",
  ].filter(Boolean);
  $("#exportButtonCopy").textContent = selected.length
    ? `${selected.join(", ")} · final PDF + ZIP engine next`
    : "Final PDF + ZIP engine is the next milestone";
}

function updatePaperTools() {
  const profile = activeProfile();
  [
    ["a4", "#a4PaperTool", "#a4Fit"],
    ["letter", "#letterPaperTool", "#letterFit"],
  ].forEach(([paperName, buttonSelector, fitSelector]) => {
    const paper = state.papers[paperName] || fallbackPapers[paperName];
    const fit = paperFit(profile, paperName, state.papers);
    const selected = state.paper === paperName;
    const percent = fit.scale < 0.9995 ? `${(fit.scale * 100).toFixed(1)}%` : "100%";
    const dimensions = paper.size_mm.map(cleanMeasure).join("×");
    const button = $(buttonSelector);
    button.classList.toggle("active", selected);
    button.classList.toggle("scaled", fit.scale < 0.9995);
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("aria-label", `${paper.label} ${dimensions} millimetres, output at ${percent}`);
    button.title = `${paper.label}: ${dimensions} mm | output ${percent}`;
    $(fitSelector).textContent = `${dimensions} · ${percent}`;
  });
}

function updateSetupWizard() {
  const productStep = state.setupStep === "product";
  $("#setupProductStep").hidden = !productStep;
  $("#setupPaperStep").hidden = productStep;
  $("#setupStepLabel").textContent = productStep ? "Step 1 of 2" : "Step 2 of 2";
  $("#launchTitle").textContent = productStep ? "What are we making today?" : "Choose your paper size";
  const description = $("#launchTitle").parentElement.querySelector("p:last-child");
  description.textContent = productStep
    ? "Choose the physical object first. Every crop, guide and export will follow it."
    : "Pick the first sheet for this package. You can add the other paper size during final export.";
  const selectedProduct = document.querySelector('input[name="profile"]:checked');
  const selectedPaper = document.querySelector('input[name="paper"]:checked');
  $("#continueSetupButton").disabled = !selectedProduct;
  $("#startStudioButton").disabled = !selectedPaper;
}

function updateStudioContract() {
  const profile = activeProfile();
  const paper = activePaper();
  const isBinder = profile.grid[0] > 1;
  shell.style.aspectRatio = `${profile.master_px[0]} / ${profile.master_px[1]}`;
  shell.classList.toggle("photo-frame-mode", profile.name === "photo8x10");
  $("#frameModeBadge").hidden = profile.name !== "photo8x10";
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
  $("#paperContract").textContent = `${paper.label} / 300 DPI`;
  $("#includeCardHelp").textContent = "Off by default to save ink; the cut-ready package leaves the center/card chamber empty.";
  $("#cutReadyOutputHelp").textContent = profile.name === "psa"
    ? "White PSA label + card chambers with dotted guides"
    : "Finished outer pieces with cut guides";
  $("#psaLabelControls").hidden = profile.name !== "psa";
  updatePaperTools();
  updateExportSummary();
  updateQualityNotice();
  requestRender();
}

function focusVisibleSetupControl() {
  const control = state.setupStep === "product"
    ? document.querySelector('input[name="profile"]:checked')
    : document.querySelector('input[name="paper"]:checked');
  window.setTimeout(() => control?.focus(), 0);
}

function openSetup() {
  state.setupStep = "product";
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
    resetAlignment(false);
    $("#autoAlignStatus").hidden = true;
  }
  updateStudioContract();
  closeSetup();
  $("#changeSetupButton").focus();
  if (state.artImage && state.cardImage) startAlignment("setup changed");
}

document.querySelectorAll('input[name="profile"], input[name="paper"]').forEach((input) => {
  input.addEventListener("change", () => {
    updateSetupSummary();
    updateSetupWizard();
  });
});
$("#continueSetupButton").addEventListener("click", () => {
  state.setupStep = "paper";
  updateSetupSummary();
  updateSetupWizard();
  focusVisibleSetupControl();
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

function applyCenterFit() {
  state.baseline = { ...CENTER_FIT_ALIGNMENT, method: "center-fit" };
  state.zoom = state.baseline.zoom;
  state.offsetX = state.baseline.offsetX;
  state.offsetY = state.baseline.offsetY;
  $("#zoomRange").value = "100";
  $("#zoomValue").textContent = "100%";
}

function applyReferenceTransform(result) {
  state.baseline = {
    zoom: result.zoom,
    offsetX: result.offsetX,
    offsetY: result.offsetY,
    status: result.status,
    method: "reference-match",
  };
  state.zoom = result.zoom;
  state.offsetX = result.offsetX;
  state.offsetY = result.offsetY;
  $("#zoomRange").value = String(Math.round(result.zoom * 100));
  $("#zoomValue").textContent = `${Math.round(result.zoom * 100)}%`;
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
    labelBox: profile.name === "psa" ? currentPsaLabelBox() : null,
    cornerRadiusMm: state.cornerRadiusMm,
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

function showAlignmentProgress({ jobId, label, progress }) {
  $("#progressJob").textContent = `JOB ${String(jobId).padStart(4, "0")}`;
  $("#progressTitle").textContent = "Aligning locally";
  $("#progressMessage").textContent = "The controls are locked while the original card and scene are prepared.";
  $("#progressStage").textContent = label;
  const roundedProgress = Math.max(0, Math.min(100, Math.round(progress || 0)));
  $("#progressPercent").textContent = `${roundedProgress}%`;
  $("#progressBar").style.width = `${roundedProgress}%`;
}

function finishAlignmentCancel(message = "Alignment cancelled. Upload both images or run it again when ready.") {
  if (!state.alignmentBusy) return;
  state.alignmentRequestId += 1;
  state.alignmentBusy = false;
  state.alignmentStatus = "CANCELLED";
  $("#autoAlignStatus").dataset.alignmentStatus = "CANCELLED";
  $("#autoAlignButton").classList.remove("is-loading");
  setProgressVisible(false);
  updateAutoAlignAvailability();
  $("#autoAlignStatus").textContent = message;
  $("#autoAlignStatus").classList.add("low");
  $("#autoAlignStatus").hidden = false;
  window.setTimeout(() => $("#autoAlignButton").focus(), 0);
}

function finishAlignmentError(error, jobId = 0) {
  if (jobId && state.alignmentJobId && jobId !== state.alignmentJobId) return;
  state.alignmentBusy = false;
  state.alignmentStatus = "ERROR";
  $("#autoAlignStatus").dataset.alignmentStatus = "ERROR";
  $("#autoAlignButton").classList.remove("is-loading");
  setProgressVisible(false);
  updateAutoAlignAvailability();
  $("#autoAlignStatus").textContent = `Alignment failed: ${error.message || "try again when both images are ready."}`;
  $("#autoAlignStatus").classList.add("low");
  $("#autoAlignStatus").hidden = false;
  showToast(error.message || "Alignment could not be completed.");
}

const matcherRunner = createMatcherJobRunner({
  onProgress: (event) => {
    if (event.jobId !== state.alignmentJobId) return;
    showAlignmentProgress(event);
  },
  onComplete: (result) => {
    if (result.jobId !== state.alignmentJobId) return;
    state.alignmentBusy = false;
    state.lastCompletedJobId = result.jobId;
    state.alignmentStatus = result.status;
    state.matcherDiagnostics = result;
    updateQualityReport(result);
    $("#autoAlignStatus").dataset.alignmentStatus = result.status;
    $("#autoAlignButton").classList.remove("is-loading");
    if (result.accepted) applyReferenceTransform(result);
    else if (!state.baseline) applyCenterFit();
    setProgressVisible(false);
    $("#autoAlignStatus").textContent = result.accepted
      ? "Reference match applied - inspect the card edges and fine-tune if needed."
      : "No reliable automatic match - inspect and align manually.";
    $("#autoAlignStatus").classList.toggle("low", !result.accepted);
    $("#autoAlignStatus").hidden = false;
    $("#proofButton").disabled = false;
    updateAutoAlignAvailability();
    requestRender();
    window.setTimeout(() => $("#proofButton").focus(), 0);
    showToast(result.accepted ? "Reference match applied." : "No reliable match; center-fit baseline retained.");
  },
  onCancel: () => finishAlignmentCancel(),
  onError: finishAlignmentError,
});

$("#alignmentProgress").addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  event.preventDefault();
  $("#cancelAlignmentButton").focus();
});

async function cloneForMatcher(image) {
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot run local reference matching. You can still align the scene manually.");
  }
  return createImageBitmap(image);
}

async function startAlignment(reason = "both images ready") {
  if (!(state.artFile && state.cardFile) || state.cardQuality?.blocksAlignment) return;
  if (state.alignmentBusy) matcherRunner.cancel();
  const requestId = state.alignmentRequestId + 1;
  state.alignmentRequestId = requestId;
  state.alignmentBusy = true;
  state.alignmentStatus = "RUNNING";
  state.matcherDiagnostics = null;
  state.qualityReport = null;
  state.alignmentJobId = 0;
  applyCenterFit();
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
    if (!state.alignmentBusy || requestId !== state.alignmentRequestId) {
      releaseImage(matchArt);
      releaseImage(matchCard);
      return;
    }
    const jobId = matcherRunner.start({
      artImage: matchArt,
      cardImage: matchCard,
      profile: activeProfile(),
      baseline: state.baseline,
      profileVersion: PROFILE_VERSION,
    });
    state.alignmentJobId = jobId;
    showAlignmentProgress({ jobId, label: "Starting reference matcher", progress: 0 });
  } catch (error) {
    releaseImage(matchArt);
    releaseImage(matchCard);
    if (requestId === state.alignmentRequestId) finishAlignmentError(error);
  }
}

$("#cancelAlignmentButton").addEventListener("click", () => {
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
  if (state.alignmentBusy) return;
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
    state.lastCompletedJobId = 0;
    state.baseline = null;
    state.matcherDiagnostics = null;
    state.qualityReport = null;
    setPreview(kind, file);
    $(`#${kind}Meta`).textContent = fileSummary(file, decoded);
    $(`#${kind}Drop`).classList.add("loaded");
    if (kind === "art") {
      $("#emptyState").hidden = true;
      resetAlignment(false);
    }
    state.alignmentStatus = "NEEDS_REFERENCE";
    $("#proofButton").disabled = true;
    $("#autoAlignStatus").hidden = true;
    updateQualityNotice();
    updateAutoAlignAvailability();
    requestRender();
    if (state.artImage && state.cardImage) {
      if (state.cardQuality?.blocksAlignment) {
        $("#autoAlignStatus").textContent = state.cardQuality.blockingIssues.join(" ");
        $("#autoAlignStatus").classList.add("low");
        $("#autoAlignStatus").hidden = false;
      } else {
        startAlignment("both images ready");
      }
    }
  } catch (error) {
    showToast(error.message);
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
    labelBox: profile.name === "psa" ? currentPsaLabelBox() : null,
  });
  state.offsetX = result.offsetX;
  state.offsetY = result.offsetY;
  const xPixels = Math.round(state.offsetX * profile.master_px[0]);
  const yPixels = Math.round(state.offsetY * profile.master_px[1]);
  $("#offsetValue").textContent = `X ${xPixels} / Y ${yPixels}`;
}

function resetAlignment(announce = true) {
  const baseline = state.baseline || CENTER_FIT_ALIGNMENT;
  state.zoom = baseline.zoom;
  state.offsetX = baseline.offsetX;
  state.offsetY = baseline.offsetY;
  $("#zoomRange").value = "100";
  $("#zoomValue").textContent = "100%";
  requestRender();
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
  requestRender();
}, { passive: false });

function nudge(dx, dy, amount = 1) {
  if (state.alignmentBusy) return;
  const profile = activeProfile();
  state.offsetX += (dx * amount) / profile.master_px[0];
  state.offsetY += (dy * amount) / profile.master_px[1];
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

$("#zoomRange").addEventListener("input", (event) => {
  if (state.alignmentBusy) return;
  state.zoom = Number(event.target.value) / 100;
  $("#zoomValue").textContent = `${event.target.value}%`;
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
}
$("#a4PaperTool").addEventListener("click", () => choosePaper("a4"));
$("#letterPaperTool").addEventListener("click", () => choosePaper("letter"));
$("#includeCard").addEventListener("change", (event) => {
  if (state.alignmentBusy) {
    event.currentTarget.checked = false;
    return;
  }
  requestRender();
});
$("#exitAppButton").addEventListener("click", () => {
  if (!state.alignmentBusy) window.location.reload();
});
["#includePieces", "#includeMaster", "#includeFullArtPdf", "#includeWithCardPdf"].forEach((selector) => {
  $(selector).addEventListener("change", (event) => {
    if (state.alignmentBusy) {
      event.currentTarget.checked = false;
      return;
    }
    updateExportSummary();
  });
});
$("#exportButton").addEventListener("click", () => {
  if (state.alignmentBusy) return;
  showToast("Final PDF and ZIP export is scheduled for the next milestone.");
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
});
updateSetupSummary();
updateStudioContract();
openSetup();
