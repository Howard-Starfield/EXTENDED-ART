# ExtendedArt Offline Workflow

## Install on Windows

1. Download **`ExtendedArt-Setup-v1.7.0.exe`** from the
   [latest GitHub release](https://github.com/Howard-Starfield/EXTENDED-ART/releases/latest).
2. Run the installer. It installs per user and does not require administrator
   access by default.
3. Open **ExtendedArt** from the Start Menu or the optional desktop shortcut.
4. ExtendedArt starts its offline service and opens the studio in your default
   browser. Use **Exit app** in the top bar when finished.

The release is not code-signed, so Windows SmartScreen may show an unknown
publisher warning. Verify the download came from the official GitHub release
before choosing **More info -> Run anyway**.

Turn one completed extended-art image into a customer-ready binder, slab, or
display-frame package without uploading the artwork anywhere.

The browser studio now opens with a print setup desk on every launch. Choose
the physical product and the paper before alignment:

| Product mode | 300-DPI master | Finished output |
| --- | --- | --- |
| Standard 3×3 Binder | 2,232 × 3,118 px | nine 63 × 88 mm inserts |
| Vault Binder | 2,339 × 3,331 px | nine 66 × 94 mm inserts |
| PSA Slab | 948 × 1,596 px | one 3.16 × 5.32 in insert |
| 8×10 Photo Frame | 2,400 × 3,000 px | one 8 × 10 in print |

Choose either A4 or US Letter. Browser-created packages contain PDFs for the
selected paper only.

The default Standard output is:

- physical full layout: **189 × 264 mm**;
- each insert: **63 × 88 mm**;
- A4 and US Letter cut-ready PDFs;
- print guide with a 50 mm calibration square;
- manifest, automated quality report, and one deliverable ZIP.

The 2,232 × 3,118 master PNG, nine 744 × 1,039 piece PNGs, and full-art PDFs
are optional extras. Browser and automatic workflows now default them off.

The image processing and PDF packaging are fully offline. GPT Image 2 is only
used beforehand if you choose to generate the artwork with it.

## Usage: browser alignment studio

1. Install the latest Windows release.
2. Open **ExtendedArt** from the Start Menu. If it is already running, opening
   the shortcut brings the existing local studio back in your browser.
3. Choose Standard 3×3, Vault Binder, PSA Slab, or 8×10 Photo Frame.
4. Choose A4 or US Letter, then select **Open alignment studio**.
   The same measured paper buttons remain beside **Grid**, **Card**, and
   **Difference**. They show each sheet size and the backend-calculated print
   scale, and can switch the export paper without reopening setup.
5. Drop the completed extended-art image into **Extended artwork**.
6. Drop a clean scan or image of the original game card into **Original card**.
7. Select **Auto align artwork**. The offline matcher applies a suggested zoom
   and X/Y position, then shows its confidence and matched card-art region.
8. Inspect the card edges. Drag the extended art under the fixed card zone or use
   the zoom slider, mouse wheel, arrow keys, or nudge buttons for fine alignment.
9. Lower **Card opacity** or turn on **Difference** to compare boundaries.
10. Set **Corner roundness** from 0 to 6 mm. The default 3 mm produces rounded
   insert PNGs and matching rounded cut guides while preserving the continuous master.
11. For PSA, **Print card in center** defaults off. The cut-ready PDF leaves
    the card chamber and top PSA label chamber white to save ink, with dotted guides.
12. For PSA, keep the measured-fit 69.85 × 21.59 mm label cutout or enter the
    width and height measured from the target slab in the right panel.
13. Under **Package contents**, optionally add piece PNGs, the 300-DPI master PNG,
    or the full-art PDF. These three extras are off by default.
14. Select **Create print package**, then download the completed deliverable.

Use **Change setup** in the top bar to switch product or paper without reloading.
Changing the product resets zoom and X/Y alignment because the canvas geometry
has changed; uploaded source previews remain available.

The top bar must show **v1.7.0** or newer.

The browser studio defaults to the selected cut-ready PDF, matching print guide,
reports, instructions, and ZIP. Piece PNGs, the master PNG, and the full-art PDF
are included only when selected. The aligned package is also saved in
**`READY_PRODUCTS`**, so closing the browser does not lose it.

### How auto alignment works

The matcher stays offline and compares grayscale structure, edges, and broad color
across several likely card-art regions. It searches the card zone defined by
the selected physical product, then searches zoom and X/Y position from
coarse to fine, applies the strongest match, and reports confidence instead of
silently claiming a perfect result. High confidence still needs a quick edge check.
For medium confidence, use Difference and the nudge controls. Low confidence usually
means the image generator redrew the subject or the card scan is cropped; treat the
suggestion as a starting point and align manually.

Image upload, alignment, product selection, paper selection, package options,
and export all happen in the browser studio. Nothing is uploaded to the internet.

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
└── ExtendedArtOffline.exe  Installed application engine
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
  "paper_format": "both",
  "include_pieces": false,
  "include_master": false,
  "include_full_art_pdf": false,
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
- Browser-only product profiles also include `psa` and `photo8x10`.
- `paper_format`: `a4`, `letter`, or `both`. The automatic workflow defaults to both.
- `include_pieces`, `include_master`, and `include_full_art_pdf`: optional extras;
  all default to `false` so the package contains only required print files.
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

## PSA Slab and 8×10 notes

The PSA mode targets the approximately 3.16 × 5.32 inch external envelope of a
modern PSA card holder. Holder generations and third-party slab frames vary, so
measure and test the exact physical product before advertising compatibility.
The audited PSA opening contract is:

- outer insert: **80.264 × 135.128 mm** / **948 × 1,596 px at 300 DPI**;
- recommended label cutout: **69.85 × 21.59 mm** (2.75 × 0.85 in), centered,
  with its top edge 5 mm from the insert;
- card opening: **63 × 88 mm**, centered, with its top edge 36 mm from the insert.

PSA publishes the 3.16 × 5.32 inch outer size but not an engineering drawing for
the internal paper label. The default is a measured-fit overlay cutout,
equivalent to 825 × 255 pixels at 300 DPI, with clearance around an approximately
68.6 × 20.3 mm label. In PSA mode, change **PSA label cutout** width and height
in the right panel for a measured genuine or aftermarket slab. Always print the
calibration guide and test one physical slab generation before sale.
Official references: [PSA holder dimensions](https://www.psacard.com/articles/articleview/10838/https%3A/images.ctfassets.net/l40e281thfxr/3wy7YSCujUEOK9OcflcQbi/46249989f24168c2aac7c687bfa49d1d/PSA_IG_T1_Holders_01__1_-1-.jpg),
[PSA 2024 holder update](https://www.psacard.com/articles/articleview/11060/public/public/locales),
and [PSA label/holder security](https://www.psacard.com/Security).
The PSA cut-ready PDF always leaves the top label chamber white. When
**Print card in center** is off (the PSA default), the card chamber is white
too. The slab edge, label chamber, and card chamber use dotted cutting guides.
This is the recommended ink-saving customer file. The master PNG, piece PNG,
and full-art PDF are optional reference assets and do not replace the
`psa_<paper>_cut_ready.pdf`.


An 8 × 10 inch print fits US Letter at exact size with the default safe margin.
On A4, the printable layout is slightly too wide once the safe margin is added,
so the cut-ready PDF scales to **99.4094%** and records the percentage in its
manifest and quality report. Frame mode now uses a visible mat-and-frame surround
on the alignment canvas; this is a preview treatment and is not printed into the art.

## Source-code setup

The installer includes `ExtendedArtOffline.exe`, so customers do not need Python.
To run from source:

1. Install Python 3.12 or newer.
2. Run `python -m pip install -r requirements.txt` once while internet access is
   available to install Pillow and ReportLab.
3. Run `python app/drop_workflow.py web`. The source version then runs offline.

To build the Windows release, install `requirements-build.txt`, run
`pyinstaller --noconfirm --clean ExtendedArtOffline.spec`, then compile
`installer/ExtendedArt.iss` with Inno Setup 6. The installer is written to
`release/ExtendedArt-Setup-v1.7.0.exe`.

The packaged executable and the normal workflow make no network requests.

## License

The software source is available under the [MIT License](LICENSE). Game card
artwork, characters, logos, and trademarks remain the property of their
respective owners; users are responsible for securing rights to material they
process or sell.
