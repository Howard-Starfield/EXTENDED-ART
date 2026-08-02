# Launch Mode and Print Format Plan

Status: approved for implementation by the product request; implementation starts immediately after this document.

## Outcome

Every browser launch begins with a focused setup screen where the user chooses:

1. the physical product being created; and
2. the paper used for its printable PDF.

The chosen setup controls the canvas proportions, alignment target, pixel dimensions, cut layout, PDF page, file names, quality report, and ZIP contents. It is not a cosmetic preference.

The four launch modes are:

- Standard 3x3 Binder
- Vault Binder
- PSA Slab
- 8x10 Photo Frame

The two paper formats are A4 and US Letter.

The setup screen appears on every new page load. The app intentionally does not remember or skip the choice because choosing the wrong physical format can waste a print. A `Change setup` control in the studio reopens it without reloading the app.

## Product assumptions and operating targets

These assumptions keep the implementation proportional to the current offline product:

- Team: one founder/operator today, with no more than two contributors expected in the next 12 months.
- Release cadence: manual local builds and tagged releases weekly or as needed.
- Audience: customer-facing offline desktop/browser utility, not a marketing site or cloud service.
- Cloud budget: $0 per month; image processing and packaging remain local with no required network call.
- Normal local API target: p95 under 500 ms for setup metadata and lightweight actions.
- Auto-align target: p95 under 7 seconds on a typical modern desktop for supported image sizes.
- Launch setup target: interactive within 1 second after local HTML load; desktop LCP under 1.5 seconds, INP under 100 ms, and CLS under 0.05.
- Active-session reliability target: 99.9% successful local requests when valid files and adequate disk space are available.

## Verified size contract

All raster dimensions use 300 DPI. Millimetre-to-pixel conversions are rounded once at the full-layout boundary; individual pieces are normalized separately. This preserves the existing Standard contract where the 264 mm master is 3,118 px but each 88 mm insert is 1,039 px.

| Mode | Grid | Finished piece | Full layout | Master pixels | Piece pixels | Card reference zone |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Standard 3x3 Binder | 3x3 | 63 x 88 mm | 189 x 264 mm | 2,232 x 3,118 | 744 x 1,039 | Center pocket |
| Vault Binder | 3x3 | 66 x 94 mm | 198 x 282 mm | 2,339 x 3,331 | 780 x 1,110 | Center pocket |
| PSA Slab | 1x1 | 3.16 x 5.32 in (80.264 x 135.128 mm) | same | 948 x 1,596 | same | configurable label cutout, default 69.85 x 21.59 mm; 63 x 88 mm card opening at y=36 mm |
| 8x10 Photo Frame | 1x1 | 8 x 10 in (203.2 x 254 mm) | same | 2,400 x 3,000 | same | Centered 63 x 88 mm card |

PSA has several holder types. This mode targets the current approximately 3.16 x 5.32 inch external holder reported by PSA for the modern card holder. It must be labelled `PSA Slab` rather than claiming universal compatibility, and the print guide must ask for one physical fit test. Source: [PSA holder information](https://www.psacard.com/articles/articleview/10838/https%3A/images.ctfassets.net/l40e281thfxr/3wy7YSCujUEOK9OcflcQbi/46249989f24168c2aac7c687bfa49d1d/PSA_IG_T1_Holders_01__1_-1-.jpg).

The PSA print profile defines physical openings first: a centered label cutout beginning 5 mm from the top, and a centered 63 x 88 mm card opening beginning 36 mm from the top. The measured-fit label default is 69.85 x 21.59 mm (2.75 x 0.85 in / 825 x 255 px at 300 DPI), while the right panel accepts measured custom width and height for genuine or aftermarket slabs. The backend converts those measurements to normalized canvas coordinates. The cut-ready output leaves both chambers white and surrounds them with dotted guides. PSA does not publish the internal label's engineering dimensions, so one physical fit test remains mandatory.

## Paper behavior

- A4 is 210 x 297 mm.
- US Letter is 215.9 x 279.4 mm.
- The launch choice creates a cut-ready PDF only for the selected paper, plus the guide, reports, instructions, and ZIP. Piece PNGs, the digital master, and the full-art PDF are optional browser exports and default off.
- The print guide uses the same selected paper so its 50 mm calibration square can be printed directly.
- Exact-size output is preferred. If the product plus the configured safe margins and gaps cannot fit, the cut-ready PDF is scaled to fit and the scale is written into the PDF footer, manifest, quality report, and customer instructions.
- Expected warning cases include Vault Binder on US Letter and 8x10 Photo Frame on A4 with the current 4 mm safe margin.
- The in-studio A4 and Letter controls display their physical dimensions and the exact scale returned by the same backend layout function used for PDF generation.

## Launch experience

### Information architecture

The intro is a full-viewport setup layer above the existing studio:

1. `Choose the object` presents four large selectable mode cards.
2. `Choose the sheet` presents A4 and US Letter as two measured paper silhouettes.
3. A compact setup summary shows final pixels, physical size, item count, and selected paper.
4. `Open alignment studio` applies the selection and reveals the workspace.

Standard 3x3 Binder and A4 are preselected to make the screen immediately understandable, but the intro remains visible until the user opens the studio.

### Visual system

- Palette: retain ink `#171b1d`, warm paper `#f1efe8`, cyan `#2aa9b8`, coral `#f26345`, brass `#b89551`, and restrained gray measurement lines.
- Type roles: condensed uppercase headings for product choices, Aptos/Segoe UI for instructions, and Cascadia Mono/Consolas for dimensions and production data.
- Layout: editorial title rail at the left, mode grid in the middle, and paper/summary panel at the right on wide screens; one readable column on small screens.
- Signature element: each product is shown as a technical silhouette with crop marks, a highlighted card zone, and measurement ticks. The selected object receives a coral registration mark and cyan edge.
- Motion: one short reveal and selection transition; no decorative animation that delays use.
- Genericness check: avoid a generic SaaS welcome modal, gradient hero, glass cards, or emoji icons. The screen should feel like the front desk of a small print studio.

### Accessibility and responsive behavior

- The setup layer is a labelled modal dialog with keyboard-operable radio cards and a clear primary action.
- Focus enters the first mode choice on launch, remains inside the setup while open, and returns to `Change setup` when closed from the studio.
- Selected states use text, border, and icon changes rather than color alone.
- At 1366 x 768 the setup and studio fit without a page scrollbar.
- At tablet/mobile widths the page may flow vertically, with mode and paper controls remaining at least 44 px high.
- Reduced-motion preference disables the intro transition.

## Dynamic studio behavior

After selection, the existing studio updates as one system:

- top bar: selected mode, master pixels, selected paper, and 300 DPI;
- upload copy: product-aware extended-art wording;
- canvas: exact target aspect ratio;
- guides: 3x3 pocket guides for binder modes, one outer outline plus the physical card zone for PSA and 8x10 modes, and a separate PSA label-chamber cutout;
- frame mode: the 8x10 canvas receives a visible mat/frame surround and mode badge that are preview-only;
- ruler: selected layout dimensions;
- original-card overlay: center pocket for binders, slab card chamber for PSA, and centered standard card for 8x10;
- auto-align: searches the selected card reference zone instead of assuming the middle third;
- roundness: remains available for every mode, with 3 mm defaults for binder/PSA and 0 mm for the photo frame;
- output contract: master dimensions, piece dimensions/count, selected paper, and DPI;
- export: sends both `profile` and `paper_format` to the local backend.

Uploaded files and manual alignment remain in place when reopening setup. Changing mode resets zoom and offsets because those values are tied to a different canvas geometry.
- PSA ink-saving default: `Print card in center` is off, leaving both label and card chambers white with dotted guides;

## Processor and local API design

### Profile model

Extend `Profile` with:

- `columns` and `rows`;
- a normalized `card_box` `(left, top, right, bottom)`;
- a short product description; and
- a recommended corner radius.

All crop, split, cut-page, guide, and report code uses these values. No new parallel export pipeline is introduced.

### Build options

Add `paper_format` with `a4`, `letter`, or `both`. `both` remains the default for the older automatic drop-folder workflow so existing users are not silently changed. The browser always sends one explicit paper selection.

Add browser package switches for piece PNGs, master PNG, and full-art PDF. They default off; the selected cut-ready PDF is mandatory. Add a PSA card-chamber cutout flag so the older automatic workflow can retain its existing full-art defaults.

Add PSA label width and height options. The backend validates them against the slab envelope, centers the resulting cutout, and records the exact millimetre box in the manifest and PDF report.

### Endpoints

- `GET /api/health` returns version, offline state, paper metadata, and profile metadata needed by the chooser.
- `POST /api/auto-align` receives `profile` in the multipart fields and aligns against that profile's card box.
- `POST /api/export` receives `profile` and `paper_format` inside settings and builds the selected package.

Unknown profiles and paper names fail with readable validation messages. The server remains bound to `127.0.0.1` and performs no external requests.

## Delivery sequence

1. Generalize the profile and print engine while preserving Standard output exactly.
2. Generalize alignment, original-card placement, API metadata, and request validation.
3. Build the launch chooser and wire the selected setup through every studio label and control.
4. Add regression tests for profile dimensions, piece counts, selected-paper output, card placement, and health metadata.
5. Update the README and version number.
6. Run processor tests, JavaScript syntax checks, and browser UAT for all four modes and both paper choices.

## Acceptance criteria

- The setup screen appears after every browser reload.
- All four modes and both paper formats are visible and keyboard selectable.
- `Change setup` reopens the chooser.
- Each mode changes canvas proportions and production dimensions correctly.
- Standard remains exactly 2,232 x 3,118 px with nine 744 x 1,039 px pieces.
- Vault exports a 2,339 x 3,331 px master and nine 780 x 1,110 px pieces.
- PSA uses a 948 x 1,596 px layout with a dedicated top label chamber.
- PSA defaults to an ink-saving cut-ready PDF with white label and card chambers and dotted cut guides.
- Piece PNGs, master PNG, and full-art PDF are optional and unchecked by default in the browser.
- 8x10 exports one 2,400 x 3,000 px image.
- The ZIP contains PDFs only for the selected A4 or US Letter paper when launched from the browser.
- Auto-align and `Print card in center` use the selected mode's card zone.
- Reloading the page does not bypass the chooser.
- The 1366 x 768 desktop view has no document scrollbar after entering the studio.
- The app makes no network request during normal operation.

## Reference limitation

The supplied [ChatGPT shared reference](https://chatgpt.com/s/t_6a6e708581f08191b8ff76fca1ca57cf) redirected to the ChatGPT home screen in both public fetch and the signed-in browser, so no visual details from that link could be recovered. The implementation therefore follows the explicit mode list, the existing Alignment Studio visual language, and the measurable contracts above.
