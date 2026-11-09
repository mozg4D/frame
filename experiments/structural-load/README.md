# Resolved material and load preparation for Structural PCG

Local experimental continuation, 2026-11-09. Not installed by the plugin catalogue. This layer connects explicitly resolved per-body material/Force/Fixture cells to the existing GPU PCG constructor. Numerical GPU evidence must bind this adapter and its final dependencies; prior PCG tests alone do not qualify it. No full scene Solve is exposed.

## Input contract

`prepareResolvedCase(input)` accepts one independent finite `frame`, an `owner:{source,uid}`, bounded `cells` and `spacingMetres`, and `bodies`, `forces`, `fixtures`. Cell order is X-fastest. Grid origin is zero in explicit local SI axes. Maximum 4096 cells, 32 bodies, 64 forces and 64 fixtures, inherited from the preserved mapping reference. It allocates CPU metadata/nodal arrays only.

Each body has `{source,uid,occupancy,material}`. Occupancy is exactly zero/one and already clipped to the Structural domain, with nearest Material/group unions and intersections resolved by the caller. Overlapping body ownership or uncertain/boundary labels reject. Materials supply positive finite Young modulus (Pa), density (kg/m3), yield strength (Pa), and -1 < Poisson ratio < 0.5. Distinct bodies have independent Hex8 grids and no mechanical weld/contact even if their grid nodes coincide.

Each Force has `{source,uid,occupancy,wrench:{force,torque,pivot}}` in N, Nm, and metres, all expressed in the same grid frame. One source+UID is one physical load; duplicate records reject. Several UIDs on one source add. Equal bare UIDs on different sources stay distinct. The preserved region-wrench mapper assembles each Force once over the selected material union, then partitions nodal forces across bodies by participating-cell weights. Empty material intersections are unapplied. It never multiplies a parent Force by the number of descendants.

Each Fixture has `{source,uid,occupancy,displacementMetres?}`. Zero translation is the default. Its resolved full-cell initial overlap welds the affected body's eight cell nodes; all three translation DOFs are prescribed. Conflicting translations reject. This is an explicit fully selected cell policy, not partial-cell geometry interpretation, rigid rotation, animated weld transport or sliding contact. Existing PCG admission verifies each body's constrained rigid modes and rejects unsupported point/edge-only joins.

The result contains separate `{grid,loads,constraints,material,source,uid}` problems, Force provenance records, owner key and frame. It always reports `sceneSolved:false`, `analysisReady:false`, `contact:'unresolved'`. It copies prepared numerical arrays; later changes to caller arrays do not change a prepared case. Density is retained metadata, not an implicit gravity load.

## PCG handoff

`createResolvedBodyPCG(device,input,bodyRef,options)` prepares/validates the full input before touching the supplied shared device, selects one body by `{source,uid}`, and calls the existing `createGPUPCG` with its mapped loads/constraints. Returns `{solver,source,uid,frame,owner,sceneSolved:false,analysisReady:false}`. Only `isCurrent`, `signal`, `tolerance`, `maxIterations` and `checkpointEvery` are allowed in options; callers cannot override mapped loads/constraints. An explicit currentness callback is required. The callback must eventually observe actual native authoring/resource state; merely supplying it does not certify a scene capture.

The returned solver retains the existing single-use run, exact-residual acceptance, bounded inspection, cancellation and disposal contract. Preparing several frames creates independent load cases; no deformation is carried across frames. Multi-body scheduling and aggregate result publication remain unimplemented. This adapter enables one selected body's numerical job; it does not install a native solver API.

## Reuse and qualification

`load-case-reference.js` preserves the existing `wrenchInGrid` and `regionWrench` functions from the saved structural-afe7d3de research. Unused case/solver wrappers were omitted. `load-mapping-reference.js` preserves its resolved-body partitioner with imports redirected to those functions and the retained Hex8 reference. No new wrench-distribution algorithm is introduced. See SOURCE-PROVENANCE.json for extraction provenance. Execution reports belong to the source-bound integration evidence, outside the runtime.

Run in the prepared Frame checkout with the first Structural PCG continuation present:

    node --test experiments/structural-load/tests/resolved-case.mjs

    node experiments/structural-load/tests/hardware.mjs

The dedicated headless hardware harness borrows the native Frame device and exercises `createResolvedBodyPCG` itself. It checks three volume-loaded axial-bar resolutions against the analytic displacement and independent reactions, prescribed translation, two independent body/material selections against Float64 equations, completed-operation budgets, unchanged authoring and GPU errors. Explicit resolved-cell inputs remain distinct from native scene/geometry capture.

Tests check total force/torque at three resolutions, independent piecewise axial-bar displacement and reaction at two resolutions, additive parent/group loads across two materials, prescribed translation, unsupported/ambiguous inputs, owner/frame isolation, rotated basis conversion, before-device validation, and the actual PCG constructor's uploaded nodal data using a command emulator. Constructor emulation checks wiring only; it does not execute GPU arithmetic. The measured 128-cell CPU preparation budget is not scene/GPU performance qualification.

## Remaining scene work

Native parameter tags (including repeated Force), captured inherited provenance, robust clipped geometry occupancy and source-frame conversion must be qualified before this receives real scene input. Fixture rotation/sliding, GPU occupancy/load assembly, stress visualization, animation result ownership and topology remain separate work. Existing PCG hardware results do not transfer to this adapter. Heavy GPU/shared tests are paused for the coordinator's integration gate.
