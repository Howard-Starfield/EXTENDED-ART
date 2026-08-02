# ExtendedArt Web MVP plan

The detailed, task-by-task delivery plan is in [ROADMAP.md](./ROADMAP.md).
This document remains the concise product brief and parity reference.

## Decision

Build an isolated browser-first project beside the desktop application. Keep the desktop application unchanged as the audited reference implementation and use its output contract as the parity target.

The initial web product should be a static browser application. It should not require an OpenAI API key or upload artwork to a server for the basic alignment and print-package workflow.

## Product job

Turn two user-provided images into a correctly sized, cut-ready printable package with the least possible guesswork.

## Design direction

Subject: a collector's print bench, not a generic SaaS dashboard. The interface should feel like a precise work surface: a quiet graphite field, paper-white proof sheets, thin registration marks, and one electric cyan action color that signals alignment and readiness.

Token sketch:

- Ink: `#171A1F`
- Workbench: `#23282F`
- Paper: `#F7F5EF`
- Rule: `#AAB2BB`
- Signal cyan: `#5EE7F2`
- Ready green: `#74D69A`

Use a distinctive display face only for the product title and a neutral sans-serif for controls, measurements, and instructions. Keep the workspace dense but calm: upload rail on the left, proof canvas in the center, physical settings on the right, and a persistent export bar at the bottom.

Signature: the live proof should look like a sheet of registration paper. Every card boundary, cutout, and paper margin is a real measurement, not decorative grid noise.

## MVP functions

### Intake

- Drag/drop extended artwork.
- Drag/drop original game card.
- Original game card is required before alignment can start.
- Client-side type, size, and resolution validation.
- Image previews instead of long filenames.

### Alignment

- The original card is required for automatic alignment.
- Automatic alignment starts as soon as both images finish decoding.
- A blocking progress layer prevents clicks, dragging, settings changes, and
  export while alignment is running.
- Manual pan and zoom correction.
- Reset and center actions.
- Overlay opacity control.
- Visible card boundary and alignment confidence/warning.

### Product and paper

- Standard 3×3 binder.
- Vault binder.
- PSA slab.
- 8×10 photo frame.
- Custom PSA label width and height within the audited safe bounds.
- Two-step launch: choose product first, then choose one primary paper.
- US Letter and A4 previews remain available in the studio; Include second
  paper is an export option and is off by default.
- Card rounding control.
- Center-card printing off by default for ink-saving cut-ready output.
- With-card reference PDF optional and off by default; never export the raw
  uploaded card.

### Export

- Cut-ready PDF enabled by default.
- Dotted/offset guides that do not touch the artwork.
- Blank card and PSA-label cutouts for ink saving.
- Standard and Vault cut-ready output contains eight outer inserts; the occupied
  center position is omitted.
- Optional pieces, master PNG, and full-art PDF.
- Optional with-card reference PDF, always additive and never merged into or
  substituted for the default cut-ready artwork.
- ZIP download containing the selected deliverables, print instructions, and manifest.
- 100% / Actual Size warning before download.

### Quality and trust

- Target pixel dimensions and 300-DPI metadata shown before export.
- Upscaling warning when source detail is insufficient.
- Exact-size pagination instead of scale reduction. Vault Letter uses two
  pages; 8x10 A4 stays exact and displays a 3.4 mm printer-margin warning.
- Clear statement about whether processing is local or uploaded.
- Reset and replacement revoke object URLs and release browser image resources.

## Browser architecture

1. The UI loads as static files.
2. Images are decoded with browser image APIs and processed in a worker so dragging stays responsive.
3. The alignment result is a normalized scene model: source crop, focus, zoom, and card placement.
4. Product profiles are data, not page-specific branches.
5. A PDF/ZIP export layer renders the same profile contract as the Python reference.
6. Golden fixtures compare browser dimensions, cutout boxes, filenames, and package manifests against reference outputs.

## Parity contract

The browser version must preserve these facts before public deployment. Where
the current Python reference silently scales a cut-ready page or centers an
internal guide on retained artwork, this contract is the correction and the
reference fixture must be updated before parity is claimed:

- Standard master: `2232 × 3118 px`; insert: `744 × 1039 px`.
- Vault master: `2339 × 3331 px`; insert: `780 × 1110 px`.
- PSA master/insert: `948 × 1596 px`.
- Photo frame master/insert: `2400 × 3000 px`.
- PSA default label cutout: `69.85 × 21.59 mm` at `5.0 mm` from the top.
- A4 is `210 × 297 mm`; US Letter is `215.9 × 279.4 mm`.
- Cut-ready piece scale is always `1.000000`; it is never silently fit to page.
- Outer guides are fully outside retained artwork; chamber guides are fully
  inside discarded white openings.
- Default public deliverable is cut-ready only; optional artifacts are opt-in.

## Delivery phases

### Phase 1: browser shell

Port the existing upload, alignment, settings, preview, and proof states to a
static browser app. Start the mode-and-paper setup before the main studio, then
automatically lock the UI while the two-image alignment job runs. Keep the
visual language from the desktop studio while removing calls to
`/api/auto-align` and `/api/export`.

### Phase 2: deterministic image pipeline

Move normalization, alignment overlays, crop math, rounded corners, and piece slicing into browser modules. Use the Python implementation for fixture generation and comparison.

### Phase 3: PDF and ZIP parity

Add browser PDF and ZIP generation. Verify page dimensions, image placement, guide clearance, cutouts, and archive contents against the reference package.

### Phase 4: hosted pilot

Only after browser-local processing is stable, deploy the static app to an
OpenAI Sites private preview if Sites is enabled for the Pro account. Use
Cloudflare Pages as the independent static-hosting fallback. The launch build
has no server processing, database, or uploaded job storage.

### Explicit exclusion

Do not build Image 2 generation, prompts, generation routes, API keys, quotas,
or billing in this project. A future request requires a separate proposal and
does not inherit approval from this plan.

## Non-goals for the first release

- User accounts and saved galleries.
- Permanent storage of original card images.
- Marketplace or payment collection.
- Image 2 generation or any other server-side AI service.
- Supporting every card-game template before the four audited profiles are stable.
