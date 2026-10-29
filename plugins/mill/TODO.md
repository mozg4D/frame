# Mill: remaining work

This is an incomplete implementation of the full Mill specification. The current verified stage is native CNC/Stock/Protected authoring plus independent three-axis GPU solid snapshots. It does not yet produce machining trajectories, virtual milling, machining time or G-code. A successful geometry build reports geometry-ready, not machiningReady.

## Accepted human decisions

- Stock and Protected are ordinary tags anywhere in the scene; no implicit protection from CNC parenting.
- CNC uses normal native transforms and hierarchy. Skew/unsupported states are red and ignored; do not block native editing.
- CNC may attach under a part/assembly. Do not introduce special parent/child type rules.
- Use Printer's self-overlap cleanup, nested even-odd and occurrence-union semantics.
- Treat the cutter as infinitely long; no cutting-length/stick-out/holder fields. Step Down is a per-pass maximum, not a geometric cutter length.
- The green switch disables CNC computation without hiding the helper.

## Required implementation stages

1. Retain a root job's actual stock beyond individual operation boxes where needed for collision/next-operation queries. Sequential operations must consume prior virtual stock, not independently reimport the initial scene.
2. Add sparse/tiled refinement and a defensible Tolerance error budget. Current pitch-based solid import is sampled and bounded, not a certificate of machining accuracy. Add target/protected conservative envelopes for thin features and ambiguous input.
3. Implement Flat/Ball/V analytic infinite-length cutter profiles. Use the same shape for accessibility, removal, verification and display.
4. Implement continuous cutter sweeps and GPU interval subtraction. Check full swept volumes, including material outside the operation envelope, rather than only endpoints/centerlines.
5. Build local distance/accessibility fields and a deterministic automatic planner for clearing, islands/pockets, contours and nonplanar finishing. Detect inaccessible residual stock.
6. Distribute actual Step Down/Step Over evenly within the user's maxima. Surface tolerance may require smaller finishing spacing.
7. Select climb direction from current material-contact side and signed RPM, with explicit handling of full-slot/ambiguous contact.
8. Implement feasible continuation/ramp/helix/peck entries. Z must follow cumulative XY distance; enforce Feed and the vertical Plunge component, and perform constant-depth cleanup.
9. Plan short Safe Dist transitions against current stock/protected geometry, carrying the actual tool position across sibling/nested operations. Validate the upper box plane before treating it as a safe route.
10. Publish one verified motion stream for simulation, time, Progress and export. Implement bounded checkpoints/replay for backward Progress, set N only after full successful publication and automatically display Progress=N.
11. Implement a documented G-code backend and custom-block state contract, start/finish lifecycle, same-tool continuation, manual tool changes, spindle restart/direction and safe final return. Unknown custom motions/modal changes must not silently invalidate verification.
12. Calculate an honest estimated machining time, documenting unknown rapid/acceleration/manual-pause contributions. Replace --:--:-- only when an estimate exists.
13. Add compact GPU toolpath/virtual-stock rendering and bounded AI path/stock inspection, G-code retrieval/export and a minimal native export UI entry point.
14. Add independent swept-volume/collision/deviation/residual-stock and G-code replay oracles, realistic user fixtures, multi-operation tests, random Progress tests and representative completed-operation/memory/frame benchmarks.

## Existing limits to revisit

- Dense ray headers inside an occupied box: max 2048 samples per dimension / 4194304 combined rays. Very fine Tolerance fails instead of lowering accuracy.
- Max 256 occurrences per role, 1024 hits per ray and 16777216 raw events, further bounded by device binding limits.
- Reflected/degenerate/skewed machine frames are ignored. A tilted child axis is ignored within a fixed-axis three-axis job; supporting re-fixturing/indexed setups requires an explicit physical interpretation.
- Current operation snapshots clip to each physical box and have no subtractive history. Never use them as proof of collision-free inter-operation travel.
- General malformed/open geometry and sub-sample topology are not certified. Preserve Printer's policy/diagnostics and do not substitute a majority-vote preview for safety verification.

Keep README.md, AGENTS.md, app.md, plugins.md, schemas and tests synchronized as these stages are implemented. Mill must remain one independent runtime JS file. Port an improvement back to Printer only when its relevance and correctness/performance are actually demonstrated by separate Printer tests.
