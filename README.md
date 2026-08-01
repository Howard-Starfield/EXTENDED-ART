# ExtendedArt Offline Workflow

Turn one completed vertical extended-art image into a customer-ready Standard
3×3 binder package without uploading the artwork anywhere.

The default Standard output is:

- full 3×3 master: **2,232 × 3,118 pixels at 300 DPI**;
- physical full layout: **189 × 264 mm**;
- each insert: **63 × 88 mm**;
- each insert PNG: **744 × 1,039 pixels at 300 DPI**;
- nine individual PNG pieces;
- A4 and US Letter cut-ready PDFs;
- A4 and US Letter full-artwork PDFs;
- print guide with a 50 mm calibration square;
- manifest, automated quality report, and one deliverable ZIP.

The image processing and PDF packaging are fully offline. GPT Image 2 is only
used beforehand if you choose to generate the artwork with it.

## Recommended: browser alignment studio

1. Extract the workflow ZIP to a normal folder.
2. Double-click **`START_ALIGNMENT_STUDIO.cmd`**.
3. Your browser opens a local alignment desk. Nothing is uploaded.
4. Drop the completed extended-art image into **Extended artwork**.
5. Drop a clean scan or image of the original game card into **Original card**.
6. Select **Auto align artwork**. The offline matcher applies a suggested zoom
   and X/Y position, then shows its confidence and matched card-art region.
7. Inspect the card edges. Drag the extended art under the fixed center card or use
   the zoom slider, mouse wheel, arrow keys, or nudge buttons for fine alignment.
8. Lower **Card opacity** or turn on **Difference** to compare boundaries.
9. Set **Corner roundness** from 0 to 6 mm. The default 3 mm produces rounded
   insert PNGs and matching rounded cut guides while preserving the continuous master.
10. **Print card in center** is on by default. Turn it off when the customer will
    place the physical card in the center pocket instead.
11. Select **Create print package**, then download the completed deliverable.

The browser studio creates the exact Standard master (2,232 x 3,118 px at
300 DPI), nine 744 x 1,039 px inserts, cut-ready PDFs, full-art PDFs, reports,
instructions, and a ZIP. The aligned package is also saved in
**`READY_PRODUCTS`**, so closing the browser does not lose it.

### How auto alignment works

The matcher stays offline and compares grayscale structure, edges, and broad color
across several likely card-art regions. It searches zoom and X/Y position from
coarse to fine, applies the strongest match, and reports confidence instead of
silently claiming a perfect result. High confidence still needs a quick edge check.
For medium confidence, use Difference and the nudge controls. Low confidence usually
means the image generator redrew the subject or the card scan is cropped; treat the
suggestion as a starting point and align manually.

## Quick start: automatic drop folder

1. Extract the complete workflow ZIP to a normal folder. Do not run it from
   inside the ZIP viewer.
2. Double-click **`START_AUTO_WORKFLOW.cmd`**. Leave the black workflow window
   open.
3. Copy a completed `.png`, `.jpg`, `.jpeg`, `.webp`, `.tif`, or `.tiff` image
   into **`DROP_IMAGES_HERE`**.
4. Wait until the workflow says `READY`.
5. Open **`READY_PRODUCTS`**. The file ending in `_DELIVERABLE.zip` is the file
   you can send to a customer.
6. The original input is moved safely to **`PROCESSED_INPUTS`**.
7. Press `Ctrl+C` in the workflow window when you want to stop watching.

Nothing is uploaded. Multiple images may be dropped into the folder together;
each image receives its own package and ZIP.

## Quick start: process a batch once

1. Put one or more images into **`DROP_IMAGES_HERE`**.
2. Double-click **`PROCESS_ALL_NOW.cmd`**.
3. Retrieve the finished ZIP files from **`READY_PRODUCTS`**.

This mode closes after the current batch instead of staying open.

## Quick start: drag directly onto the launcher

Drag one or more completed images onto **`DROP_IMAGE_ON_THIS_FILE.cmd`**. The
source images stay where they are, and the packages appear in
**`READY_PRODUCTS`**.

## What the automatic crop does

The default `crop` mode fills the full 3×3 print area without white bars:

1. It reads the source image and honors its camera/orientation metadata.
2. It crops the image to the Standard master ratio, centered by default.
3. It resizes the result to exactly **2,232 × 3,118 pixels**.
4. It writes 300-DPI metadata.
5. It divides the composition into a 3×3 grid.
6. It normalizes every piece to exactly **744 × 1,039 pixels**.
7. It creates correctly sized PDFs, instructions, and a verified ZIP.

The 1-pixel rounding difference is intentional. A complete 264 mm layout at
300 DPI rounds to 3,118 pixels, while one 88 mm insert rounds to 1,039 pixels
and three separately rounded inserts total 3,117 pixels. The workflow maps the
master's three rows and then normalizes each exported insert to the correct
744 × 1,039-pixel customer size.

Changing the DPI tag on a small image does not create detail. The quality
report records how much enlargement was required. Always inspect the master at
100% zoom and make one physical test print.

## GPT Image 2 artwork preparation

GPT Image 2 supports flexible image sizes, but its requested width and height
must be divisible by 16. Therefore the exact print master size 2,232 × 3,118
should be created by this offline workflow, not requested directly from the
model. A close generation size is **2,224 × 3,104**, which has nearly the same
aspect ratio and requires only a tiny final resize.

If a custom high-resolution request is unavailable in the interface you use,
choose a portrait result at the highest available quality. A practical fallback
is **1,536 × 2,144**; the workflow will crop and enlarge it, but a physical
detail check becomes more important.

Official references:

- [GPT Image 2 model](https://developers.openai.com/api/docs/models/gpt-image-2)
- [Image generation size rules](https://developers.openai.com/api/reference/resources/images/methods/generate)
- [GPT Image prompting guide](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide)

### Copy-and-paste generation prompt

Attach the game card as the visual reference, then use this prompt:

```text
Create one continuous, original vertical fantasy illustration for a 3×3
trading-card binder page, using the attached game card only as the visual anchor
for palette, lighting, atmosphere, environmental motifs, and composition.

The physical game card will occupy the center pocket later. Extend the scene
naturally outward in every direction so the surrounding eight pockets feel like
one seamless world connected to the card. Do not redraw or reproduce the card
frame, card text, logos, symbols, copyright line, rules text, watermark, or UI.
Do not add panel borders or a visible 3×3 grid.

Composition requirements:
- one continuous scene, never nine separate pictures;
- portrait target ratio matching 2,232 × 3,118 pixels (approximately 0.716:1);
- keep the center pocket visually compatible and moderately calm because the
  physical card will cover it;
- keep faces, hands, eyes, important creatures, and key objects away from the
  vertical seams at 33.33% and 66.67% of the width;
- keep those important details away from the horizontal seams at 33.33% and
  66.67% of the height;
- carry color, lighting, perspective, foliage, particles, fabric, clouds, or
  other environmental forms continuously across every seam;
- fill the canvas edge to edge with no blank margins;
- no text, no logos, no watermark, no signature, no card border, and no mockup;
- polished production illustration, coherent anatomy and perspective, rich
  fine detail, clean edges, print-friendly contrast, and no compression noise.

Generate as a high-quality opaque PNG. If custom dimensions are available, use
2,224 × 3,104 pixels. The offline packaging workflow will perform the exact
final crop and create the 2,232 × 3,118-pixel, 300-DPI Standard master.
```

### Important generation advice

- Generate a full continuous background. Do not ask the image model to create
  nine finished cards.
- Do not rely on generated card text. Keep the real game card separate and put
  it physically into the center binder pocket.
- If you own or have permission to use the original artwork, you can request a
  closer stylistic extension. For products you plan to sell, confirm character,
  artwork, logo, and trademark rights before listing.
- Generate several variations. Choose the one with the cleanest seam areas and
  best edge-to-edge continuation before dropping it into the workflow.

## Output folders

```text
ExtendedArt_Offline_Workflow/
├── DROP_IMAGES_HERE/       Put completed artwork here
├── READY_PRODUCTS/         Finished package folders and ZIP files
├── PROCESSED_INPUTS/       Successfully processed source images
├── FAILED_INPUTS/          Failed images and readable error reports
├── config.json             Default crop and output settings
|-- START_ALIGNMENT_STUDIO.cmd  Recommended browser alignment workflow
├── START_AUTO_WORKFLOW.cmd
├── PROCESS_ALL_NOW.cmd
└── DROP_IMAGE_ON_THIS_FILE.cmd
```

Inside each customer ZIP:

```text
PRINT_INSTRUCTIONS.txt
<name>_manifest.json
<name>_quality_report.json
standard/
├── <name>_standard_master_300dpi.png
├── <name>_standard_print_guide.pdf
├── pdf/
│   ├── <name>_standard_a4_cut_ready.pdf
│   ├── <name>_standard_a4_full_artwork.pdf
│   ├── <name>_standard_letter_cut_ready.pdf
│   └── <name>_standard_letter_full_artwork.pdf
└── pieces/
    ├── <name>_standard_piece_01.png
    └── ... through piece_09.png
```

## Print and quality test before selling

1. Open the Standard A4 or Letter `cut_ready.pdf`.
2. Print at **100%** or **Actual Size**.
3. Disable **Fit to Page**, **Shrink Oversized Pages**, and printer borderless
   expansion.
4. Print the supplied print guide and measure its square. It must be exactly
   **50 × 50 mm**.
5. Measure one cut insert. It must be **63 × 88 mm**.
6. Check the print from normal viewing distance and close up for pixelation,
   halos, malformed details, color banding, and overly dark shadows.
7. Cut all nine pieces and test them in the exact binder/sleeve product you will
   advertise.
8. Confirm that the seams read as one composition after the real game card is
   placed in the center pocket.

An automated `PASS` verifies dimensions and package structure; it cannot prove
printer color, paper behavior, physical fit, or commercial artwork rights.

## Adjusting the automatic crop

Edit **`config.json`** while the watcher is stopped.

```json
{
  "profile": "standard",
  "source_mode": "crop",
  "focus_x": 0.5,
  "focus_y": 0.5,
  "gap_mm": 2.0,
  "scale_mode": "fit",
  "safe_margin_mm": 4.0,
  "corner_radius_mm": 0.0,
  "keep_unzipped_package": true,
  "poll_seconds": 2.0,
  "settle_seconds": 3.0
}
```

- `focus_x`: `0` keeps the left side, `0.5` centers, and `1` keeps the right.
- `focus_y`: `0` keeps the top, `0.5` centers, and `1` keeps the bottom.
- `source_mode`: use `crop` for edge-to-edge art; use `fit` only when white bars
  are preferable to cropping.
- `profile`: `standard`, `vaultx`, or `both`. Standard is the default product.
- `corner_radius_mm`: `0` keeps square pieces; values up to `12` create rounded
  insert PNGs and rounded cut guides.
- `keep_unzipped_package`: set to `false` if you want only ZIP files.

### Different focus for one image

Create a small JSON file beside the image with the same filename. For example:

```text
moon-garden.png
moon-garden.json
```

`moon-garden.json` could contain:

```json
{
  "focus_x": 0.42,
  "focus_y": 0.35
}
```

Only that image uses those focus values. This is useful for batch production
when one composition is off-center.

## Optional Vault X-compatible package

Change `profile` to `vaultx` or `both` to add 66 × 94 mm inserts. Use A4 for
true-size Vault X-compatible output. Three 94 mm rows cannot fit on US Letter at
100%, so the Letter PDF is automatically scaled and clearly reported.

## Source-code setup

The release includes `ExtendedArtOffline.exe`, so customers do not need Python.
If you intentionally remove the executable and want to run from source:

1. Install Python 3.12 or newer.
2. Double-click **`SETUP_PYTHON_VERSION.cmd`** once while internet access is
   available to install Pillow and ReportLab.
3. After setup, the source version can run offline.

The packaged executable and the normal workflow make no network requests.
