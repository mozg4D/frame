# Mill implementation checklist

Operational fixed-axis CAM is implemented within README.md limits. The full geometric-accuracy work is not finished: the open items below remain part of this checklist. complete means a verified program/result in the documented model; it does not certify the entire finished surface or a physical machine.

## Accepted human decisions

- Stock/Protected are global ordinary inherited tags, independent of CNC parenting.
- Native hierarchy/transforms remain unrestricted; unsupported skew/reflection/axis states are red/ignored.
- CNC may attach beneath a part/assembly.
- Solid reconstruction uses Printer cleanup, nested parity and occurrence union.
- Cutters extend upward infinitely; Step Down is a pass maximum, without holder/flute/stick-out UI.
- Green skips computation and retains helpers/descendants.

## Implemented stages

- [x] Shared full-domain Stock/Protected, actual subtractive revisions and native-preorder propagation.
- [x] Sparse fine tiles, bounded caches, explicit numerical/tolerance budgets and thin forbidden-feature envelopes; display LOD separate from machining precision.
- [x] Conservative GPU triangle-to-cell surface coverage for Stock/Target/Protected, including thin components missed by all isolated XYZ rays; bounded 3D inner/outer occupancy and analytic sweep replay.
- [x] Adaptive 3D residual/gouge audit over the operation's stock volume, including buried material; explicit unresolved and unvisited volume when budgets are reached.
- [x] Analytic infinite Flat/Ball/V cutters shared by accessibility, sweeps, verification, replay and display.
- [x] Continuous GPU subtraction and full-volume sweep checks, including out-of-box material.
- [x] Accessibility pyramids, clearing/pockets/islands/contours, nonplanar finishing, residual detection and bounded reachable-residual refinement.
- [x] Even bounded Step Down/Step Over, smaller finish/scallop spacing when needed.
- [x] Current-stock contact and signed-RPM climb selection; explicit full-slot/ambiguous cases.
- [x] Continuation/ramp/helix/peck, cumulative XY descent, quantized Feed/Plunge checks and constant-depth cleanup.
- [x] Direct/minimum-lift/XY-detour transitions, validated upper planes/descents and inter-operation position carry.
- [x] One immutable stream for simulation/time/Progress/export; bounded backward checkpoints and atomic N publication.
- [x] LinuxCNC/custom-state contract, Start once, same-tool continuation, mandatory manual changes, signed restart and final home/M5/M30.
- [x] Exact programmed feed/dwell time, explicit unknown rapid/acceleration/pause time and lower-bound UI.
- [x] Native GPU Stock/cut/path/cutter presentation, preserved materials/UVs, bounded AI operations and minimal .ngc export.
- [x] Independent cutter/sweep/stock/deviation/G-code oracles, native/random Progress, realistic nonplanar/thin/protected/multi-operation cases and completed-operation/frame/memory budgets in standard/stress discovery.

## Remaining work

- [ ] Certify solid interior and shell relationships independently of sampled XYZ cleanup labels, including disconnected thin shells, nested cavities and interpenetrating occurrences. Triangle surface coverage alone does not certify these interiors; sourceAccuracyCertified remains false.
- [ ] Verify end-to-end Tolerance in both directions over the whole finished part, including missing target material and uncertain cut/reference boundaries. The new excess-volume audit is one-sided and conditional on the source model; finishedSurfaceCertified remains false.
- [ ] Complete or resume adaptive volume refinement beyond the current cell/block/time limits, with retained unresolved work and bounded resources. A limited audit must continue to expose unvisited volume instead of reporting a complete geometric check.
- [ ] Prove accessibility or inaccessibility of every excess 3D region and refine reachable regions, including undercuts/cavities. Neither sampled top residuals nor unresolved volume cells are proof of inaccessibility.

## Model boundaries

Indexed/re-fixtured, reflected/skewed/degenerate setups require another physical model. Empty/ambiguous Stock remains diagnostic-only. General malformed/open interiors and shell classification are uncertified. Planning uses conservative top residual samples; a separate adaptive volume audit bounds remaining material and reports confirmed/possible excess and gouge. It does not prove every inaccessible region or both directions of finished-surface error. Cut patches are sampled display geometry. Tool calibration, machine offsets, rapid speed, acceleration and pause duration remain controller/setup inputs.

Keep README.md, AGENTS.md, app.md, plugins.md, schemas and tests synchronized. Runtime stays one plugin.js. Port to Printer only after separate relevance/correctness/performance verification.
