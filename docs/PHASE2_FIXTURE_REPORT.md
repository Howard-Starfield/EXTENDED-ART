# Phase 2 matcher fixture report

Date: 2026-08-02
Matcher: `phase2.1`
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

## Real-image gate

No supplied real card/artwork examples are present in this isolated checkout's
`reference/` directory. Therefore the three-real-example measurement gate is
not claimed as passed. Before P2-08 can be marked complete, add local fixtures
outside the public repository or otherwise provide permissioned test images,
then record their source dimensions, required manual correction, and measured
card-edge error separately from the synthetic results.
