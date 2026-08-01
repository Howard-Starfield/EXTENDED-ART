"use strict";

const TARGET_W = 2232;
const TARGET_H = 3118;
const $ = (selector) => document.querySelector(selector);

const canvas = $("#alignmentCanvas");
const shell = $("#canvasShell");
const ctx = canvas.getContext("2d", { alpha: false });
const state = {
  artFile: null,
  cardFile: null,
  artImage: null,
  cardImage: null,
  artPreviewUrl: null,
  cardPreviewUrl: null,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  opacity: 0.72,
  cornerRadiusMm: 3,
  showGrid: true,
  showCard: true,
  difference: false,
  dragging: false,
  pointerX: 0,
  pointerY: 0,
};

let toastTimer;
let renderQueued = false;

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

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
  const cellX = width / 3;
  const cellY = height / 3;
  const cellW = width / 3;
  const cellH = height / 3;
  const cornerRadius = (state.cornerRadiusMm / 63) * cellW;
  if (state.cardImage && state.showCard) {
    const cardScale = Math.max(
      cellW / state.cardImage.naturalWidth,
      cellH / state.cardImage.naturalHeight
    );
    const cardW = state.cardImage.naturalWidth * cardScale;
    const cardH = state.cardImage.naturalHeight * cardScale;
    ctx.save();
    roundedRectPath(ctx, cellX, cellY, cellW, cellH, cornerRadius);
    ctx.clip();
    ctx.globalAlpha = state.opacity;
    if (state.difference) ctx.globalCompositeOperation = "difference";
    ctx.drawImage(state.cardImage, cellX + (cellW-cardW)/2, cellY + (cellH-cardH)/2, cardW, cardH);
    ctx.restore();
  }
  if (state.showGrid) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.88)";
    ctx.lineWidth = 1;
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        roundedRectPath(
          ctx,
          col * cellW + 0.5,
          row * cellH + 0.5,
          cellW - 1,
          cellH - 1,
          cornerRadius
        );
        ctx.stroke();
      }
    }
    ctx.strokeStyle = state.difference ? "#f4d34d" : "#2aa9b8";
    ctx.lineWidth = 2;
    roundedRectPath(ctx, cellX + 1, cellY + 1, cellW - 2, cellH - 2, cornerRadius);
    ctx.stroke();
    ctx.restore();
  }
  const xPixels = Math.round(state.offsetX * TARGET_W);
  const yPixels = Math.round(state.offsetY * TARGET_H);
  $("#offsetValue").textContent = "X " + xPixels + " / Y " + yPixels;
}

function resetAlignment() {
  state.zoom = 1;
  state.offsetX = 0;
  state.offsetY = 0;
  $("#zoomRange").value = "100";
  $("#zoomValue").textContent = "100%";
  requestRender();
  showToast("Artwork fit to the full page.");
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
  state.offsetX += (dx * amount) / TARGET_W;
  state.offsetY += (dy * amount) / TARGET_H;
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

$("#exportButton").addEventListener("click", async () => {
  if (!state.artFile) return;
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
    include_card: $("#includeCard").checked,
    corner_radius_mm: state.cornerRadiusMm,
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
requestRender();

fetch("/api/health")
  .then((response) => {
    if (!response.ok) throw new Error();
  })
  .catch(() => {
    showToast("The local workflow service is not responding.");
  });
