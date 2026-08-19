export const PROFILE_VERSION = "phase2-profiles-1";

export const fallbackProfiles = {
  standard: {
    name: "standard",
    version: PROFILE_VERSION,
    label: "Standard 3×3 Binder",
    grid: [3, 3],
    piece_count: 8,
    insert_mm: [63, 88],
    insert_px: [744, 1039],
    master_mm: [189, 264],
    master_px: [2232, 3118],
    card_box: [1 / 3, 1 / 3, 2 / 3, 2 / 3],
    label_box: null,
    recommended_corner_radius_mm: 3,
  },
  vaultx: {
    name: "vaultx",
    version: PROFILE_VERSION,
    label: "Vault Binder",
    grid: [3, 3],
    piece_count: 8,
    insert_mm: [66, 94],
    insert_px: [780, 1110],
    master_mm: [198, 282],
    master_px: [2339, 3331],
    card_box: [1 / 3, 1 / 3, 2 / 3, 2 / 3],
    label_box: null,
    recommended_corner_radius_mm: 3,
  },
  psa: {
    name: "psa",
    version: PROFILE_VERSION,
    label: "PSA Slab",
    grid: [1, 1],
    piece_count: 1,
    insert_mm: [80.264, 135.128],
    insert_px: [948, 1596],
    master_mm: [80.264, 135.128],
    master_px: [948, 1596],
    card_box: [8.632 / 80.264, 36 / 135.128, 71.632 / 80.264, 124 / 135.128],
    label_box: [5.207 / 80.264, 5 / 135.128, 75.057 / 80.264, 26.59 / 135.128],
    label_box_mm: [5.207, 5, 69.85, 21.59],
    recommended_corner_radius_mm: 3,
  },
  cardslab: {
    name: "cardslab",
    version: PROFILE_VERSION,
    label: "Card Slab",
    grid: [1, 1],
    piece_count: 1,
    insert_mm: [80.264, 135.128],
    insert_px: [948, 1596],
    master_mm: [80.264, 135.128],
    master_px: [948, 1596],
    // The standard 63 × 88 mm card is centered in the full PSA-sized slab.
    card_box: [8.632 / 80.264, 23.564 / 135.128, 71.632 / 80.264, 111.564 / 135.128],
    label_box: null,
    recommended_corner_radius_mm: 3,
  },
  psaCase: {
    name: "psaCase",
    version: PROFILE_VERSION,
    label: "PSA Cover Edition (CASE)",
    grid: [1, 1],
    piece_count: 1,
    // 3.14" × 5.30" target = 79.756 × 134.62 mm.
    // Shaves ~0.51 mm off the modern PSA envelope (80.264 × 135.128) on each axis
    // so the artwork seats safely inside a slim cover/case without binding the edges.
    insert_mm: [79.756, 134.62],
    insert_px: [942, 1590],
    master_mm: [79.756, 134.62],
    master_px: [942, 1590],
    // 63 × 88 mm card centered inside the slim cover.
    card_box: [
      8.378 / 79.756,
      23.31 / 134.62,
      71.378 / 79.756,
      111.31 / 134.62,
    ],
    label_box: null,
    recommended_corner_radius_mm: 3,
  },
  psaMini: {
    name: "psaMini",
    version: PROFILE_VERSION,
    label: "PSA SLAB (CASE)",
    grid: [1, 1],
    piece_count: 1,
    // 3.14" × 5.30" target = 79.756 × 134.62 mm.
    // Slim labeled variant of the psa profile: smaller outer envelope, but the internal
    // PSA label cutout and card chamber are kept at the same millimetre positions
    // as the full psa so existing artwork can be reused as-is.
    insert_mm: [79.756, 134.62],
    insert_px: [942, 1590],
    master_mm: [79.756, 134.62],
    master_px: [942, 1590],
    card_box: [
      8.632 / 79.756,
      36 / 134.62,
      71.632 / 79.756,
      124 / 134.62,
    ],
    label_box: [5.207 / 79.756, 5 / 134.62, 75.057 / 79.756, 26.59 / 134.62],
    label_box_mm: [5.207, 5, 69.85, 21.59],
    recommended_corner_radius_mm: 3,
  },
  photo8x10: {
    name: "photo8x10",
    version: PROFILE_VERSION,
    label: "8×10 Photo Frame",
    grid: [1, 1],
    piece_count: 1,
    insert_mm: [203.2, 254],
    insert_px: [2400, 3000],
    master_mm: [203.2, 254],
    master_px: [2400, 3000],
    card_box: [0.345, 0.3268, 0.655, 0.6732],
    label_box: null,
    recommended_corner_radius_mm: 0,
  },
};

export const fallbackPapers = {
  a4: { name: "a4", label: "A4", size_mm: [210, 297] },
  letter: { name: "letter", label: "US Letter", size_mm: [215.9, 279.4] },
};

export function cleanMeasure(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1).replace(/\.0$/, "");
}

export function pixelPair(values) {
  return values[0] + " × " + values[1];
}

export function isSlabProfile(profile) {
  return profile?.name === "psa" || profile?.name === "cardslab" || profile?.name === "psaCase" || profile?.name === "psaMini";
}

export function isSingleDisplayProfile(profile) {
  return isSlabProfile(profile) || profile?.name === "photo8x10";
}

export function psaLabelBox(profile, widthMm, heightMm) {
  const leftMm = (profile.master_mm[0] - widthMm) / 2;
  const topMm = 5;
  return [
    leftMm / profile.master_mm[0],
    topMm / profile.master_mm[1],
    (leftMm + widthMm) / profile.master_mm[0],
    (topMm + heightMm) / profile.master_mm[1],
  ];
}

export function cardPhysicalMm(profile) {
  const [left, top, right, bottom] = profile.card_box;
  return [
    profile.master_mm[0] * (right - left),
    profile.master_mm[1] * (bottom - top),
  ];
}

// Returns the card box shifted by the user-selected X/Y pixel offset.
// Only binders (piece_count > 1) honour the offset; single-card profiles
// (psa, psaMini, psaCase, cardslab, photo8x10) always return the original
// card_box because there is no other cell for the card to occupy.
export function effectiveCardBox(profile, offsetX = 0, offsetY = 0) {
  if (!profile || !profile.card_box) return profile?.card_box;
  if (!profile.piece_count || profile.piece_count <= 1) return profile.card_box;
  const cardW = profile.card_box[2] - profile.card_box[0];
  const cardH = profile.card_box[3] - profile.card_box[1];
  const left = profile.card_box[0] + offsetX / profile.master_px[0];
  const top = profile.card_box[1] + offsetY / profile.master_px[1];
  return [left, top, left + cardW, top + cardH];
}

export function paperFit(profile, paperName, papers = fallbackPapers) {
  if (profile.paper_fit?.[paperName]) return profile.paper_fit[paperName];
  const paper = papers[paperName] || fallbackPapers[paperName];
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

export function profileSummary(profile, paper) {
  const unit = profile.piece_count === 1
    ? (profile.name === "photo8x10" ? "print" : profile.name === "cardslab" ? "centered card" : "insert")
    : "printed inserts + center card";
  const quantity = profile.piece_count > 1 ? "8" : "1";
  return `${quantity} ${unit} + ${paper.label} PDF`;
}
