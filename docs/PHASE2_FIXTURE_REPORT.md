# Phase 2 matcher fixture report

Date: 2026-08-02
Matcher: `alignment-v4.0` with `phase2.1` correlation fallback
Profile contract: `phase2-profiles-1`

## Automated synthetic fixtures

The fixture suite runs through `npm.cmd run test` in
`tests/matcher-fixtures.test.js` and uses a deterministic 240×220 source scene
with a 72×100 reference card and a normalized 100×120 master. Positive fixtures
must auto-apply and stay within the Phase 2 transform-error budget of 0.03;
negative fixtures must never auto-apply.

| Fixture | Expected | Observed gate |
|---|---|---|
| Translation left / slight scale | Match | Accepted; transform recovered within 0.03 |
| Scale plus translation | Match | Accepted; transform recovered within 0.03 |
| Low contrast card texture | Match | Accepted; transform recovered within 0.03 |
| No-card scene | Reject | `NO_RELIABLE_MATCH`; score and margin gates fail |
| Highly periodic repeated texture | Reject | `NO_RELIABLE_MATCH`; periodicity score is 1.0 and auto-apply is blocked |

The repeated-texture fixture is intentionally retained because the original
score/margin gates alone accepted it at approximately 0.84 score and 0.08
margin. The `phase2.1` periodicity gate closes that false-positive path without
weakening the positive fixtures.

## Alignment v4 local-feature fixtures

Alignment v4 first uses browser-local Harris/BRIEF-style features, cross-checked
descriptor matches, and deterministic RANSAC. The renderer remains limited to
zoom and translation, so rotation, projective distortion, and missing
surrounding canvas are explicit rejection states rather than automatic applies.

| Fixture | Expected | Observed gate |
|---|---|---|
| Feature-rich artwork region with nonmatching card UI and full surrounding canvas | Match | `MATCH_APPLIED`; similarity transform recovered within tolerance |
| Same artwork region without one-card surrounding canvas | Reject safely | Genuine correspondence retained as `INSUFFICIENT_OVERSCAN`; baseline preserved |
| No-card scene | Reject | No auto-apply |
| Repetitive scene | Reject | No auto-apply |
| Four-degree rotation | Reject | `ROTATION_BEYOND_RENDERER_CONTRACT` |
| Projective correspondence | Reject | `PERSPECTIVE_BEYOND_RENDERER_CONTRACT` |

The legacy correlation score and separation gates remain fixed at 0.78 and
0.06. They are used only when local-feature evidence is too weak to establish
a correspondence.

## Permissioned local-image audit

One user-supplied card/art pair was tested locally without copying either image
into the repository. The result was deterministic across repeated runs:

- 24 cross-checked matches and 15 inliers (0.625 inlier ratio).
- Estimated card box in artwork: approximately 602 x 839 pixels.
- Required renderer zoom: approximately 0.588.
- Classification: `MATCH_UNCERTAIN` / `INSUFFICIENT_OVERSCAN`; no auto-apply.
- Required canvas: approximately 1793 x 2505 pixels at the source content scale.
- Browser UAT displayed actionable left/right/top/bottom extension amounts and
  preserved the 100% center-fit baseline.

The image files and their original filenames are not stored in tests, reports,
manifests, or the repository.

## Real-image gate

One permissioned pair has now been audited locally, but no real card/artwork
examples are committed to `reference/`. The three-real-example measurement gate
is therefore still open. Before P2-08 can be marked complete, audit at least two
additional permissioned pairs and record required manual correction and measured
card-edge error separately from the synthetic results.
