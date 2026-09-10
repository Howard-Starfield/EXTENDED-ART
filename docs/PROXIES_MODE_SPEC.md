# Proxies mode specification

Status: approved and implemented against this document.

Product: ExtendedArt Web (`ExtendedArt_Web/`).
Audience: implementers and reviewers of the proxies workflow.
Related contracts: `src/profiles.js`, `src/page-layout.js`, `src/pdf-export.js`, `src/output-geometry.js`, `src/pieces.js`.

## 1. Product job

Let a user drop individual card images into a 3×3 sheet, adjust each image with pan and zoom so it fills a playable card window, then export a cut-ready PDF with the same dotted outer cut guides used by existing binder inserts.

This mode does **not** align extended artwork to a reference card. There is no matcher, no original-card drop zone, and no missing center cell.

## 2. Physical contract (non-negotiable)

All numbers below are the print truth. UI preview must match them.

### 2.1 Single proxy cell

| Quantity | Value | Notes |
| --- | --- | --- |
| Width | 63 mm | Standard TCG card width |
| Height | 88 mm | Standard TCG card height |
| DPI | 300 | Same as all other profiles |
| Pixel width | 744 px | `round(63 / 25.4 * 300)` |
| Pixel height | 1039 px | `round(88 / 25.4 * 300)` |
| Default corner radius | 3 mm | Same default as Standard / Vault; user may change via the existing corner-radius control |
| Aspect ratio | 63:88 | Slot window is fixed; the uploaded image is not |

`insert_mm = [63, 88]` and `insert_px = [744, 1039]` on the profile.

### 2.2 Master / sheet raster (contiguous cells, no gap in the bitmap)

Gaps live only on the printed page layout, same as binder modes.

| Quantity | Value |
| --- | --- |
| Grid | 3 × 3 |
| `piece_count` | **9** (every cell prints) |
| Master mm | 189 × 264 (`3 × 63` × `3 × 88`) |
| Master px | 2232 × 3117 (`3 × 744` × `3 × 1039`) |
| Position ids | `TL TC TR / ML C MR / BL BC BR` (reuse `BINDER_POSITION_IDS`) |

### 2.3 Page layout (printed sheet)

Reuse `createPageLayout` and `PIECE_GAP_MM = 2`.

| Quantity | Value |
| --- | --- |
| Gap between cells | 2 mm |
| Content width | 193 mm (`3 × 63 + 2 × 2`) |
| Content height | 268 mm (`3 × 88 + 2 × 2`) |
| Papers | A4 (210 × 297 mm) and US Letter (215.9 × 279.4 mm) |
| Fit | Exact size on both papers at 100%. Content fits inside both with margins. |
| Scale | Always 1. No shrink-to-fit. |

If Letter vertical margins are tight on a given printer, the print guide and instructions keep the existing “print at 100% / Actual Size” warning. Do not silently scale.

### 2.4 What this is not

- Not Standard binder inserts (66 × 91 mm).
- Not Vault inserts (68 × 97 mm).
- Not “8 inserts + physical center card.” All nine cells are printed proxies.
- Not a crop of one extended-art master. Each cell is an independent image.

## 3. Profile registration

Add a profile key `proxies` to `fallbackProfiles`.

Required fields:

```js
proxies: {
  name: "proxies",
  version: PROFILE_VERSION, // bump only if shared profile versioning requires it
  label: "Proxies 3×3",
  grid: [3, 3],
  piece_count: 9,
  insert_mm: [63, 88],
  insert_px: [744, 1039],
  master_mm: [189, 264],
  master_px: [2232, 3117],
  card_box: [0, 0, 1, 1], // each piece is the full card; no internal chamber
  label_box: null,
  recommended_corner_radius_mm: 3,
  intake: "slot-fill", // discriminant; existing profiles default to "align"
}
```

Rules:

- Existing profiles keep `intake: "align"` (explicit or default when missing).
- Branching on workflow uses `profile.intake === "slot-fill"`, not string compares on `"proxies"` alone, so a future Vault-sized proxy sheet can share the same intake code.
- `getPieceGeometry` must treat `piece_count === 9` as all cells printable. Today printable exclusion is tied to `piece_count === 8` and center id `C`. Proxies must never drop the center cell.
- `isSlabProfile` / `isSingleDisplayProfile` stay false for proxies.
- Launch UI summary: `9 playable cards + {paper} PDF`.

## 4. Domain model

### 4.1 Types

```text
ProxyTransform = {
  zoom: number,      // >= minimum zoom; 1 = cover-fit baseline (see §5.3)
  offsetX: number,   // normalized pan in slot space, same convention as art alignment where practical
  offsetY: number
}

ProxySlot = null | {
  sequence: number,          // monotonic; lower = older for FIFO replace
  file: File,
  image: ImageBitmap | HTMLImageElement,
  previewUrl: string,
  dimensions: { width: number, height: number },
  transform: ProxyTransform
}

ProxyBoard = {
  slots: ProxySlot[9],       // fixed length; index = row * 3 + column
  nextSequence: number,      // starts at 1; increments on each successful place
  selectedIndex: number | null
}
```

Index map (must match `BINDER_POSITION_IDS`):

| Index | Id | Row | Col |
| --- | --- | --- | --- |
| 0 | TL | 0 | 0 |
| 1 | TC | 0 | 1 |
| 2 | TR | 0 | 2 |
| 3 | ML | 1 | 0 |
| 4 | C | 1 | 1 |
| 5 | MR | 1 | 2 |
| 6 | BL | 2 | 0 |
| 7 | BC | 2 | 1 |
| 8 | BR | 2 | 2 |

### 4.2 Commands (single owner module)

Implement as pure functions over `ProxyBoard` (or a small reducer). Do not scatter slot mutations across `app.js` event handlers.

| Command | Behavior |
| --- | --- |
| `placeFiles(board, decodedItems[])` | For each item in drop order: place into the lowest empty index. If none empty, replace the filled slot with the lowest `sequence` (oldest). New slot gets `sequence = nextSequence++` and a default cover-fit transform. |
| `clearSlot(board, index)` | Release image resources for that slot, set `slots[index] = null`. If `selectedIndex === index`, clear selection. |
| `clearAll(board)` | Clear every slot and selection. |
| `selectSlot(board, index)` | Select a filled slot for pan/zoom. Selecting empty is a no-op (or deselect). |
| `setTransform(board, index, transform)` | Update pan/zoom for one filled slot. Clamp zoom and pan so the slot window never shows empty letterboxing unless the source cannot cover (then clamp to max coverage). |

Resource rule: every replace or clear must `releaseImage` the previous bitmap and revoke object URLs, matching existing `image-io` / `state.releaseImage` practice.

### 4.3 Fill and replace semantics (exact)

1. On drop of N files (or file-picker multi-select): decode valid images in order; skip failures with a toast; continue with successes.
2. For each success, run place once.
3. Empty preference: ascending index `0 … 8`.
4. When full: replace oldest by `sequence`, not by index. Ties are impossible if `sequence` is unique.
5. After a clear, the next place prefers the newly empty index over replacing.
6. Replacing a slot resets that slot’s transform to default cover-fit. It does not keep the previous pan/zoom.

## 5. Studio UX

### 5.1 Launch

Add a mode card on the product step:

- Title: **Proxies 3×3**
- Subtitle: `63 × 88 mm cards`
- Tag: `9 printable cards`
- Figure: 3×3 grid (same visual language as Standard)

Paper step unchanged (A4 / Letter).

### 5.2 Layout when `intake === "slot-fill"`

Hide:

- Original game card drop zone
- Auto-align controls and status
- Card-position (binder cell) controls
- PSA label controls
- Difference / card-overlay toggles that only apply to alignment

Show:

- One primary drop zone: “Drop card images” (accepts multiple files)
- Center stage: interactive 3×3 board at master aspect `2232 / 3117`
- Per-slot chrome: empty placeholder, filled thumb, selection ring, hover trash
- Zoom / reset controls that apply to the **selected** slot
- Corner radius control (shared)
- Export bar adapted for proxies copy

### 5.3 Slot rendering and transforms

Each cell is a clipping window of the cell’s source rect in master space (or an equivalent DOM/canvas tile of 744 × 1039 logical px scaled to the shell).

**Default transform (cover-fit):**

- Scale the image so it fully covers the 63 × 88 window (max of width/height scales).
- Center the image in the window.
- Store that scale as `zoom = 1` baseline, or store absolute zoom with a documented cover baseline. Pick one convention and keep preview + export identical.

**Interaction:**

- Click filled slot → select.
- Drag on selected slot (or on the board while a slot is selected) → pan that slot’s image.
- Wheel / zoom control → zoom that slot’s image about the window center (or pointer; pick one and keep export consistent). Prefer window-center for predictability unless pointer-zoom already exists for art and can be reused cleanly.
- Hover filled slot → show a centered trash SVG button. Click trash → `clearSlot` (do not start a drag). Trash must not appear on empty slots.
- Keyboard: Delete/Backspace clears the selected slot when focus is in the studio.

Empty slots show a light dashed placeholder (UI only, not printed).

### 5.4 Multi-file drop

- `dataTransfer.files` and `<input multiple>` both supported.
- Order is the FileList order from the browser.
- Partial failure does not roll back earlier successful placements in that drop batch.

## 6. Cut guides (must match existing dotted lines)

Proxies reuse the **outer piece guide** path already used for Standard / Vault inserts in `createCutReadyPdf`.

### 6.1 Constants (do not fork)

From `src/pdf-export.js` / `src/output-geometry.js`:

| Constant | Value |
| --- | --- |
| `GUIDE_STROKE_PT` | 0.5 pt |
| `GUIDE_CLEARANCE_PT` | 0.25 pt |
| Guide offset | `stroke/2 + clearance` = **0.5 pt** |
| Dash array | `[3, 2]` |
| Dash phase | 0 |
| Color | `rgb(0.09, 0.47, 0.52)` (teal) |

### 6.2 Geometry per printed cell

For every placement on the cut-ready PDF:

1. Draw the piece PNG exactly at `placement` bounds (63 × 88 mm in points).
2. Call the existing `drawOuterGuide(page, placement, cornerRadiusMm)` behavior:
   - Guide rectangle is **outside** the artwork by 0.5 pt on each side.
   - Corner radius is `cornerRadiusMm` converted to points, plus the same 0.5 pt offset.
   - Stroke is dashed `[3, 2]`, teal, 0.5 pt wide.

This keeps the cut line from biting into ink, same as binder inserts.

### 6.3 What not to draw

- Do **not** draw internal `CENTER_CARD` / `CARD` chamber guides on proxy pieces. The piece edge **is** the cut edge.
- Do **not** invent a second dash style, color, or clearance for proxies.
- Studio preview should show the same outer dashed rounded rect around each cell (screen-approximate stroke is fine; PDF numbers are authoritative).

### 6.4 Corner radius on raster vs guide

- Piece PNGs use the existing rounded alpha mask at the chosen corner radius (`roundedMaskRadiusPx`).
- PDF outer guide uses the same radius + offset as binders.
- Default 3 mm; user changes apply to all nine cells for that export.

## 7. Export package

### 7.1 Preconditions

- At least one slot filled.
- Export disabled while busy.
- No requirement for nine filled slots. Empty cells are omitted from the PDF layout and from piece maps.

### 7.2 Rendering pipeline

For each filled slot `id`:

1. Create a 744 × 1039 canvas (sRGB).
2. Fill white (or clear then white) behind the image.
3. Draw the slot image with that slot’s transform (cover + pan/zoom), clipped to the canvas.
4. Apply rounded alpha mask for the current corner radius.
5. Encode PNG with existing 300 DPI print metadata helpers.

Do **not** build a single extended-art master and crop it, unless the implementation can prove byte-identical per-cell output to the per-slot path. Prefer per-slot render for clarity.

### 7.3 Page layout for sparse boards

- Build piece sources only for filled ids.
- `createPageLayout` today lays out all printable pieces for the profile. Proxies need either:
  - a layout option that accepts an allow-list of piece ids, or
  - a proxies-specific layout call that places only filled cells at their correct row/column positions (empty positions leave a gap so remaining cards stay in the correct grid seats).

**Required:** a card placed in `BR` must print in the bottom-right seat even if other seats are empty. Do not pack remaining cards toward the top-left.

### 7.4 Default package contents

Same defaults as the current browser studio unless noted:

| Artifact | Default |
| --- | --- |
| Cut-ready PDF (selected paper) | On |
| Print guide PDF (50 mm square, selected paper) | On |
| Instructions text | On (proxies-specific wording) |
| Manifest JSON | On |
| Quality report | On (adapted; no alignment block required) |
| Piece PNGs | Off |
| Master PNG | Off |
| Full-art PDF | Off / N/A |
| With-card reference PDF | Off / N/A (no reference card) |
| Second paper | Off |

ZIP naming follows `outputNames` with `profile: "proxies"`.

### 7.5 Instructions copy (required lines)

1. Print the cut-ready PDF at 100% / Actual Size.
2. Disable Fit to Page and similar scaling.
3. Measure the 50 mm calibration square on the print guide before cutting.
4. Cut along the **dotted teal guides** outside each card.
5. Each card is 63 × 88 mm at 300 DPI.

## 8. Quality and validation

### 8.1 Intake warnings

Reuse effective-DPI style warnings per slot against 63 mm width:

- Warn when a source is soft for 300 DPI output after cover-fit.
- Do not block export solely for low DPI; warn in the quality notice and report.

### 8.2 Quality report fields

Include:

- Profile name/version, paper, corner radius
- Slot table: id, source px, whether filled, estimated effective DPI after transform
- Page layout status and warnings
- Guide contract version note (stroke 0.5 pt, clearance 0.25 pt, dash `[3,2]`)

Omit alignment matcher diagnostics for this intake.

### 8.3 Automated tests (behavior, not implementation trivia)

Must assert literal values:

1. Profile contract: `insert_mm`, `insert_px`, `master_mm`, `master_px`, `piece_count === 9`, all nine geometry ids printable.
2. Board reducer: empty-first fill; FIFO replace by `sequence`; clear then refill empty; multi-file order.
3. Page layout: filled `BR` alone still places at bottom-right coordinates; gaps preserved.
4. PDF guide: outer guide offset and dash match existing binder constants (reuse shared helpers; assert shared constants, not duplicated magic numbers).
5. Pixel math: `mmToPixels(63) === 744` and `mmToPixels(88) === 1039` at 300 DPI under the project’s rounding rules.
6. Sparse export: three filled slots produce three placements and three embedded images.

Browser smoke:

- Launch proxies → drop two images → see two cells → hover trash removes one → export ZIP downloads.

## 9. Explicit non-goals (this iteration)

- Dragging cards between slots to reorder (may follow later).
- Vault-sized or Standard-insert-sized proxy sheets.
- Server uploads, accounts, or cloud storage.
- Auto-detecting card borders / deskew beyond pan/zoom.
- Printing bleeds beyond the 63 × 88 trim (guides sit outside ink; artwork stays inside the trim).

## 10. Implementation sequence

Verify each unit before the next.

1. **Profile + geometry tests** for `proxies` sizes and `piece_count: 9` printability.
2. **`ProxyBoard` module + unit tests** for place / clear / FIFO / transform clamp.
3. **Launch mode card + intake shell** (hide align UI, show board chrome) with no export yet.
4. **Per-slot pan/zoom rendering** on the board (preview only).
5. **Export path** (per-slot PNG → layout with stable seats → cut-ready PDF with shared `drawOuterGuide` → ZIP).
6. **Quality report + instructions + browser smoke.**

## 11. Acceptance checklist

- [ ] Launch offers Proxies 3×3 with 63 × 88 mm copy.
- [ ] Dropping cards fills empty seats in index order.
- [ ] Ninth-plus drop replaces the oldest filled seat.
- [ ] Hover trash removes a card; next drop prefers that empty seat.
- [ ] Selected seat supports drag pan and zoom; export matches the preview crop.
- [ ] Cut-ready PDF uses existing teal dotted outer guides (0.5 pt stroke, 0.25 pt clearance, dash `[3,2]`), outside the artwork.
- [ ] Each printed card measures 63 × 88 mm when printed at 100%.
- [ ] Empty seats leave holes in the grid; remaining cards keep their seats.
- [ ] No matcher / original-card requirement in this mode.
- [ ] Unit tests cover size contracts, board semantics, and sparse layout seats.

## 12. Open follow-ups (out of scope unless requested)

- Reorder by dragging a filled card onto another seat.
- Optional bleed / borderless cutter profiles.
- Saving / reloading a board session.
- Batch “fit all” / “reset all transforms.”
