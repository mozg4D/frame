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
- [x] Independent bounded source-interior validation on native GPU geometry: exact Float32 predicates, exact position welding, closed edge incidence, self-intersection checks, nested parity and interpenetrating/occurrence union. Certified volume queries bypass XYZ cleanup labels; unsupported, ambiguous or over-budget sources remain explicitly uncertified.
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

- [x] Resume adaptive volume refinement across bounded cell/block/time passes using retained packed frontiers, per-job CPU limits, transactional block commits and cancellation/retry; continuation preserves the operation cut prefix and reports all unvisited volume.

- [x] Bidirectional native whole-part material and boundary-distance bounds, using certified interior/exterior witnesses, guarded distances, adaptive uncertainty and resumable bounded work across the complete captured Stock/Target domain.
- [x] Detect proved missing Target, including material absent from initial Stock, and reject N/G-code publication with retained defect detail; preserve floating Protected obstacle semantics.

## Remaining work

- [ ] Propagate source authoring/evaluator approximation error through end-to-end Tolerance over the whole finished part. Native whole-part verification now checks both material and boundary directions, missing Target and uncertain cut/reference cells; limited or unresolved results remain explicit. A native GPU-solid certificate is not an authoring-surface certificate, so sourceAccuracyCertified and finishedSurfaceCertified remain false.
- [ ] Prove accessibility or inaccessibility of every excess 3D region and refine reachable regions, including undercuts/cavities. Neither sampled top residuals nor unresolved volume cells are proof of inaccessibility.

## Model boundaries

Indexed/re-fixtured, reflected/skewed/degenerate CNC setups require another physical model. Empty/ambiguous sampled Stock remains diagnostic-only. The independent source certificate covers validated closed finite Float32 surface complexes within explicit resource limits. Open/nonmanifold edge incidence, degenerate faces, self-intersections, unresolved coincident or tangent shell relations, and capacity failures receive no certificate; their volume queries retain the labelled XYZ policy fallback. Cell mapping can remain uncertain even for certified source geometry. Source-interior validation does not certify a source-distance error bound or the finished part: sourceAccuracyCertified and finishedSurfaceCertified remain false. Planning uses conservative top residual samples. Whole-part native distance bounds include both directions, but do not establish authoring/evaluator approximation error or every inaccessible region. Cut patches are sampled display geometry. Tool calibration, machine offsets, rapid speed, acceleration and pause duration remain controller/setup inputs.

Keep README.md, AGENTS.md, app.md, plugins.md, schemas and tests synchronized. Runtime stays one plugin.js. Port to Printer only after separate relevance/correctness/performance verification.
