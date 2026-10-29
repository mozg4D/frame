# Mill implementation checklist

The operational fixed-axis CAM stages are implemented within README.md limits. complete means a verified program/result in this model. Finite source/residual sampling is not universal source-topology, finished-surface or physical-machine certification.

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

## Model boundaries

Indexed/re-fixtured, reflected/skewed/degenerate setups require another physical model. Empty/ambiguous Stock remains diagnostic-only. General malformed/open interiors and sub-sample topology are uncertified. Residual inspection samples the conservative top model, separating reachable failures from accessibility-limited candidates; it does not prove every inaccessible volume. Cut patches are sampled display geometry. Tool calibration, machine offsets, rapid speed, acceleration and pause duration remain controller/setup inputs.

Keep README.md, AGENTS.md, app.md, plugins.md, schemas and tests synchronized. Runtime stays one plugin.js. Port to Printer only after separate relevance/correctness/performance verification.
