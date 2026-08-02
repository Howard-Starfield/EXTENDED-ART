import { getPieceGeometry, getPrintablePieceGeometry } from "./pieces.js";

export const POINTS_PER_INCH = 72;
export const MM_PER_INCH = 25.4;
export const PIECE_GAP_MM = 2;

export function millimetersToPoints(mm) {
  return (mm / MM_PER_INCH) * POINTS_PER_INCH;
}

export function paperPagePoints(paper) {
  return {
    width: millimetersToPoints(paper.size_mm[0]),
    height: millimetersToPoints(paper.size_mm[1]),
  };
}

function rowGroups(profile, paperName) {
  if (profile.name === "vaultx" && paperName === "letter") return [[0, 1], [2]];
  return [Array.from({ length: profile.grid[1] }, (_, index) => index)];
}

function groupGeometry(profile, rows) {
  const rowCount = rows.length;
  const columnCount = Math.max(1, profile.grid[0]);
  return {
    widthMm: profile.insert_mm[0] * columnCount + PIECE_GAP_MM * (columnCount - 1),
    heightMm: profile.insert_mm[1] * rowCount + PIECE_GAP_MM * (rowCount - 1),
  };
}

function placementFor({ profile, paper, pageIndex, piece, rows, group, page }) {
  const xMarginMm = (paper.size_mm[0] - group.widthMm) / 2;
  const yMarginMm = (paper.size_mm[1] - group.heightMm) / 2;
  const rowIndex = rows.indexOf(piece.row);
  const xMm = xMarginMm + piece.column * (profile.insert_mm[0] + PIECE_GAP_MM);
  const topMm = yMarginMm + rowIndex * (profile.insert_mm[1] + PIECE_GAP_MM);
  const widthPt = millimetersToPoints(profile.insert_mm[0]);
  const heightPt = millimetersToPoints(profile.insert_mm[1]);
  const pageHeightPt = page.height;
  return {
    pieceId: piece.id,
    pageIndex,
    row: piece.row,
    column: piece.column,
    xPt: millimetersToPoints(xMm),
    yPt: pageHeightPt - millimetersToPoints(topMm + profile.insert_mm[1]),
    widthPt,
    heightPt,
    scale: 1,
  };
}

export function createPageLayout(profile, paper, { includeCenter = false } = {}) {
  const page = paperPagePoints(paper);
  const pieces = includeCenter ? getPieceGeometry(profile) : getPrintablePieceGeometry(profile);
  const groups = rowGroups(profile, paper.name);
  const warnings = [];
  const pages = [];

  groups.forEach((rows, pageIndex) => {
    const group = profile.grid[0] > 1
      ? groupGeometry(profile, rows)
      : { widthMm: profile.insert_mm[0], heightMm: profile.insert_mm[1] };
    if (group.widthMm > paper.size_mm[0] || group.heightMm > paper.size_mm[1]) {
      warnings.push(`${profile.label} does not fit ${paper.label} at 100% physical size.`);
    }
    const pagePieces = pieces
      .filter((piece) => profile.grid[0] === 1 || rows.includes(piece.row))
      .map((piece) => placementFor({ profile, paper, pageIndex, piece, rows, group, page }));
    pages.push({ index: pageIndex, widthPt: page.width, heightPt: page.height, placements: pagePieces });
  });

  if (profile.name === "photo8x10" && paper.name === "a4") {
    warnings.push("8x10 output remains exact size on A4; the 3.4 mm side margins may be outside the printable area of many printers.");
  }
  const status = warnings.length
    ? "exact_with_margin_warning"
    : pages.length > 1 ? "exact_multipage" : "exact_one_page";
  return {
    profile: profile.name,
    paper: paper.name,
    pageSizeMm: [...paper.size_mm],
    pageSizePt: [page.width, page.height],
    pageCount: pages.length,
    status,
    warnings,
    pages,
    placements: pages.flatMap((item) => item.placements),
    gapMm: PIECE_GAP_MM,
  };
}
