"use strict";

const $ = (selector) => document.querySelector(selector);

const fallbackProfiles = {
  standard: {
    name: "standard", label: "Standard 3×3 Binder", grid: [3, 3], piece_count: 9,
    insert_mm: [63, 88], insert_px: [744, 1039], master_mm: [189, 264],
    master_px: [2232, 3118], card_box: [1/3, 1/3, 2/3, 2/3],
    label_box: null,
    recommended_corner_radius_mm: 3,
  },
  vaultx: {
    name: "vaultx", label: "Vault Binder", grid: [3, 3], piece_count: 9,
    insert_mm: [66, 94], insert_px: [780, 1110], master_mm: [198, 282],
    master_px: [2339, 3331], card_box: [1/3, 1/3, 2/3, 2/3],
    label_box: null,
    recommended_corner_radius_mm: 3,
  },
  psa: {
    name: "psa", label: "PSA Slab", grid: [1, 1], piece_count: 1,
    insert_mm: [80.264, 135.128], insert_px: [948, 1596], master_mm: [80.264, 135.128],
    master_px: [948, 1596],
    card_box: [8.632/80.264, 36/135.128, 71.632/80.264, 124/135.128],
    label_box: [5.207/80.264, 5/135.128, 75.057/80.264, 26.59/135.128],
    label_box_mm: [5.207, 5, 69.85, 21.59],
    recommended_corner_radius_mm: 3,
  },
  photo8x10: {
    name: "photo8x10", label: "8x10 Photo Frame", grid: [1, 1], piece_count: 1,
    insert_mm: [203.2, 254], insert_px: [2400, 3000], master_mm: [203.2, 254],
    master_px: [2400, 3000], card_box: [0.345, 0.3268, 0.655, 0.6732],
    label_box: null,
    recommended_corner_radius_mm: 0,
  },
};

const fallbackPapers = {
  a4: { name: "a4", label: "A4", size_mm: [210, 297] },
  letter: { name: "letter", label: "US Letter", size_mm: [215.9, 279.4] },
};

const canvas = $("#alignmentCanvas");
const shell = $("#canvasShell");
const ctx = canvas.getContext("2d", { alpha: false });
const state = {
  profile: "standard",
  paper: "a4",
  profiles: fallbackProfiles,
  papers: fallbackPapers,
  artFile: null,
  cardFile: null,
  artImage: null,
  cardImage: null,
  artPreviewUrl: null,
  cardPreviewUrl: null,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  cardOffsetX: 0,
  cardOffsetY: 0,
  opacity: 0.72,
  cornerRadiusMm: 3,
  psaLabelWidthMm: 69.85,
  psaLabelHeightMm: 21.59,
  showGrid: true,
  showCard: true,
  difference: false,
  dragging: false,
  pointerX: 0,
  pointerY: 0,
};

function activeProfile() { return state.profiles[state.profile] || fallbackProfiles.standard; }
function activePaper() { return state.papers[state.paper] || fallbackPapers.a4; }

function effectiveCardBox() {
  const profile = activeProfile();
  const isBinder = profile.piece_count > 1;
  if (!isBinder) return profile.card_box;
  const cardW = profile.card_box[2] - profile.card_box[0];
  const cardH = profile.card_box[3] - profile.card_box[1];
  const left = profile.card_box[0] + state.cardOffsetX / profile.master_px[0];
  const top = profile.card_box[1] + state.cardOffsetY / profile.master_px[1];
  return [left, top, left + cardW, top + cardH];
}

function cleanMeasure(value) { return Number.isInteger(value) ? String(value) : Number(value).toFixed(1).replace(/\.0$/, ""); }
function pixelPair(values) { return values[0] + " × " + values[1]; }

function psaLabelBox(profile) {
  const widthMm = state.psaLabelWidthMm;
  const heightMm = state.psaLabelHeightMm;
  const leftMm = (profile.master_mm[0] - widthMm) / 2;
  const topMm = 5;
  return [
    leftMm / profile.master_mm[0],
    topMm / profile.master_mm[1],
    (leftMm + widthMm) / profile.master_mm[0],
    (topMm + heightMm) / profile.master_mm[1],
  ];
}

function paperFit(profile, paperName) {
  if (profile.paper_fit?.[paperName]) return profile.paper_fit[paperName];
  const paper = state.papers[paperName] || fallbackPapers[paperName];
  const gapMm = 2;
  const safeMarginMm = 4;
  const contentWidth = profile.insert_mm[0] * profile.grid[0] + gapMm * (profile.grid[0] - 1);
  const contentHeight = profile.insert_mm[1] * profile.grid[1] + gapMm * (profile.grid[1] - 1);
  const scale = Math.min(
    1,
    (paper.size_mm[0] - safeMarginMm * 2) / contentWidth,
    (paper.size_mm[1] - safeMarginMm * 2) / contentHeight,
  );
  return { page_mm: paper.size_mm, scale };
}

function updatePaperTools() {
  const profile = activeProfile();
  [
    ["a4", "#a4PaperTool", "#a4Fit"],
    ["letter", "#letterPaperTool", "#letterFit"],
  ].forEach(([paperName, buttonSelector, fitSelector]) => {
    const paper = state.papers[paperName] || fallbackPapers[paperName];
    const fit = paperFit(profile, paperName);
    const selected = state.paper === paperName;
    const percent = fit.scale < 0.9995 ? (fit.scale * 100).toFixed(1) + "%" : "100%";
    const dimensions = paper.size_mm.map(cleanMeasure).join("×");
    const button = $(buttonSelector);
    button.classList.toggle("active", selected);
    button.classList.toggle("scaled", fit.scale < 0.9995);
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute(
      "aria-label",
      paper.label + " " + dimensions + " millimetres, output at " + percent,
    );
    button.title = paper.label + ": " + dimensions + " mm | output " + percent;
    $(fitSelector).textContent = dimensions + " · " + percent;
  });
}

let toastTimer;
let renderQueued = false;

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function setRuler(element, total, divisions, suffix) {
  const values = [];
  const count = divisions > 1 ? divisions : 1;
  for (let index = 0; index <= count; index += 1) {
    const value = total * index / count;
    values.push("<span>" + cleanMeasure(value) + (index === count ? suffix : "") + "</span>");
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
  $("#setupSummaryPixels").textContent = pixelPair(profile.master_px) + " px";
  $("#setupSummarySize").textContent = cleanMeasure(profile.master_mm[0]) + " × "
    + cleanMeasure(profile.master_mm[1]) + " mm";
  const unit = profile.piece_count === 1 ? (profile.name === "photo8x10" ? "print" : "insert") : "inserts";
  $("#setupSummaryPackage").textContent = profile.piece_count + " " + unit + " + " + paper.label + " PDF";
}

function updateExportSummary() {
  const extras = [];
  if ($("#includePieces").checked) extras.push("piece PNGs");
  if ($("#includeMaster").checked) extras.push("master PNG");
  if ($("#includeFullArtPdf").checked) extras.push("full-art PDF");
  const extraCopy = extras.length ? " + " + extras.join(" + ") : "";
  $("#exportButtonCopy").textContent = activePaper().label
    + " cut-ready PDF + print guide" + extraCopy + " & ZIP";
}



function updateStudioContract() {
  const profile = activeProfile();
  const paper = activePaper();
  const isBinder = profile.piece_count > 1;
  shell.style.aspectRatio = profile.master_px[0] + " / " + profile.master_px[1];
  shell.classList.toggle("photo-frame-mode", profile.name === "photo8x10");
  $("#frameModeBadge").hidden = profile.name !== "photo8x10";
  $(".light-table").dataset.paper = state.paper;
  $("#activeSpec").textContent = profile.label + " | " + pixelPair(profile.master_px)
    + " px | " + paper.label + " | 300 DPI";
  $("#artDropTitle").textContent = isBinder
    ? "Extended " + profile.grid[0] + "×" + profile.grid[1] + " artwork"
    : "Extended " + profile.label + " artwork";
  $("#artDropCopy").textContent = isBinder
    ? "Drop or choose the continuous Image 2 scene"
    : "Drop or choose the full display artwork";
  $("#methodCopy").textContent = isBinder
    ? "The center card stays fixed. Drag the extended artwork underneath it until colors, shapes and perspective meet at the card edges."
    : "The card zone stays fixed inside the display. Drag the artwork underneath it until the generated scene meets the card edges.";
  $("#emptyStateCopy").textContent = isBinder
    ? "Drop the full " + profile.grid[0] + "x" + profile.grid[1] + " image on the left to begin."
    : "Drop the full " + profile.label + " image on the left to begin.";
  setRuler($("#rulerX"), profile.master_mm[0], profile.grid[0], " mm");
  setRuler($("#rulerY"), profile.master_mm[1], profile.grid[1], "");
  $("#masterContract").textContent = pixelPair(profile.master_px);
  $("#pieceContractLabel").textContent = profile.piece_count === 1 ? "Output" : "Insert";
  $("#pieceContract").textContent = pixelPair(profile.insert_px);
  $("#paperContract").textContent = paper.label + " / 300 DPI";
  $("#includeCardHelp").textContent = isBinder
    ? "Turn off when the real card will go in the binder."
    : profile.name === "psa" || profile.name === "psaMini"
      ? "Turn off when the physical slab will cover this card zone."
      : "Turn off when mounting the real card over the finished print.";
  $("#cutReadyOutputHelp").textContent = profile.name === "psa" || profile.name === "psaMini"
    ? "White PSA label + card chambers with dotted guides"
    : profile.name === "psaCase"
      ? "White centered card chamber with dotted guide"
      : "Finished inserts with cut guides";
  $("#psaLabelControls").hidden = profile.name !== "psa" && profile.name !== "psaMini";
  $("#cardPositionControls").hidden = profile.piece_count <= 1;
  updatePaperTools();
  updateExportSummary();
  requestRender();
}

function openSetup() {
  const gate = $("#launchGate");
  document.querySelector('input[name="profile"][value="' + state.profile + '"]').checked = true;
  document.querySelector('input[name="paper"][value="' + state.paper + '"]').checked = true;
  updateSetupSummary();
  gate.hidden = false;
  document.body.classList.add("setup-open");
  $(".topbar").inert = true;
  $(".studio-shell").inert = true;
  setTimeout(() => document.querySelector('input[name="profile"]:checked').focus(), 0);
}

function closeSetup() {
  $("#launchGate").hidden = true;
  document.body.classList.remove("setup-open");
  $(".topbar").inert = false;
  $(".studio-shell").inert = false;
}

function applySetup(event) {
  event.preventDefault();
  const nextProfile = document.querySelector('input[name="profile"]:checked').value;
  const nextPaper = document.querySelector('input[name="paper"]:checked').value;
  const profileChanged = state.profile !== nextProfile;
  state.profile = nextProfile;
  state.paper = nextPaper;
  if (profileChanged) {
    $("#includeCard").checked = nextProfile !== "psa";
    state.cornerRadiusMm = Number(activeProfile().recommended_corner_radius_mm || 0);
    $("#radiusRange").value = String(state.cornerRadiusMm);
    $("#radiusValue").textContent = cleanMeasure(state.cornerRadiusMm) + " mm";
    resetAlignment(false);
    $("#autoAlignStatus").hidden = true;
  }
  updateStudioContract();
  closeSetup();
  $("#changeSetupButton").focus();
}

document.querySelectorAll('input[name="profile"], input[name="paper"]').forEach((input) => {
  input.addEventListener("change", updateSetupSummary);
});
$("#setupForm").addEventListener("submit", applySetup);
$("#changeSetupButton").addEventListener("click", openSetup);
$("#launchGate").addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const focusable = [...$("#launchGate").querySelectorAll("input, button")].filter((item) => !item.disabled);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Choose a PNG, JPG, or WebP image."));
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image could not be opened."));
    };
    image.src = url;
  });
}

function fileSummary(file, image) {
  const megabytes = (file.size / 1024 / 1024).toFixed(1);
  return `${image.naturalWidth} x ${image.naturalHeight} px | ${megabytes} MB`;
}

function setPreview(kind, file) {
  const key = kind + "PreviewUrl";
  if (state[key]) URL.revokeObjectURL(state[key]);
  state[key] = URL.createObjectURL(file);
  const preview = $("#" + kind + "Preview");
  preview.src = state[key];
  preview.hidden = false;
}

function updateAutoAlignAvailability() {
  const button = $("#autoAlignButton");
  button.disabled = button.classList.contains("is-loading") || !(state.artFile && state.cardFile);
}

function applySuggestedAlignment(alignment) {
  state.zoom = Math.min(2.5, Math.max(1, Number(alignment.zoom)));
  state.offsetX = Math.min(1, Math.max(-1, Number(alignment.offset_x)));
  state.offsetY = Math.min(1, Math.max(-1, Number(alignment.offset_y)));
  const percent = Math.round(state.zoom * 100);
  $("#zoomRange").value = String(percent);
  $("#zoomValue").textContent = percent + "%";
  state.showCard = true;
  $("#cardToggle").classList.add("active");
  $("#cardToggle").setAttribute("aria-pressed", "true");
  requestRender();
}


function roundedRectPath(context, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function render() {
  renderQueued = false;
  const profile = activeProfile();
  const rect = shell.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width;
  const height = rect.height;
  ctx.fillStyle = "#d9dad4";
  ctx.fillRect(0, 0, width, height);
  if (state.artImage) {
    const base = Math.max(width / state.artImage.naturalWidth, height / state.artImage.naturalHeight);
    const scale = base * state.zoom;
    const drawWidth = state.artImage.naturalWidth * scale;
    const drawHeight = state.artImage.naturalHeight * scale;
    let left = (width - drawWidth) / 2 + state.offsetX * width;
    let top = (height - drawHeight) / 2 + state.offsetY * height;
    left = Math.min(0, Math.max(width - drawWidth, left));
    top = Math.min(0, Math.max(height - drawHeight, top));
    state.offsetX = (left - (width - drawWidth) / 2) / width;
    state.offsetY = (top - (height - drawHeight) / 2) / height;
    ctx.drawImage(state.artImage, left, top, drawWidth, drawHeight);
  }
  const columns = profile.grid[0];
  const rows = profile.grid[1];
  const cellW = width / columns;
  const cellH = height / rows;
  const pieceRadius = (state.cornerRadiusMm / profile.insert_mm[0]) * cellW;
  const cardBox = effectiveCardBox();
  const cardX = cardBox[0] * width;
  const cardY = cardBox[1] * height;
  const cardWBox = (cardBox[2] - cardBox[0]) * width;
  const cardHBox = (cardBox[3] - cardBox[1]) * height;
  const cardWidthMm = profile.master_mm[0] * (cardBox[2] - cardBox[0]);
  const cardRadius = (state.cornerRadiusMm / cardWidthMm) * cardWBox;
  if (state.cardImage && state.showCard) {
    const cardScale = Math.max(
      cardWBox / state.cardImage.naturalWidth,
      cardHBox / state.cardImage.naturalHeight
    );
    const cardW = state.cardImage.naturalWidth * cardScale;
    const cardH = state.cardImage.naturalHeight * cardScale;
    ctx.save();
    roundedRectPath(ctx, cardX, cardY, cardWBox, cardHBox, cardRadius);
    ctx.clip();
    ctx.globalAlpha = state.opacity;
    if (state.difference) ctx.globalCompositeOperation = "difference";
    ctx.drawImage(state.cardImage, cardX + (cardWBox-cardW)/2, cardY + (cardHBox-cardH)/2, cardW, cardH);
    ctx.restore();
  }
  if (state.artImage && (profile.name === "psa" || profile.name === "psaMini")) {
    const cutouts = [];
    if (profile.label_box) cutouts.push(["PSA LABEL CUTOUT", psaLabelBox(profile), 2]);
    if (!$("#includeCard").checked) cutouts.push(["CARD CUTOUT", cardBox, cardRadius]);
    ctx.save();
    for (const [label, box, radius] of cutouts) {
      const cutX = box[0] * width;
      const cutY = box[1] * height;
      const cutW = (box[2] - box[0]) * width;
      const cutH = (box[3] - box[1]) * height;
      roundedRectPath(ctx, cutX, cutY, cutW, cutH, radius);
      const referenceVisible = label === "CARD CUTOUT" && state.cardImage && state.showCard;
      ctx.fillStyle = referenceVisible ? "rgba(255,255,255,.78)" : "rgba(255,255,255,.96)";
      ctx.fill();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = label === "PSA LABEL CUTOUT" ? "#f26345" : "#177884";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#4f595c";
      ctx.font = '700 8px "Cascadia Mono", monospace';
      ctx.textAlign = "center";
      ctx.fillText(label, cutX + cutW / 2, cutY + Math.min(cutH / 2 + 3, 12));
    }
    ctx.restore();
  }
  if (state.showGrid) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.88)";
    ctx.lineWidth = 1;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        roundedRectPath(
          ctx,
          col * cellW + 0.5,
          row * cellH + 0.5,
          cellW - 1,
          cellH - 1,
          pieceRadius
        );
        ctx.stroke();
      }
    }
    ctx.strokeStyle = state.difference ? "#f4d34d" : "#2aa9b8";
    ctx.lineWidth = 2;
    roundedRectPath(ctx, cardX + 1, cardY + 1, cardWBox - 2, cardHBox - 2, cardRadius);
    ctx.stroke();
    ctx.restore();
  }
  const xPixels = Math.round(state.offsetX * profile.master_px[0]);
  const yPixels = Math.round(state.offsetY * profile.master_px[1]);
  $("#offsetValue").textContent = "X " + xPixels + " / Y " + yPixels;
  $("#cardOffsetValue").textContent = "X " + Math.round(state.cardOffsetX) + " / Y " + Math.round(state.cardOffsetY);
}

function resetAlignment(announce = true) {
  state.zoom = 1;
  state.offsetX = 0;
  state.offsetY = 0;
  state.cardOffsetX = 0;
  state.cardOffsetY = 0;
  $("#zoomRange").value = "100";
  $("#zoomValue").textContent = "100%";
  $("#cardOffsetXRange").value = "0";
  $("#cardOffsetYRange").value = "0";
  $("#cardOffsetValue").textContent = "X 0 / Y 0";
  requestRender();
  if (announce) showToast("Artwork fit to the full page.");
}

async function loadFile(kind, file) {
  try {
    const image = await readImage(file);
    if (kind === "art") {
      state.artFile = file;
      state.artImage = image;
      setPreview("art", file);
      $("#artMeta").textContent = fileSummary(file, image);
      $("#artDrop").classList.add("loaded");
      $("#emptyState").hidden = true;
      $("#exportButton").disabled = false;
      resetAlignment();
    } else {
      state.cardFile = file;
      state.cardImage = image;
      setPreview("card", file);
      $("#cardMeta").textContent = fileSummary(file, image);
      $("#cardDrop").classList.add("loaded");
      requestRender();
    }
    const status = $("#autoAlignStatus");
    status.hidden = true;
    status.classList.remove("low");
    updateAutoAlignAvailability();
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
      zone.classList.add("dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    zone.addEventListener(eventName, () => zone.classList.remove("dragging"));
  });
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) loadFile(kind, file);
  });
}

bindDropZone("#artDrop", "#artInput", "art");
bindDropZone("#cardDrop", "#cardInput", "card");

function showAutoAlignResult(alignment) {
  applySuggestedAlignment(alignment);
  const guidance = alignment.quality === "high"
    ? "Ready to inspect."
    : alignment.quality === "medium"
      ? "Check the card edges and nudge if needed."
      : "The AI redraw differs; use this as a starting point.";
  const status = $("#autoAlignStatus");
  status.textContent = alignment.confidence + "% confidence | "
    + alignment.matched_region + ". " + guidance;
  status.classList.toggle("low", alignment.quality === "low");
  status.hidden = false;
  showToast("Suggested alignment applied.");
}


async function autoAlignArtwork() {
  if (!(state.artFile && state.cardFile)) return;
  const button = $("#autoAlignButton");
  const label = button.querySelector("strong");
  button.classList.add("is-loading");
  button.disabled = true;
  label.textContent = "Finding best match...";
  $("#autoAlignStatus").hidden = true;

  const form = new FormData();
  form.append("art", state.artFile);
  form.append("card", state.cardFile);
  form.append("profile", state.profile);
  try {
    const response = await fetch("/api/auto-align", { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Auto alignment failed.");
    showAutoAlignResult(result.alignment);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.classList.remove("is-loading");
    label.textContent = "Auto align artwork";
    updateAutoAlignAvailability();
  }
}

$("#autoAlignButton").addEventListener("click", autoAlignArtwork);


shell.addEventListener("pointerdown", (event) => {
  if (!state.artImage) return;
  state.dragging = true;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  shell.setPointerCapture(event.pointerId);
});
shell.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
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
  if (!state.artImage) return;
  event.preventDefault();
  const direction = event.deltaY > 0 ? -0.03 : 0.03;
  state.zoom = Math.min(2.5, Math.max(1, state.zoom + direction));
  const percent = Math.round(state.zoom * 100);
  $("#zoomRange").value = String(percent);
  $("#zoomValue").textContent = percent + "%";
  requestRender();
}, { passive: false });

function nudge(dx, dy, amount = 1) {
  const profile = activeProfile();
  state.offsetX += (dx * amount) / profile.master_px[0];
  state.offsetY += (dy * amount) / profile.master_px[1];
  requestRender();
}

shell.addEventListener("keydown", (event) => {
  const amount = event.shiftKey ? 10 : 1;
  const moves = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };
  if (!moves[event.key]) return;
  event.preventDefault();
  nudge(moves[event.key][0], moves[event.key][1], amount);
});
document.querySelectorAll("[data-nudge]").forEach((button) => {
  button.addEventListener("click", () => {
    const values = button.dataset.nudge.split(",").map(Number);
    nudge(values[0], values[1], 4);
  });
});
$("#resetButton").addEventListener("click", resetAlignment);

// Card position controls
function nudgeCard(dx, dy, amount = 1) {
  state.cardOffsetX += dx * amount;
  state.cardOffsetY += dy * amount;
  $("#cardOffsetXRange").value = String(Math.round(state.cardOffsetX));
  $("#cardOffsetYRange").value = String(Math.round(state.cardOffsetY));
  $("#cardOffsetXOut").textContent = Math.round(state.cardOffsetX) + " px";
  $("#cardOffsetYOut").textContent = Math.round(state.cardOffsetY) + " px";
  requestRender();
}

$("#cardOffsetXRange").addEventListener("input", (event) => {
  state.cardOffsetX = Number(event.target.value);
  $("#cardOffsetXOut").textContent = Math.round(state.cardOffsetX) + " px";
  requestRender();
});
$("#cardOffsetYRange").addEventListener("input", (event) => {
  state.cardOffsetY = Number(event.target.value);
  $("#cardOffsetYOut").textContent = Math.round(state.cardOffsetY) + " px";
  requestRender();
});
document.querySelectorAll("[data-card-nudge]").forEach((button) => {
  button.addEventListener("click", () => {
    const values = button.dataset.cardNudge.split(",").map(Number);
    nudgeCard(values[0], values[1], 4);
  });
});
$("#resetCardPosition").addEventListener("click", () => {
  state.cardOffsetX = 0;
  state.cardOffsetY = 0;
  $("#cardOffsetXRange").value = "0";
  $("#cardOffsetYRange").value = "0";
  $("#cardOffsetXOut").textContent = "0 px";
  $("#cardOffsetYOut").textContent = "0 px";
  requestRender();
  showToast("Card position reset to center.");
});

$("#zoomRange").addEventListener("input", (event) => {
  state.zoom = Number(event.target.value) / 100;
  $("#zoomValue").textContent = event.target.value + "%";
  requestRender();
});
$("#opacityRange").addEventListener("input", (event) => {
  state.opacity = Number(event.target.value) / 100;
  $("#opacityValue").textContent = event.target.value + "%";
  requestRender();
});
$("#radiusRange").addEventListener("input", (event) => {
  state.cornerRadiusMm = Number(event.target.value);
  const label = Number.isInteger(state.cornerRadiusMm)
    ? String(state.cornerRadiusMm)
    : state.cornerRadiusMm.toFixed(1);
  $("#radiusValue").textContent = label + " mm";
  requestRender();
});

function updatePsaLabelDimensions() {
  const widthInput = $("#psaLabelWidth");
  const heightInput = $("#psaLabelHeight");
  if (!(widthInput.checkValidity() && heightInput.checkValidity())) return;
  state.psaLabelWidthMm = Number(widthInput.value);
  state.psaLabelHeightMm = Number(heightInput.value);
  requestRender();
}

$("#psaLabelWidth").addEventListener("input", updatePsaLabelDimensions);
$("#psaLabelHeight").addEventListener("input", updatePsaLabelDimensions);

function bindToggle(selector, stateKey) {
  $(selector).addEventListener("click", (event) => {
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
  if (!(paperName in state.papers)) return;
  state.paper = paperName;
  const setupChoice = document.querySelector('input[name="paper"][value="' + paperName + '"]');
  if (setupChoice) setupChoice.checked = true;
  updateSetupSummary();
  updateStudioContract();
}

$("#a4PaperTool").addEventListener("click", () => choosePaper("a4"));
$("#letterPaperTool").addEventListener("click", () => choosePaper("letter"));

$("#includeCard").addEventListener("change", requestRender);
$("#exitAppButton").addEventListener("click", async () => {
  $("#exitAppButton").disabled = true;
  try {
    await fetch("/api/shutdown", { method: "POST" });
    showToast("ExtendedArt has stopped. You can close this tab.");
  } catch (_error) {
    showToast("ExtendedArt has stopped. You can close this tab.");
  }
});
["#includePieces", "#includeMaster", "#includeFullArtPdf"].forEach((selector) => {
  $(selector).addEventListener("change", updateExportSummary);
});


$("#exportButton").addEventListener("click", async () => {
  if (!state.artFile) return;
  if (state.profile === "psa"
      && !($("#psaLabelWidth").checkValidity() && $("#psaLabelHeight").checkValidity())) {
    showToast("Enter a PSA label cutout within the displayed limits.");
    return;
  }
  if ($("#includeCard").checked && !state.cardFile) {
    showToast("Upload the original card or turn off Print card in center.");
    return;
  }
  const button = $("#exportButton");
  button.disabled = true;
  button.querySelector("span").textContent = "Building package...";
  $("#resultPanel").hidden = true;
  const form = new FormData();
  form.append("art", state.artFile);
  if (state.cardFile) form.append("card", state.cardFile);
  form.append("settings", JSON.stringify({
    zoom: state.zoom,
    offset_x: state.offsetX,
    offset_y: state.offsetY,
    card_offset_x: state.cardOffsetX,
    card_offset_y: state.cardOffsetY,
    include_card: $("#includeCard").checked,
    corner_radius_mm: state.cornerRadiusMm,
    profile: state.profile,
    include_pieces: $("#includePieces").checked,
    include_master: $("#includeMaster").checked,
    include_full_art_pdf: $("#includeFullArtPdf").checked,
    paper_format: state.paper,
    psa_label_width_mm: state.psaLabelWidthMm,
    psa_label_height_mm: state.psaLabelHeightMm,
    name: state.artFile.name.replace(/\.[^.]+$/, ""),
  }));
  try {
    const response = await fetch("/api/export", { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Package generation failed.");
    $("#resultName").textContent = result.filename;
    const warningCount = result.warnings.length;
    $("#resultNotes").textContent = warningCount
      ? warningCount + " quality note(s) are included in the report."
      : "Dimensions and package integrity passed.";
    $("#downloadButton").href = result.download_url;
    $("#resultPanel").hidden = false;
    showToast("Print package is ready.");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = "Create print package";
  }
});

new ResizeObserver(requestRender).observe(shell);
window.addEventListener("resize", requestRender);
updateSetupSummary();
updateStudioContract();
openSetup();

fetch("/api/health")
  .then(async (response) => {
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (result.profiles) state.profiles = result.profiles;
    if (result.papers) state.papers = result.papers;
    const psaDimensions = result.profiles?.psa?.label_box_mm;
    if (psaDimensions) {
      state.psaLabelWidthMm = Number(psaDimensions[2]);
      state.psaLabelHeightMm = Number(psaDimensions[3]);
      $("#psaLabelWidth").value = String(state.psaLabelWidthMm);
      $("#psaLabelHeight").value = String(state.psaLabelHeightMm);
    }
    if (result.version) $("#appVersion").textContent = "v" + result.version;
    updateSetupSummary();
    updateStudioContract();
  })
  .catch(() => {
    showToast("The local workflow service is not responding.");
  });
