# ExtendedArt Web

Browser-first version of ExtendedArt for creating printable extended-art game-card packages.

This project is intentionally isolated from `ExtendedArt_Offline_Workflow`. The desktop application remains the reference implementation while this project ports the user-facing workflow to the browser.

## Current status

- Reference copies of the desktop processor, web UI, tests, and branding are under `reference/`.
- The browser MVP plan is in `docs/WEB_MVP_PLAN.md`.
- The detailed execution roadmap is in `docs/ROADMAP.md` (Phase 1 core
  implementation is complete; PDF/ZIP parity remains in later phases).
- Hosting choices and deployment steps are in `docs/HOSTING_SETUP.md`.
- No customer images or generated packages are copied into this project.

## Product direction

The first public workflow should process images in the visitor's browser whenever possible:

1. Choose Standard, Vault, PSA, or 8x10, then choose A4 or US Letter.
2. Upload extended artwork and the required original card.
3. Let browser-local alignment start automatically, then fine-tune it.
4. Preview the exact-size cut-ready layout.
5. Download a ZIP containing only the selected PDFs, instructions, quality
   report, and manifest.

The desktop Python implementation remains the fixture oracle for image and
package behavior. The web roadmap corrects two audited desktop behaviors before
parity is allowed: cut-ready pieces never shrink to fit a page, and internal
cutout guides sit fully inside discarded white openings. Image generation is
not part of this project.
