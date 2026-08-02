# ExtendedArt Web delivery roadmap

Status: Phase 2 in progress

Gate record (2026-08-02): `npm.cmd run test` passes 34 tests, `npm.cmd run
build` passes, and `npm.cmd run test:browser` passes all 3 browser tests,
including worker-backed matching, progress locking, fallback messaging,
deterministic master/piece geometry, PSA/frame/binder masks, quality-report
diagnostics, synthetic matcher release gates, correction, and proof-download
flows. The browser project has not been published or pushed.

Repository checkpoints: commit 0755713 contains the Phase 1 browser-local
workflow; b58e40e is the Phase 1 hardening checkpoint; 6dd498c contains the
Phase 2 matcher, renderer, masks, quality report, and synthetic release gates.
P2-08 remains open for permissioned real-image fixtures. No remote push or
deployment has been performed.

Current launch scope ends with the browser-local print workflow and hosted
static pilot. Image 2 generation is explicitly excluded from this roadmap.

This is the execution roadmap for the browser version of ExtendedArt. It is
intentionally more specific than the product brief in WEB_MVP_PLAN.md. A
future build session should be able to open this file, find the first
unchecked task, and continue without redesigning the product contract.

## 1. Product definition

### One-sentence product

ExtendedArt Web turns an extended-art image and a required original game-card
reference into a correctly aligned, physically sized, cut-ready printable
package for binders, PSA-style slabs, and photo frames. The original card is a
local alignment reference and is never printed in the default package.

### Primary user

Collectors and small creators who already have an extended-art image and want a
repeatable way to align, size, print, cut, and install it without learning
professional layout software.

### Secondary users

- Etsy or marketplace sellers preparing digital downloads.
- Commission artists producing one-off layouts for collectors.
- Binder and slab collectors testing several paper and holder formats.

### Product gap

Existing workflows make the customer manually estimate card placement, page
scale, cut lines, and file selection. ExtendedArt should make those physical
decisions visible and measurable before a customer wastes paper or ink.

### Hard constraints

- The core workflow must work without an OpenAI API key.
- Basic image processing should happen in the visitor's browser.
- The default package must save ink and avoid unnecessary artifacts.
- Final dimensions must be derived from one shared profile contract.
- Cut-ready output must preserve exact physical size. The renderer must
  paginate a layout that does not fit; it must never silently shrink an insert.
- Guides must be visibly outside the finished artwork.
- A4 and US Letter must be real, distinct page sizes in both preview and
  export.
- The four audited profiles must remain stable before arbitrary templates are
  added.
- Runtime code, fonts, icons, PDF code, and ZIP code must be served from the
  site itself. The core workflow must not depend on a third-party CDN.

### Deliberately not part of the first public release

- Accounts, saved galleries, and permanent image storage.
- A marketplace, subscriptions, or payment collection.
- Server-side processing for the basic print workflow.
- Automatic support for every game-card format.
- AI image generation, prompts, generation routes, API keys, quotas, or billing.

## 2. Recommended user journey

1. Launch the site. The first setup screen asks what the user wants to create:
   Standard 3x3 Binder, Vault Binder, PSA Slab, or 8x10 Photo Frame.
2. Advance to a separate paper step and choose exactly one primary paper: A4
   or US Letter. A Back action returns to the product step without losing the
   choice. The setup screen shows the actual profile dimensions, expected
   master pixel size, page count, and any printer-margin warning.
3. Enter the main studio with the selected mode and paper already active. The
   main page must never silently fall back to Standard or A4.
4. Drop the extended artwork into the first intake box.
5. Drop the original game card into the second intake box. The original card
   is the alignment reference and is not printed in the cut-ready output.
6. As soon as both images finish decoding, automatically begin Auto-align. Do
   not require a second button press.
7. During alignment, show a blocking progress layer over the studio. Disable
   canvas clicks, dragging, zoom controls, paper controls, export, and mode
   changes until the job completes or the user chooses Cancel.
8. Report monotonic progress using these stages: Reading images 0-15%,
   Preparing comparison 15-30%, Finding the card 30-65%, Refining alignment
   65-90%, and Preparing preview 90-100%. Percentages describe completed work,
   not estimated time. On completion, show confidence and return control.
9. Inspect the center card at 100% preview. Drag, zoom, nudge, or reset only
   after the automatic job has completed.
10. Choose corner roundness, PSA label dimensions when relevant, and optional
    package contents. The optional with-card reference PDF and second-paper
    options are off by default.
11. Review the cut-ready preview. Card and PSA-label chambers are blank. Outer
    trim guides sit beyond the retained art; internal cutout guides sit inside
    the discarded white openings.
12. Create the package. The browser downloads one ZIP containing only the
    selected outputs, paper-specific print guides, print instructions, a
    quality report, and a manifest.
13. Print at 100% / Actual Size, verify the calibration square, and test one
    physical piece before producing a full run.

The workflow must always make the next action obvious. A user should never
need to understand the internal image pipeline to complete a print.

## 3. Product decisions and recommended defaults

| Decision | Recommended default | Reason |
|---|---|---|
| Basic processing | Browser-local | No upload privacy concern, no server bill, works on static hosting |
| Original card | Required before the automatic alignment can start | The matcher must compare the scene against the real card reference |
| Alignment start | Automatic after both images decode | Removes the extra button press and makes the workflow predictable |
| Alignment lock | Blocking progress overlay while matching | Prevents edits from racing the renderer and corrupting the scene state |
| Card overlay in alignment preview | On after the card loads | Lets the user inspect edge continuity; this is preview state only |
| Printed center card | Off | Binder cut-ready output contains eight outer inserts; PSA and frame output retain a blank card chamber |
| With-card reference PDF | Off; optional separate PDF | Provides a same-size visual reference without replacing or modifying the cut-ready PDF; never include the raw uploaded card file |
| Cut-ready PDF | Always included | It is the primary customer deliverable |
| Optional pieces | Off | Prevents a pieces folder from appearing when the customer did not request it |
| Master PNG | Off | Useful for creators, unnecessary for most print customers |
| Full-art PDF | Off | Avoids duplicating a large artwork file and saves ink |
| Primary paper | User chooses A4 or Letter in setup | Keeps first launch sequential and prevents a silent default |
| Second paper | Off; optional in Export | Allows a package to contain both paper sizes without complicating first launch |
| PSA label | 69.85 x 21.59 mm default | Recommended 2.75 x 0.85 inch cutout; allow safe custom dimensions |
| Outer trim guides | Inner edge at least 0.25 pt outside retained artwork | Avoids a line being embedded in the printed art edge |
| Internal cutout guides | Fully inside the white area that will be discarded | Keeps guide ink off retained artwork around card and PSA-label openings |
| Image retention | Session memory only; cleared on replacement, reset, tab close, or reload | No upload, localStorage, IndexedDB, service-worker cache, or server retention |
| AI generation | Excluded | The current product begins with user-supplied extended artwork |

## 4. Technical direction

### Stack

| Layer | Choice | Why |
|---|---|---|
| UI | Framework-free ES modules built with Vite | Keeps the current visual work while producing a static dist directory with hashed local assets and bundled workers |
| Image decode | Browser ImageBitmap, Canvas 2D, and EXIF-aware image loading | Available in modern browsers and sufficient for the audited profiles |
| Heavy processing | Web Worker with transferable buffers where supported | Keeps drag, zoom, and alignment responsive |
| Profile contract | Versioned JSON-like data module | Prevents dimensions from being duplicated in UI branches |
| PDF export | pdf-lib behind src/pdf-export.js | Runs in browsers and exposes explicit page sizes, image placement, text, and vector drawing; the adapter owns all geometry |
| ZIP export | @zip.js/zip.js behind src/zip-export.js | Supports browser streams, workers, and large archives without adding a server |
| Reference oracle | Existing Python processor and its tests | Keeps the desktop output contract authoritative during migration |
| Unit tests | Vitest plus Python reference tests | Covers browser math and cross-checks the corrected reference implementation |
| Browser tests | Playwright | Exercises real file intake, workers, canvas, focus locking, PDF/ZIP downloads, and reset behavior |
| Hosting | OpenAI Sites for the first hosted experiment; Cloudflare Pages as the independent fallback | The build remains host-agnostic and static |
| Backend | None for Phases 1-4 | Images, alignment, rendering, PDF creation, and ZIP creation stay in the browser |

The desktop application remains a reference oracle, not a runtime dependency
of the public browser site. Customer images and generated packages must not be
copied into the repository.

Pin Vite, pdf-lib, @zip.js/zip.js, Vitest, and Playwright in package-lock.json.
Add their licenses to THIRD_PARTY_NOTICES.txt. Required commands are npm ci,
npm run dev, npm run test, npm run test:browser, npm run build, and npm run
preview. Production output is dist/ and no host may publish the repository root
after the Vite migration.

### Repository shape after implementation

Split the current root shell into these modules before Phase 1 is complete:

- src/state.js: session state and reset behavior.
- src/profiles.js: standard, Vault, PSA, photo frame, paper, and version data.
- src/image-io.js: file validation, EXIF orientation, decoding, and cleanup.
- src/alignment.js: candidate search, scoring, confidence, and manual offsets.
- src/geometry.js: millimeters, pixels, points, page layout, and cutout boxes.
- src/renderer.js: preview canvas and final raster rendering.
- src/quality.js: source-size, upscaling, fit, and warning checks.
- src/pdf-export.js: PDF page boxes, piece placement, guides, and metadata.
- src/zip-export.js: deterministic archive assembly and memory limits.
- src/export.js: output selection, manifest, instructions, and download names.
- src/worker.js: worker entry point for expensive image operations.
- tests/: unit, fixture, package, and browser acceptance tests.

Keep these responsibilities separate. A UI button must not become the owner of
page geometry or file naming. If a filename changes, update this repository
map in the same commit.

## 5. Data model and contracts

The first phases are client-only, so these objects live in memory and are
discarded when the session is reset. Defining them now prevents a later hosted
version from inventing a second format.

### ImageAsset

- id: session-local identifier.
- role: extended_art or original_card.
- source_name: retained in memory only to derive a safe output slug; never shown
  in the drop-card body or written to the manifest.
- mime_type: accepted image type.
- source_width_px and source_height_px.
- decoded_width_px and decoded_height_px.
- object_url: temporary browser URL, revoked when replaced or reset.
- orientation_applied: boolean.
- fingerprint: non-reversible session hash used only to reject stale results.
- quality_notes: list of non-blocking warnings.

### ProductProfile

- id: standard, vaultx, psa, or photo8x10.
- version: profile contract version.
- label and description.
- insert or finished physical width and height in millimeters.
- grid columns and rows.
- master pixel width and height at 300 DPI.
- card chamber normalized box.
- optional PSA label normalized box.
- recommended corner radius.
- guide style.

### PaperProfile

- id: a4 or letter.
- physical width and height in millimeters.
- preview aspect ratio.
- exact-size fit result for the selected product.
- layout status: exact_one_page, exact_multipage, or
  exact_with_margin_warning.
- page count and minimum printer margins. A scaled percentage is allowed only
  in an on-screen overview or a clearly marked non-print reference proof.

### AlignmentState

- source crop rectangle.
- zoom.
- offset_x and offset_y.
- focus_x and focus_y.
- matcher method: center-fit, reference-match, or user-corrected.
- matcher_score and candidate_score_margin; diagnostic values, not an
  uncalibrated user-facing percentage.
- result_status: CENTERED_NOT_MATCHED, MATCH_APPLIED, MATCH_UNCERTAIN,
  CANCELLED, TIMED_OUT, or FAILED.
- whether the result was auto-applied.
- source_job_id and profile_version used to produce the result.
- human adjustment history for the current session.

### ExportOptions

- profile id and version.
- primary_paper: a4 or letter.
- include_second_paper, default false.
- show_card_overlay, preview-only and never consulted by cut-ready export.
- include_with_card_reference_pdf, default false. When enabled, include a
  separately named PDF rendered from the same geometry. Never include the raw
  uploaded original-card image in the ZIP.
- corner_radius_mm.
- psa_label_width_mm and psa_label_height_mm.
- include_pieces, default false.
- include_master, default false.
- include_full_art_pdf, default false.
- outer_guide_clearance_pt, fixed at 0.25 for v1.
- internal_guide_inset_pt, fixed at 0.25 for v1.
- output_color_space, fixed to sRGB for v1.
- png_pixels_per_meter, fixed to 11811 for 300-DPI PNG metadata.

### PageLayout

- paper id and exact page size in millimeters and PDF points.
- page count.
- ordered placements with piece position id, page index, x/y in points, and
  unscaled width/height in points.
- minimum remaining printer margin on each side.
- status: exact_one_page, exact_multipage, or exact_with_margin_warning.
- warnings that must appear in the UI, manifest, and instructions.

### PackageManifest

- schema_version.
- app_version.
- created_at.
- source dimensions, MIME type, and byte count without source path, filename,
  image bytes, or raw card data.
- selected profile and paper contracts.
- alignment state.
- export options.
- output file list with byte size and SHA-256 for every generated deliverable
  except manifest.json itself.
- page layout records and printable-piece position ids.
- warnings and print instructions version.

### QualityReport

- overall status: PASS, PASS_WITH_WARNINGS, or BLOCKED.
- source pixel and effective DPI assessment after the actual crop, not from the
  source file's DPI metadata.
- target master and insert dimensions.
- exact page-layout status, page count, margins, and any printer warning.
- alignment confidence.
- cutout dimensions.
- guide clearance verification.
- optional-output inclusion flags.
- actionable warnings.

The first release has no hosted records and needs no D1, R2, user accounts, or
database. Saved projects or analytics require a separate post-pilot plan.

## 6. Audited output contract

These values are the acceptance baseline. Any change requires an explicit
contract update and a regenerated reference fixture.

| Profile | Master size | Master / insert pixels at 300 DPI | Source pieces | Default printed pieces |
|---|---:|---:|---:|---:|
| Standard 3x3 | 189 x 264 mm | 2232 x 3118 / 744 x 1039 | 9 | 8 outer inserts; center omitted |
| Vault Binder | 198 x 282 mm | 2339 x 3331 / 780 x 1110 | 9 | 8 outer inserts; center omitted |
| PSA Slab | 80.264 x 135.128 mm | 948 x 1596 | 1 overlay | 1 overlay with two blank openings |
| 8x10 Photo Frame | 203.2 x 254 mm | 2400 x 3000 | 1 print | 1 print with blank card chamber |

Master dimensions come from rounding the complete physical size at 300 DPI.
Insert dimensions come from independently rounding one insert. Therefore a
master is not always exactly insert-pixels multiplied by grid count. Use
rounded master edges for slicing, then resample each slice to the canonical
insert dimensions. For example, Standard row source heights are 1039, 1040,
and 1039 pixels before each output piece becomes 1039 pixels. Tests must lock
this rule so a one-pixel seam cannot move between releases.

Other fixed values:

- Standard pocket: 63 x 88 mm.
- Vault insert: 66 x 94 mm.
- PSA card chamber: 63 x 88 mm, top 36 mm in the current profile.
- PSA card chamber left: 8.632 mm after horizontal centering.
- PSA label default: 69.85 x 21.59 mm, left 5.207 mm, top 5 mm.
- PSA custom label bounds: width 40-76 mm and height 10-30 mm. The label is
  always horizontally centered and retains the fixed 5 mm top offset. These
  bounds preserve at least 1 mm between the tallest label and card chamber.
- 8x10 card chamber: 63 x 88 mm, left 70.1 mm, top 83 mm.
- User corner radius range: 0-6 mm in 0.5 mm steps. Defaults are 3 mm for
  Standard, Vault, and PSA, and 0 mm for 8x10. PSA label and card chamber radii
  remain fixed at 1 mm and 3 mm respectively in v1.
- Manual zoom range: 100-250% in 1% steps, constrained so no output edge becomes
  uncovered. Card overlay opacity defaults to 72% and ranges from 0-100%.
- A4: 210 x 297 mm.
- US Letter: 215.9 x 279.4 mm.
- PDF A4 MediaBox: 595.276 x 841.890 pt; Letter MediaBox: 612 x 792 pt.
- Outer guide inner-edge clearance: 0.25 pt, approximately 0.088 mm or 1.04
  pixels at 300 DPI. The guide stroke center is displaced by half its width
  plus that clearance.
- Internal chamber guides are inset into the discarded white opening by half
  their stroke width plus 0.25 pt. No part of an internal guide may overlap
  retained artwork.
- All cut-ready trim guides use a visible dashed pattern. Preview guides may be
  thicker for visibility but must be labeled as preview-only geometry.
- PNG outputs use sRGB pixels and a pHYs value of 11811 pixels per meter in
  both axes. PDF physical size comes from points and does not depend on PNG DPI
  metadata.
- Default public output is the ink-saving cut-ready PDF: no raw original card,
  no center binder insert, and blank card/label chambers where defined.

### Exact page-layout matrix

The default gap between separate pieces is 2 mm. Cut-ready output always keeps
every piece at 100% physical size.

| Profile | A4 | US Letter |
|---|---|---|
| Standard 3x3 | One page, 3x3 positions, blank center, 8 printed pieces | One page, 3x3 positions, blank center, 8 printed pieces |
| Vault Binder | One page, 3x3 positions, blank center, 8 printed pieces | Two pages: top and middle rows on page 1 with blank center; bottom row on page 2 |
| PSA Slab | One centered exact-size overlay | One centered exact-size overlay |
| 8x10 Photo Frame | One exact-size print with 3.4 mm left/right margins; show a printer-margin warning | One centered exact-size print with 6.35 mm left/right margins |

Vault Letter must paginate because 282 mm of artwork cannot fit within a
279.4 mm Letter page even with zero margins. The 8x10 A4 page physically fits,
but many printers cannot print within 3.4 mm of both side edges; keep the
artwork exact and warn instead of shrinking it.

### Remaining known gaps for later phases

The original shell discrepancies were addressed by the Phase 1 implementation.
These items remain intentionally deferred and are not presented as completed:

- The exact physical page-layout matrix, including Vault Letter pagination and
  8x10 A4 printer-margin warnings, belongs to Phase 3.
- Cut-guide clearance must move from the browser preview contract into the
  deterministic PDF renderer in Phase 3.
- PDF and ZIP generation remain disabled until the package renderer is built;
  the Phase 1 proof is a separate PNG download.

## Phase 0 - Isolate the web project and freeze the contract

Status: Complete; commit c9a1853

Goal: Create a safe browser workspace beside the desktop application and make
the desktop output contract explicit before moving logic.

Depends on: None

Estimated effort: 1 session

### User-visible result

The project has a separate browser workspace and a first-launch UI direction,
but the desktop application remains available as the trusted production tool.

### Completed work

- Created ExtendedArt_Web as a sibling Git repository.
- Added a clean ignore file for build output, secrets, temporary files, PDFs,
  ZIPs, and browser test artifacts.
- Copied only relevant source, tests, reference assets, and documentation.
- Kept customer images, generated packages, caches, and runtime folders out.
- Copied the existing UI shell to the web project root.
- Reworded the shell for browser-local processing.
- Documented the collector print-bench visual direction.
- Added the first version of the profile and paper parity contract.
- Confirmed JavaScript syntax and static HTTP launch.

### Definition of done

- The new repository can be initialized, inspected, and served without the
  desktop Python service.
- The desktop repository has no changes caused by the copy operation.
- No API key is present in the browser project.
- The next task is clearly identified as Phase 1 image workflow work.
- The isolated repository has an initial checkpoint commit containing only the
  intended web source, references, and documentation.

### Checkpoint task

- [x] P0-01 Review the untracked file list, run the static smoke check, confirm
      no customer images or secrets are present, and create the initial web
      repository commit. Do not push or deploy without an explicit release
      request. Completed in c9a1853.

## Phase 1 - Browser-local studio and proof output

Status: Complete; core commit 0755713 plus the Phase 1 hardening checkpoint

Goal: Let one person choose the product and paper first, upload both required
images, watch a locked automatic alignment run to completion, fine-tune the
result, and download a browser-generated proof PNG.

Depends on: Phase 0

Estimated effort: 2-3 sessions

### What's new

- Two-step first launch: product only, then paper only, with Back and Continue.
- Real local file validation and image previews.
- Drag and drop plus file-picker intake.
- Original card reference layer with opacity control.
- Manual pan, zoom, reset, and keyboard nudging.
- Automatic alignment triggered after both images finish decoding.
- Blocking progress layer that prevents scene edits while alignment runs.
- Progress stages for reading, normalizing, and preparing the preview.
- Live A4 and Letter visual comparison.
- Corner roundness preview.
- A proof PNG download that reflects the current scene.
- Clear browser-local privacy messaging.

The Phase 1 proof is intentionally not the final PDF/ZIP package. It is a
small output that proves the scene model and preview are connected.

### State and data

- Keep ImageAsset, ProductProfile, PaperProfile, AlignmentState, and
  ExportOptions in memory.
- Revoke object URLs when an image is replaced, reset, or the page is unloaded.
- Do not persist session state or user preferences in Phases 1-4.
- Do not put image bytes in localStorage.

### Browser/API surface

- No server API.
- All inputs are File objects.
- All output is a browser Blob download.

### Frontend work

- Split the monolithic shell into modules without changing the current visual
  layout.
- On setup step 1, render only the four product cards. Do not preselect a
  product before the user acts. Continue stays disabled until one is selected.
- On setup step 2, render only A4 and Letter, the chosen product summary, exact
  page count, and any margin warning. Continue stays disabled until one paper
  is selected. Back preserves the product choice.
- Entering the studio commits both choices as one state transition. Change
  setup reopens step 1 with both choices preserved; Reset session clears them.
- Keep the left rail for intake, the center proof for alignment, and the right
  rail for physical settings.
- Keep the mode cards visually distinct: 3x3 grid, slab with header opening,
  and 8x10 frame.
- Show image previews in the drop cards instead of long filenames.
- Keep the filename out of the visible drop-card body. Show only pixel
  dimensions and file size after load; retain the filename internally for a
  safe output slug.
- Start Auto-align automatically after both required images finish decoding; do
  not make the user press a second button.
- Show a blocking progress layer during decode and alignment. Disable canvas,
  settings, paper, mode, and export interactions until the job completes or is
  cancelled.
- After completion, expose manual drag, zoom, nudge, and reset as correction
  tools rather than as an alternative to uploading the original card.
- Disable final package export until Phase 3 is complete; make the proof
  download clearly separate.
- Make the selected paper visible in the live contract line and preview.
- Keep the original card visible as a semi-transparent reference layer while
  aligning, but exclude it from the cut-ready output.
- Add an Include with-card reference PDF option, default off. It must create an
  explicitly named optional with-card reference PDF in Phase 3 and must not
  alter the default cut-ready artwork. Do not export the raw uploaded card.
- Remove the current default-checked Print card in center behavior. Preview
  visibility and export inclusion are independent controls.

### Image handling work

- Accept PNG, JPEG, and WebP.
- Reject zero-byte files, extension/MIME mismatches, and formats whose decoded
  signature is not PNG, JPEG, or WebP.
- Enforce 50 MiB compressed per image, 80 megapixels decoded, and 16,384 pixels
  on either decoded dimension. Explain which limit failed before allocating a
  full output canvas.
- Decode images with orientation applied.
- Treat the original-card upload as a tightly cropped 63:88 reference. If its
  aspect ratio differs by more than 5%, block reference matching and explain
  that the image must be cropped to the card edges. A crop editor is not part
  of v1. Warn below 630 x 880 pixels and block matching below 252 x 352 pixels.
- Detect and report very small sources before attempting a large render.
- Compute effective source DPI from the post-crop source pixels divided by the
  selected physical output inches. Ignore file DPI metadata for quality
  classification. PASS is at least 300 effective DPI; 200-299 is a warning;
  100-199 is a strong warning; below 100 blocks the final package until the
  user explicitly acknowledges it. Phase 1 proof download remains available.
- Use a low-resolution preview for interaction and preserve the original
  decoded bitmap for the proof render.
- Release ImageBitmap, canvas, and object URL resources after replacement.

### Alignment work

- Implement a deterministic center-fit baseline first so the progress flow can
  be tested before the full matcher is finished.
- Trigger the job from the completion of both image decodes.
- Debounce the trigger into one job after both current assets are ready. Replacing
  either image or changing product cancels the active job and starts a new one;
  changing paper does not rerun alignment.
- Give each job a cancellation token and a job id so stale results cannot
  overwrite a newer upload.
- Disable pointer and keyboard scene edits while the job is active.
- Announce progress through an aria-live status and restore focus to the result
  summary when the job finishes.
- Preserve the baseline separately from user offsets.
- Never claim reference-match confidence for a center-fit result.
- Store the Phase 1 result as method center-fit, status CENTERED_NOT_MATCHED,
  confidence null. Show: "Centered only - reference matching is not complete;
  inspect the card edges and fine-tune."
- For the Phase 1 baseline, show only real stages: Reading images 0-25%,
  Normalizing scene 25-75%, Preparing preview 75-100%. Phase 2 replaces these
  with the full matching stages from the user journey.
- Keep every studio control inert during the job except Cancel. Set aria-busy
  on the studio, trap focus in the progress layer, and return focus to the
  result summary. Cancel returns to the ready-to-align state without changing
  the last completed alignment.
- Add keyboard nudging in master-output pixels: arrows move 1 pixel; Shift plus
  arrows moves 10 pixels. Reset restores the latest automatic baseline, not
  the initial file-center transform.
- Store zoom as a scale and translation as normalized master coordinates;
  derive displayed pixel offsets from the selected master dimensions.

### Phase 1 proof contract

- Filename: <slug>_<profile>_alignment_proof_300dpi.png.
- Exact dimensions: selected profile master pixels.
- Contains only the transformed extended artwork. It does not contain the
  original card, preview opacity, grid, rulers, warnings, or cut guides.
- Encodes sRGB pixels and 11811 pixels per meter in the PNG pHYs chunk.
- Is labeled Alignment proof in the UI and manifest copy; it is not called
  cut-ready and is not put in a ZIP during Phase 1.
- Download is enabled only after both images load and one alignment job has
  completed or been manually corrected.

### Ordered implementation checklist

- [x] P1-01 Add package.json, package-lock.json, Vite, Vitest, Playwright, and
      required scripts; verify the existing dist/ and test-artifact ignore
      rules; confirm the current shell builds before changing behavior.
- [x] P1-02 Move state, profiles, image intake, rendering, quality, and worker
      ownership into the documented src/ modules without changing visible
      geometry.
- [x] P1-03 Replace the combined launch gate with the two-step product/paper
      wizard and correct every 9 inserts label to 8 printed inserts plus card.
- [x] P1-04 Implement signature-based image validation, the fixed byte/pixel
      limits, orientation-safe decoding, preview lifecycle, and object cleanup.
- [x] P1-05 Make both uploads required, remove Image 2 wording, and auto-start
      one cancellable center-fit job when both current assets are ready.
- [x] P1-06 Implement the blocking progress dialog, job ids, stale-result
      rejection, focus handling, timeout/error states, and control locking.
- [x] P1-07 Implement correction controls with the specified zoom, opacity,
      nudge, reset, pointer, keyboard, and touch behavior.
- [x] P1-08 Implement the clean alignment-proof PNG path, including exact master
      dimensions, sRGB output, and the 11811-pixels-per-meter pHYs chunk.
- [x] P1-09 Implement effective-DPI classification and all user-facing quality
      messages without trusting source DPI metadata.
- [x] P1-10 Complete the Phase 1 automated and real-browser checklist and record
      the gate result before starting reference matching.

### Quality and testing checklist

- [x] Add browser unit tests for millimeter-to-pixel and aspect-ratio math.
- [x] Add tests for file type, file size, and missing-reference states.
- [x] Add boundary tests for 50 MiB, 80 megapixels, and 16,384-pixel limits.
- [x] Add tests that the second decoded image automatically starts alignment.
- [x] Add tests that pointer, keyboard, paper, preview, and export actions are
      ignored while alignment is active.
- [x] Add tests for cancellation and stale-job rejection.
- [x] Add a fixture with a synthetic 3x3 scene and a known center card.
- [x] Verify the proof PNG has the exact profile master pixel dimensions.
- [x] Verify the proof PNG has a 11811-pixels-per-meter pHYs chunk and never
      contains the original card overlay or UI guides.
- [ ] Verify corner radius changes the alpha mask without changing dimensions
      (deferred to the Phase 2 piece renderer).
- [x] Verify replacing an image revokes the old object URL.
- [x] Test keyboard focus, Enter/Space activation, and coarse pointer dragging.
- [x] Test a narrow laptop viewport without creating a persistent horizontal bar.
- [x] Run the static server smoke test and a real browser upload test.

### Definition of done

- A user can complete the full Phase 1 flow without a backend.
- The proof PNG matches the selected profile's master dimensions.
- The setup is genuinely sequential and neither product nor paper is silently
  selected for a first-time session.
- Paper selection changes both the UI preview and the stored export option.
- The browser never requests /api/health, /api/auto-align, or /api/export.
- Uploading the second required image automatically starts alignment.
- Alignment progress blocks edits and reports meaningful stages.
- Manual alignment changes are visible immediately and survive a render resize.
- A quality message prevents the user from mistaking a low-resolution source for
  a high-quality 300 DPI file.

## Phase 2 - Deterministic image pipeline and reference matching

Status: In progress; P2-01 through P2-07 are implemented in the current
working checkpoint

Goal: Replace the center-fit placeholder with a real, explainable local image
pipeline that can detect the card reference and render the exact master and
piece images.

Depends on: Phase 1

Estimated effort: 2-3 sessions

### What's new

- EXIF-safe, deterministic normalization.
- Coarse-to-fine reference matching.
- Alignment confidence and ambiguity warnings.
- Final master rendering for every audited profile.
- Piece slicing for binder layouts.
- PSA header and card-chamber masks.
- Outside-art trim guides in the preview.
- Source quality and effective-DPI diagnostics.
- Worker-backed processing for large images.

### Recommended auto-align algorithm

The first matcher should be conservative and explainable:

1. Apply orientation and color-space normalization, then create comparison
   copies whose longest side is at most 1200 pixels. Never compare a screenshot
   of the preview canvas.
2. Fit the original card to the profile's physical card chamber and ignore the
   outer 3% border during scoring so card-frame edges do not dominate.
3. Build grayscale luminance and Sobel gradient-magnitude planes for both
   inputs. Normalize local contrast before scoring.
4. Begin from the Phase 1 cover-fit transform. Search uniform artwork zoom from
   1.00 to 1.30 and x/y translation within 15% of the master width/height.
   Record the coarse step size in the matcher version.
5. Score each candidate as 70% normalized gradient correlation and 30%
   normalized luminance correlation inside the card chamber. Reject candidates
   whose transformed artwork leaves any output edge uncovered.
6. Refine the best five candidates at twice the coarse comparison resolution
   and with smaller translation and scale steps.
7. Return best score, second-best score, score margin, zoom, offsets, elapsed
   time, comparison size, and matcher version. Do not display the raw score as
   a human confidence percentage unless it has been calibrated.
8. Initial auto-apply gates are best score at least 0.78 and score margin at
   least 0.06. Keep the values in versioned profile data. Change them only with
   a fixture report that preserves the negative-case release gates.
9. Independently reject a reference whose comparison texture has a periodicity
   score of at least 0.995. This prevents a repeated stripe or tile pattern
   from being treated as a unique card match; report the diagnostic instead of
   changing the calibrated score and margin gates.
10. If either score gate or the periodicity gate fails, retain the completed
   center-fit baseline and show
   "No reliable automatic match - inspect and align manually." Do not apply a
   weak candidate.
11. Preserve manual corrections as deltas from the accepted baseline. Paper
   changes and final renders must not silently re-run the matcher.

The matcher uses the card chamber for all four profiles. PSA label dimensions
affect only the output mask; there is no PSA-label image upload or label matcher
in the current scope. If the card cannot be found, the app must report that
condition instead of inventing a high-confidence result.

Alignment has a 90-second hard timeout. At 30 seconds the progress layer may
say the image is taking longer than usual. At 90 seconds, terminate the job,
retain the last completed center-fit baseline, and offer Retry or manual
correction. A timeout is not a low-confidence result.

### Image pipeline work

- Create one geometry module for mm, px, pt, normalized boxes, and page fit.
- Apply EXIF orientation before any crop or comparison.
- Normalize the selected scene to the exact master pixel dimensions.
- Use high-quality resampling for final output and a cheaper resampling method
  only for interactive previews.
- Apply rounded corners with an alpha mask, not by changing the crop geometry.
- Slice binder masters using deterministic rounded edge coordinates.
- Assign binder position ids TL, TC, TR, ML, C, MR, BL, BC, and BR. Keep C in
  the master model but omit it from the default printed-piece list.
- Keep the trim guide center outside the artwork by the measured clearance.
- Render PSA label and card chambers, the 8x10 card chamber, and the occupied
  binder center as blank or omitted areas only in cut-ready rendering. Preserve
  the continuous scene in the master and alignment proof.
- Apply user-defined PSA label width and height only within safe bounds.
- Report when a source is enlarged and calculate the effective source DPI.
- Treat metadata DPI and actual available pixels as separate facts.
- Keep final rendering in sRGB. Do not promise CMYK conversion or printer color
  matching in the browser release.

### Worker work

- Move comparison resizing, edge-map creation, candidate scoring, and final
  large raster renders to a worker.
- Transfer ImageBitmap or typed buffers where supported.
- Send progress events for decode, match, render, and package stages.
- Require every worker message to carry job_id, stage, completed_work, and
  profile_version. Ignore messages from any job other than the active job.
- Cancel a stale job when the user replaces the artwork or changes profile.
- Keep the UI responsive while a large image is being processed.

### Ordered implementation checklist

- [x] P2-01 Add worker-side luminance, contrast normalization, and Sobel edge
      preprocessing with versioned parameters.
- [x] P2-02 Implement bounded coarse transform search and uncovered-edge
      rejection from the center-fit baseline.
- [x] P2-03 Implement five-candidate refinement, result diagnostics, and the
      versioned 0.78 score / 0.06 margin auto-apply gates.
- [x] P2-04 Connect match, uncertain, cancel, timeout, failure, and retry states
      to the progress UI without allowing stale worker results.
- [x] P2-05 Implement exact master rendering, rounded-edge slicing, canonical
      position ids, and the eight-piece binder print list.
- [x] P2-06 Implement PSA, 8x10, and binder chamber masks plus separate outer
      and internal preview-guide geometry.
- [x] P2-07 Implement the quality report, effective-DPI calculations, alignment
      diagnostics, and version stamps.
- [ ] P2-08 Complete the synthetic and real-example fixture reports and pass the
      false-positive and geometric-error release gates.

### Quality and testing checklist

- [x] Build a synthetic fixture suite with known translations, scale changes,
      repeated colors, low contrast, and no-card scenes.
- [ ] Generate reference JSON from the Python processor for every profile.
- [ ] Compare browser master and piece dimensions to the reference contract.
- [x] Verify the PSA label box for default and custom dimensions.
- [ ] Verify guide clearance at the raster preview boundary.
- [ ] Verify A4 and Letter page-fit math differs where the physical page differs.
- [ ] Test source images below, equal to, and above the target pixel count.
- [ ] Test cancellation while decoding and while matching.
- [ ] Test multiple consecutive jobs for memory leaks.
- [x] Verify rounded corner alpha masks preserve piece dimensions.
- [x] Record the matcher thresholds and fixture scores in a versioned report.
- [x] On synthetic translation/scale fixtures, require median transformed-card
      corner error of 4 master pixels or less and maximum error of 10 pixels.
- [x] Require zero high-confidence auto-applies across the versioned no-card
      and repeated-pattern negative fixtures before release.
- [ ] Measure three supplied real examples separately and document required
      manual correction without using them to hide synthetic regressions.

### Definition of done

- The same input scene and settings produce the same browser raster output on
  supported browsers with exact dimensions and geometry. Cross-browser raster
  comparison must reach SSIM 0.995 or higher against the canonical fixture;
  any lower result requires a documented rendering investigation.
- Auto-align either produces a believable candidate with confidence evidence or
  clearly tells the user that manual correction is required.
- No matcher result is presented as perfect solely because a button was pressed.
- The four profiles, corner rounding, PSA cutouts, and paper contracts pass
  automated tests.

## Phase 3 - PDF, print-guide, and ZIP parity

Status: Pending

Goal: Produce the final customer ZIP entirely in the browser using the
corrected physical-size, filename, optional-output, pagination, and guide
clearance contract in this roadmap.

Depends on: Phase 2

Estimated effort: 2-3 sessions

### What's new

- Cut-ready PDF for A4 and US Letter.
- Optional PDF outputs only when selected.
- Optional piece PNGs only when selected.
- Optional master PNG only when selected.
- Optional full-art PDF only when selected.
- Optional with-card reference PDF only when selected.
- Print guide with a 50 mm calibration square.
- Manifest, quality report, and print instructions.
- One ZIP download with no empty pieces folder.
- Download progress and a clear browser-memory warning for very large packages.

### Default package contract

Unless the user opts in, the ZIP should contain:

- One cut-ready PDF for each selected paper size.
- One paper-specific print guide for each selected paper size.
- PRINT_INSTRUCTIONS.txt.
- manifest.json.
- quality_report.json.

It must not contain:

- A pieces directory when Include pieces is off.
- A master PNG when Include master is off.
- A full-art PDF when Include full-art PDF is off.
- A raw original-card image or card filename.
- A PSA-label image.

When Include with-card reference PDF is enabled, add one separately named PDF
per selected paper. It uses the same physical page geometry but fills the
occupied card chamber with the uploaded card. It never replaces or changes the
ink-saving cut-ready PDF and never adds the raw uploaded card file.

Optional Piece PNGs contain only printable pieces and no guides. Standard and
Vault export TL, TC, TR, ML, MR, BL, BC, and BR; the center C piece is omitted.
PSA and 8x10 piece PNGs include their white chamber masks. Optional Master PNG
always remains the continuous scene with no cutouts, card, grid, or guides.
Optional Full-art PDF is marked REFERENCE - NOT CUT READY and may scale the
continuous master to the chosen paper; it is never described as dimensionally
accurate cutting output.

### PDF geometry

- Set the PDF page media box to the exact A4 or Letter physical size.
- Place artwork using millimeter-to-point geometry, not by trusting viewer DPI
  interpretation.
- Keep every cut-ready piece at scale 1.000000. Use the exact page-layout matrix
  and pagination; do not offer fit-to-page as an export mode.
- Draw trim guides after calculating an outside offset so no guide stroke lands
  in the art.
- Use dashed guides for every outer trim path. Place chamber guides fully inside
  the white area that will be removed.
- White-fill card and label chambers to save ink.
- Omit the occupied binder center position entirely from default print output.
- Keep the original card visible in preview only unless the user explicitly
  requests the separately named with-card reference PDF.
- Put print-at-100% instructions on the page and in the text guide.
- Include a calibration square and a warning to test the actual printer,
  paper, sleeve, and holder combination.

### Filename and archive rules

- Derive a safe slug from the uploaded artwork name.
- Keep one deterministic naming function for the UI, manifest, PDFs, PNGs, and
  ZIP.
- Use profile and paper names in every output filename.
- Use lower-case machine-safe extensions and readable human labels.
- Sort archive entries deterministically.
- Omit unselected files and empty directories.
- Use these v1 names:
  - <slug>_<profile>_<paper>_cut_ready.pdf
  - <slug>_<profile>_<paper>_with_card_reference.pdf
  - <slug>_<profile>_<paper>_print_guide.pdf
  - <slug>_<profile>_master_300dpi.png
  - pieces/<slug>_<profile>_<position>_300dpi.png
  - PRINT_INSTRUCTIONS.txt, manifest.json, and quality_report.json
- Name the archive
  <slug>_<profile>_<paper-set>_print_package_<UTC timestamp>.zip. Inject a fixed
  clock in tests so package-name fixtures remain deterministic.
- Sanitize the slug to letters, numbers, hyphen, and underscore; collapse
  repeated separators; limit it to 60 characters; and use extended_art when
  nothing remains.
- Never include source paths or hidden browser-generated names in an archive.

### Browser implementation work

- Add a PDF renderer module and test its page boxes before testing aesthetics.
- Add a ZIP writer with streaming output where browser support permits. Before
  rendering, estimate peak memory as decoded inputs plus final rasters plus PDF
  and archive buffers. Warn above 512 MiB and block above 1 GiB unless a tested
  lower-memory path is active.
- Build PDFs from the final raster pieces, not from a screenshot of the UI.
- Build the manifest from the same normalized state used by the renderer.
- Generate print instructions from the manifest rather than duplicating text.
- Report file sizes before assembling the final ZIP where possible.
- Release intermediate blobs after the ZIP is created.

### Ordered implementation checklist

- [ ] P3-01 Replace shrink-to-fit with the exact page-layout matrix in shared
      browser geometry and the Python fixture oracle; add Vault Letter
      pagination and the 8x10 A4 margin warning.
- [ ] P3-02 Implement the pdf-lib adapter with exact MediaBoxes, unscaled
      placements, dashed outer guides, inset internal guides, and page metadata.
- [ ] P3-03 Render cut-ready PDFs for every profile/paper combination and verify
      eight-piece binder output plus PSA/frame blank openings.
- [ ] P3-04 Implement the optional with-card PDF, piece PNGs, master PNG, and
      reference-only full-art PDF as independent opt-in artifacts.
- [ ] P3-05 Generate one paper-specific print guide per selected paper with a
      measured 50 mm square and actual-size instructions.
- [ ] P3-06 Generate PRINT_INSTRUCTIONS.txt, quality_report.json, and
      manifest.json from one normalized package model with SHA-256 entries.
- [ ] P3-07 Implement @zip.js/zip.js streaming assembly, deterministic entry
      order, progress, cancellation, memory estimation, and resource cleanup.
- [ ] P3-08 Complete PDF parsing, archive, viewer, browser-memory, and physical
      print tests before enabling Create print package.

### Quality and testing checklist

- [ ] Parse generated PDFs and assert A4 and Letter page boxes.
- [ ] Assert physical image placements and cutout boxes in points.
- [ ] Assert every cut-ready placement has scale exactly 1.0.
- [ ] Assert Vault Letter is two pages and 8x10 A4 remains exact size with a
      printer-margin warning.
- [ ] Assert no trim guide intersects an artwork rectangle.
- [ ] Assert no internal chamber guide intersects retained artwork.
- [ ] Assert default PSA output has blank label and card chambers.
- [ ] Assert the original card is absent from default cut-ready files.
- [ ] Assert the optional with-card reference PDF appears only when checked and
      the raw original-card file never appears.
- [ ] Assert default output has no pieces folder, master PNG, or full-art PDF.
- [ ] Assert opt-in output includes exactly the requested optional files.
- [ ] Assert archive entry order and manifest file list are deterministic.
- [ ] Compare browser page reports with Python reference reports.
- [ ] Open generated PDFs in at least two desktop PDF viewers.
- [ ] Print one A4 sheet and one Letter sheet and measure the calibration square.
- [ ] Test a large package on a low-memory browser profile.
- [ ] Parse PNG optional outputs and assert dimensions, sRGB intent, and 11811
      pixels-per-meter metadata.

### Definition of done

- A customer can download and print a package without the desktop application.
- A cut-ready PDF has the correct paper dimensions and no guide embedded in
  the art edge.
- A PSA cut-ready PDF includes the top label opening and card opening as blank,
  guided cutouts.
- Standard and Vault cut-ready output prints eight outer pieces and never wastes
  ink on the occupied center position.
- No cut-ready output is silently scaled to fit its page.
- Optional artifacts appear only when requested.
- The ZIP contents match the on-screen package summary and manifest.
- A fresh browser session can repeat the export without stale files or state.

## Phase 4 - Public static pilot and trust polish

Status: Pending

Goal: Make the browser workflow safe and understandable for real users while
keeping image processing local and avoiding an operating backend.

Depends on: Phase 3

Estimated effort: 2-3 sessions

### Hosting recommendation

Deploy the static browser build first through OpenAI Sites if Sites is enabled
for the Pro account. This is the shortest path because OpenAI manages the
hosting and the built-in Site URL; no separate Cloudflare account or Pages
project is needed.

Cloudflare Pages is the independent fallback when we want a separate hosting
account and full Git deployment control.
GitHub Pages remains a simple demo/documentation mirror.

The basic print workflow does not need D1, R2, API routes, or a server on either
host.

No D1 or R2 resource is needed for the local workflow. The site should not
upload a customer's original card merely because it is hosted on a web
platform.

### What's new

- Public landing and first-launch guidance.
- Browser capability check and a helpful unsupported-browser message.
- An install-free browser experience; no account, extension, or desktop helper.
- File-size and memory guidance before decoding.
- Responsive layout for laptop and tablet widths.
- Keyboard and screen-reader labels for all controls.
- Reset-session behavior that clears all object URLs and previews.
- Printable help page or in-app print guide.
- Clear privacy statement: images are processed locally in this version.
- Build version and contract version visible in the manifest.
- Error recovery for aborted renders and failed downloads.
- A trademark/compatibility notice stating that product and holder names are
  descriptive compatibility references and the site is not affiliated with
  card publishers, grading companies, or binder manufacturers.

### Infrastructure work

- Add a reproducible production build command.
- Pin production dependencies and commit the lockfile. Bundle dependencies,
  fonts, icons, and worker assets locally; do not load them from public CDNs.
- Add a static preview deployment for every release candidate.
- Add CSP and secure headers appropriate for a static app. The core policy must
  use connect-src 'none', restrict scripts/styles to the site, and allow only
  the blob/image/worker sources required by local processing. If the selected
  host injects its own traffic, document that separately from app traffic.
- Add a service worker that precaches only versioned application assets. Never
  cache user File objects, object URLs, generated PDFs, or ZIPs.
- Do not add analytics by default. If product research requires analytics,
  make it opt-in and do not collect image bytes or card names.
- Document the chosen host, deployment steps, rollback procedure, and release
  artifact.
- If Cloudflare is selected, start with Git integration from the
  ExtendedArt_Web repository. Use npm run build and publish only dist/.
- Add a Pages preview deployment for every pull request or release candidate.
- Keep the repository free of generated customer packages and secrets.

### UX and accessibility work

- Keep the launch mode choice understandable without prior knowledge of PSA
  or Vault dimensions.
- Show the physical result beside the pixel result.
- Make the difference between preview reference and printed output explicit.
- Keep A4 and Letter controls next to Grid, Card, and Difference controls.
- Show a visible frame treatment for 8x10 mode.
- Keep the bottom export area compact enough to avoid accidental page scroll,
  but allow normal scrolling on small screens.
- Provide a keyboard alternative to drag: arrow keys and larger nudge keys.
- Ensure warning text is not conveyed by color alone.
- The alignment progress layer sets aria-modal and aria-busy, exposes the stage
  and completed-work value, keeps Cancel reachable, and restores focus after
  completion, failure, or cancellation.
- On screens too narrow for the three-column studio, use normal vertical page
  scrolling and a sticky export summary. Never trap touch scrolling inside the
  canvas unless an active pointer drag began on the artwork.

### Browser support contract

- Release-test the latest two stable versions of Chrome, Edge, and Firefox on
  desktop. Safari is supported only after its full Phase 3 export suite passes;
  otherwise show a specific compatibility message before image selection.
- Required capabilities: File and Blob APIs, Canvas 2D, Web Worker, object URLs,
  typed arrays, and browser downloads. OffscreenCanvas and transferable
  ImageBitmap are optimizations, not hard requirements.
- A missing optimization must select a slower tested fallback. A missing
  required capability must block intake before the user spends time aligning.
- The first public release targets desktop and landscape tablet. Phones may
  inspect the site, but final high-resolution export is not promised until the
  memory and interaction suite passes on phones.

### Ordered implementation checklist

- [ ] P4-01 Finalize the Vite production build, hashed local assets, worker
      bundle, service worker, CSP, security headers, and version display.
- [ ] P4-02 Complete responsive, keyboard, screen-reader, touch, progress-dialog,
      and unsupported-browser behavior against the browser support contract.
- [ ] P4-03 Add privacy, compatibility/trademark, actual-size printing, memory,
      and recovery guidance; confirm text matches measured network behavior.
- [ ] P4-04 Produce a clean dist/ from npm ci, tests, and npm run build; deploy
      it to a private OpenAI Sites preview or the documented Cloudflare fallback.
- [ ] P4-05 Run deployed browser acceptance, network inspection, physical print
      acceptance, rollback rehearsal, and release-note checks before inviting
      pilot users.

### Quality and testing checklist

- [ ] Run a clean production build from a fresh checkout.
- [ ] Test the deployed site in Chrome, Edge, and Firefox.
- [ ] Test no-network use after the initial page load.
- [ ] Inspect network traffic while loading two fixtures, aligning, rendering,
      and exporting; assert that no request body contains image bytes.
- [ ] Test refresh and reset after selecting large images.
- [ ] Test screen-reader labels and keyboard-only completion.
- [ ] Test touch dragging without page-scroll traps.
- [ ] Verify the deployed build contains no API keys or local filesystem paths.
- [ ] Verify the privacy copy matches the actual network behavior.
- [ ] Verify service-worker caches contain only versioned application assets.
- [ ] If Cloudflare is used, verify its deployment is connected to the intended
      GitHub repository and production branch.
- [ ] Publish a release note with the exact profile contract version.

### Definition of done

- A new visitor can understand the four modes and complete a cut-ready export.
- The deployed app does not send image bytes anywhere in the core workflow.
- The public site has a documented rollback and reproducible build.
- The browser workflow is stable enough to invite a small pilot group.
- The compatibility and trademark notices are visible without interrupting the
  core workflow.

## Explicitly excluded from this roadmap

Image generation is not a deferred implementation phase. Do not add an Image 2
prompt, OpenAI API key, generation route, generation account, quota, billing
flow, or generated-asset storage while executing this roadmap. A future user
request may create a separate proposal, but it does not inherit approval from
this document.

## Post-pilot ideas requiring a separate approved roadmap

Possible features:

- Saved projects and reusable profile presets.
- Private share links for a commission client.
- Creator templates for different card games and holder brands.
- Batch processing for a customer who owns many cards.
- Print-on-demand fulfillment or a seller download catalog.
- Usage dashboard and support diagnostics.

These ideas require authentication, hosted storage, a data-retention policy,
billing decisions, and a formal support process. They are not phases in this
roadmap and must not be started from this document.

## 7. Build order summary

| Phase | User outcome | Server needed | Main new contract | Estimated sessions |
|---|---|---:|---|---:|
| 0 | Safe isolated project and frozen dimensions | No | Profile and paper baseline | Complete |
| 1 | Sequential setup, automatic center baseline, correction, proof PNG | No | Session and proof state | 2-3 |
| 2 | Explainable auto-align and exact raster output | No | Alignment and quality report | 2-3 |
| 3 | Final cut-ready PDFs and ZIP | No | Package manifest and PDF contract | 2-3 |
| 4 | Public static pilot | No | Release/privacy contract | 2-3 |

## 8. Runtime surface map

| Capability | Phase | Browser-only | Hosted route/storage |
|---|---:|---:|---|
| Upload and preview | 1 | File objects and object URLs | None |
| Auto-align | 2 | Worker and canvas | None |
| PNG proof | 1 | Blob download | None |
| PDF and ZIP | 3 | Blob download | None |
| Public static site | 4 | Static assets | None |

No active phase adds an API route, database, object storage, authentication, or
server-side image processing.

## 9. Test strategy

### Contract tests

- Every profile reports the expected master, insert, grid, and physical sizes.
- Every paper reports the correct page dimensions.
- A4 and Letter never collapse to the same page contract.
- PSA custom label dimensions are validated and reported.
- Binder source-piece count is nine while default printable-piece count is
  eight, with C omitted.
- PNG masters and pieces contain 11811 pixels-per-meter metadata.

### Geometry tests

- Millimeter, point, and pixel conversions are reversible within the chosen
  rounding tolerance.
- Cut guides are outside the artwork by the declared clearance.
- Rounded corners affect the mask but not the box size.
- Card and label cutouts are centered and have the expected top offsets.
- Internal cutout guide strokes remain entirely inside discarded white areas.
- Standard fits both papers on one exact-size page; Vault Letter uses two
  exact-size pages; 8x10 A4 stays exact with a margin warning.
- Rounded master edges produce the documented per-row/per-column source sizes
  before canonical piece resizing.

### Alignment tests

- Known synthetic translations are recovered within tolerance.
- A repeated-color false match is rejected or given low confidence.
- A no-card scene does not receive a high-confidence match.
- Manual offsets are preserved after paper changes.
- A profile change cancels stale work, resets profile-dependent offsets, and
  starts a new alignment when both assets remain loaded.

### Package tests

- Default package contains only required output.
- Optional package files appear exactly when selected.
- PDFs have correct page boxes and page counts.
- ZIP entries match the manifest.
- No empty pieces directory is created.
- No archive contains the raw original card or its source filename.
- The optional with-card PDF is additive and never replaces cut-ready output.

### Browser acceptance tests

- First launch mode selection.
- Upload by picker and drag/drop.
- Automatic alignment starts after both current images decode; no second click.
- Blocking progress, Cancel, timeout recovery, and focus restoration.
- Manual drag, nudge, zoom, opacity, and reset.
- PSA settings validation.
- A4/Letter preview toggle.
- 8x10 frame mode indicator.
- Proof and final downloads.
- Reset and repeat without stale images.

### Physical print tests

For every release candidate:

- Print one Standard A4 and one Standard Letter sheet.
- Print Vault A4 and both pages of Vault Letter; confirm every insert remains
  66 x 94 mm.
- Print one PSA sheet and measure the top label opening.
- Print one 8x10 Letter output. For A4, use a printer that supports the required
  3.4 mm side margin and confirm the app displayed the margin warning.
- Measure the calibration square and one finished opening.
- Test with the intended sleeve, binder, slab, frame, printer, and paper.

## 10. Release gates

Do not move to the next phase until the current gate passes:

- Gate 0: repository separation, initial checkpoint commit, no secrets, and
  contract tests green.
- Gate 1: browser-local proof output and manual alignment work end-to-end.
- Gate 2: matcher confidence is honest and deterministic fixtures pass.
- Gate 3: PDF measurements and ZIP contents match the reference.
- Gate 4: public static deployment has no server image upload behavior and a
  tested rollback.

Every phase boundary should have:

- A small commit with a phase-specific message.
- A clean test report.
- A short changelog entry.
- A screenshot or recorded browser acceptance result.
- Updated contract and roadmap status.

## 11. Resolved decisions and remaining inputs

Howard has confirmed these product decisions:

- First launch asks for product type, then paper size, before opening the main
  studio. The selected values carry into the main page.
- The original card is required for automatic alignment.
- Alignment starts automatically after both images finish decoding.
- Alignment blocks the interface with progress stages until completion or
  cancellation.
- The uploaded original card is excluded from cut-ready output by default.
- An optional with-card reference PDF can be selected, default off; the raw
  card upload is never packaged.
- Image generation is excluded from this roadmap. This plan grants no approval
  to add an OpenAI API key, generation UI, or generation backend later.
- OpenAI Sites is the recommended first hosted experiment because its managed
  Site URL does not require a separate Cloudflare setup. Cloudflare Pages is
  the independent fallback.

No unresolved product choice blocks Phases 1-4. The plan now fixes a 50 MiB
compressed upload limit, 80-megapixel decoded limit, one primary paper in
setup, and an optional second paper at export. Batch mode remains explicitly
deferred until single-card alignment and physical-print acceptance are stable.
