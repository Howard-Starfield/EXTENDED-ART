export const fallbackProfiles = {
  standard: {
    name: "standard",
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
  photo8x10: {
    name: "photo8x10",
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
    ? (profile.name === "photo8x10" ? "print" : "insert")
    : "printed inserts + center card";
  const quantity = profile.piece_count > 1 ? "8" : "1";
  return `${quantity} ${unit} + ${paper.label} PDF`;
}
