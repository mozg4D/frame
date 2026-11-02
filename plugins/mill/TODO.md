# Mill implementation checklist

Operational fixed-axis CAM is implemented within README.md limits. Bounded authoring-source envelopes, full-part residual accessibility and verified residual correction are implemented. Precision and completeness are explicit certificate flags; model/resource limits below remain part of the contract. complete means a verified program/result in the documented model; it does not certify the entire finished surface or a physical machine.

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

- [x] Shared source-approximation metadata for canonical polygons and supported cubic/straight-planar cells, exact continuity checks, safe physical affine bounds and explicit unsupported reasons.
- [x] Propagate proved source bands through planning, collision, volume subtraction and whole-part covers; certify supported authoring surfaces only after complete verification, without a final-distance shortcut.

- [x] Prove supported curved planar cap fills, including separated holes and two-curve lenses, using exact boundary/triangulation checks and bounded source homotopy; remove fictitious straight-rail parameter error.

- [x] Conservative coefficient/ribbon reference enclosures for general 2/3/4/5-sided cells, explicit full-domain bands for unproved planar and multi-component references, fresh cached-HASH attestations and versioned authored polygon deformation bounds. Coarse bounds retain their entire width.
- [x] Bounded continuous XY cutter-pose covers using certified GPU interior witnesses, whole-part union of supported setups, distinct reachable/inaccessible/unresolved reports, guarded Ball tangencies and verified operation-volume residual refinement.

## Final source and residual stages

- [x] Extend proved authoring-source envelopes to general spline cells and unproved planar boundary families using actual coefficient/ribbon enclosures; use a full-domain band when no tighter contract is proved. Validate separated multi-component relationships on the shared GPU, with an explicit enclosing-domain fallback for unresolved relationships. Rebuild unattested cached HASH surfaces and bound authored Morph/point-animation arithmetic. No error bound is capped to force a machining certificate.
- [x] Cover every candidate excess 3D region with a bounded continuous accessibility test; distinguish reachable, proved inaccessible and unresolved results. Retain/resume unresolved packed frontiers, search adaptively inside thin obstacles, and refine reachable regions through verified operations and whole-part correction cycles in native preorder. Publish positive accessibility certification only after the complete domain and every excess region are resolved; capacity/precision limits remain explicit.

No implementation stages are left unchecked. This does not remove the finite resource and proof limits below or turn a conservative enclosing-domain bound into a small machining error.

## Model boundaries

Indexed/re-fixtured, reflected/skewed/degenerate CNC setups require another physical model. Empty/ambiguous sampled Stock remains diagnostic-only. The independent source certificate covers validated closed finite Float32 surface complexes within explicit resource limits. Open/nonmanifold edge incidence, degenerate faces, self-intersections, unresolved coincident or tangent shell relations, and capacity failures receive no certificate; their volume queries retain the labelled XYZ policy fallback. Cell mapping can remain uncertain even for certified source geometry. Source-interior validation alone does not certify source-distance or finished-part error. Separate sourceAccuracy contracts and completed authoring-band covers govern those flags. Planning uses conservative top residual samples. Whole-part bounds include both directions and proved authoring envelopes, and accessibility is certified only after all required source contracts and contacting-pose covers complete. Whole-domain fallbacks may be too wide for the requested Tolerance; unresolved/limited covers remain explicitly uncertified. Cut patches are sampled display geometry. Tool calibration, machine offsets, rapid speed, acceleration and pause duration remain controller/setup inputs.

Keep README.md, AGENTS.md, app.md, plugins.md, schemas and tests synchronized. Runtime stays one plugin.js. Port to Printer only after separate relevance/correctness/performance verification.
