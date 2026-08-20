# Phase 3 release audit

Date: 2026-08-02
Scope: browser-local PDF, PNG, and ZIP print-package pipeline

## Automated evidence

The current synthetic release gate passes:

- `npm.cmd run test` — 67 tests passed across 16 files.
- `npm.cmd run build` — production build succeeds. The export engine remains a
  lazy-loaded chunk so the initial application bundle stays small; Vite reports
  the 581 KB minified export chunk as an optimization warning.
- `npm.cmd run test:browser` — all 7 Playwright tests passed.

The browser workflow test verifies the default and opt-in ZIP contracts. The
default archive contains only the cut-ready PDF, print guide, instructions,
quality report, and manifest. It does not contain the raw card, a pieces
directory, the master, or the full-art PDF. The opt-in archive verifies the
master dimensions (2,232 × 3,118 px), 300-DPI `pHYs` metadata (11,811 pixels per
meter), sRGB intent, standard-piece dimensions (780 × 1,075 px), and additive
exact-size A4 and US Letter PDFs when the second-paper option is selected.

The unit suite also verifies exact A4/Letter page boxes, Vault Letter
pagination, scale-1 placements, cutout geometry, blank PSA/frame chambers,
deterministic archive order, manifest hashes, cancellation, and memory
warnings.

## Open release gates

These checks are intentionally not marked complete without the required
external evidence:

1. **Permissioned real-image fixtures (P2-08).** The repository does not yet
   contain an approved real extended-art/card pair. Synthetic fixtures prove
   the matcher contract but cannot prove behavior across real artwork, glare,
   borders, scans, or photographs.
2. **PDF viewer review (P3-08).** Open representative A4, Letter, Vault Letter,
   PSA, and 8×10 outputs in at least two desktop PDF viewers. Confirm that the
   viewer is showing 100% geometry and that dashed guides remain outside the
   retained artwork.
3. **Physical print review (P3-08).** Print one A4 and one US Letter cut-ready
   PDF with scaling disabled. Measure the 50 mm calibration square and one
   standard 66 × 91 mm piece. Test the PSA blank label and 63 × 88 mm card chambers against
   the intended holder before publishing customer-facing dimensions.
4. **Large-package memory review (P3-08).** Exercise the browser warning and
   cancellation path with a large, permissioned input on a constrained
   profile. Confirm the UI remains recoverable after cancellation.
5. **Python-oracle comparison (P2/P3).** Compare normalized alignment and page
   reports against the reference implementation when approved fixtures are
   available; this is a cross-check, not a replacement for the browser path.

Until these items are closed, the implementation is suitable for a local
synthetic pilot and engineering review, not a claim of production print
accuracy for every real card image or holder.
