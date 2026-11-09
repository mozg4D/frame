# RF authoring foundation

RF is unfinished. This version authors a problem; it does not solve Maxwell equations, calculate fields, impedance, S-parameters, received power or optimized geometry.

## Native authoring

- The RF object is a 100 mm XY rectangle with local +Z normal. Add Section creates another native rectangle for the same hierarchy-owned problem. Ordinary native position/rotation/scale changes their planes. No field is rendered yet.
- Add Terminal creates an independent 2 mm cube below RF. It has no partner, ground or hidden wire. Local +X is reserved for the future impressed-current direction, not a promised radiation direction.
- TX/RX are independent native buttons, including TX+RX and neither. Bands accepts one to 32 comma-separated GHz frequencies/ranges. Power is intended available source power in W; Phase is in degrees. RX Matching and positive fixed resistance/signed reactance are authored, not computed or applied as loads. No recommended impedance appears.
- A Terminal/Section belongs exclusively to its nearest RF ancestor, through ordinary groups. Reparenting intentionally changes membership. Detached helpers are retained, marked red and report their missing owner. Nested RF objects do not share terminals.
- RF tags use namespaced kinds: rf_metal, rf_dielectric, rf_target, rf_avoid, rf_optimize_space. Native tag fields, history and HASH preserve presets and Target polarization/coverage. Metal offers PEC/Copper/Aluminium; Dielectric offers FR-4/PTFE/Glass. These names carry no certified frequency-dependent constants in this release. Untagged geometry remains unclassified; visual Frame materials are untouched.
- Metal and Dielectric inherited together are reported in RF status.materialConflicts (total and up to 128 native hashes). This detects marker conflicts only, not intersecting materials or a physical domain. Conflict coloring of ordinary geometry remains unfinished because the current native row-color hook applies only to plugin-owned nodes. Target/Avoid do not become materials.

User annotations in the original RF specification take priority: several sections per problem, material presets, polarization on Target, quiet failure presentation and possible voxel optimization output with later Convert to Mesh. No solver choice, source normalization or material dispersion is silently fixed by this preview.

## API

Discover `plugins.describe {plugin:'rf'}`. Invoke `plugins.command {id,operation,args}`. `status` returns stage, type, native owner, authored parameters, detached-helper diagnostics and explicit false numerical capabilities. RF status lists its own Terminal/Section hashes. `add-terminal` and `add-section` each create once in native history and await editor selection. `settings` validates all merged Terminal parameters before `context.update`. `toggle-tx`, `toggle-rx`, `toggle-matching` reuse that path. `solve`, `optimize`, `results` reject RF_AUTHORING_ONLY without capturing geometry, allocating numerical resources or publishing data.

All authoring lives in native parameters/tags/hierarchy. There is no field cache, job map, timer, second scene graph, CPU triangle mirror or private GPU device. The core owns the small helper buffer and object uniforms. Namespaced helper geometry uses the generic per-type `viewport.helpers` bridge. `surfaceWarnings:false` prevents helper rendering from repeatedly drawing the entire scene through a discarded warning shader for every Terminal.

## Plan and physical acceptance

1. **This foundation:** native objects, helpers, minimal controls, validated metadata, tags, strict unavailable endpoints and focused CPU/native lifecycle tests.
2. **Model contract before numerical UI:** define discretely normalized g, generalized voltage/current and sign convention; separately validate impressed-current charge continuity, energy exchange and grid convergence. Define material units (Frame millimetres versus solver SI), dispersion and source/load causality. Do not assume FR-4 is a single universal material.
3. **First genuine Solve:** bounded uniform 3D Yee WebGPU grid using the shared device, GPU geometry classification, PEC/air plus validated dielectric model, calibrated source and PML. Bound dispatch duration/memory, cancel safely, reject stale snapshots/device loss. Measure plane-wave dispersion, PEC/dielectric interfaces, PML reflection and source orientation/amplitude convergence before exposing results. No unvalidated subgridding.
4. **Physical RF analysis:** passive RX/TX+RX, V/I calibration, energy balance and loaded mutual coupling; broadband DFT, near-to-far field, direction/polarization convention and Target/Avoid masks. Only then show impedance, power, S-parameters and patterns. Section changes must not rerun physical work.
5. **Optimize:** constrained, measurable coarse-to-fine design; account for direct-source radiation separately from induced structure. Validate published voxel/mesh output with a fresh Solve. Thin metallization, manufacturing constraints and connected-feed equivalence remain open. Conversion to mesh is a separate native operation.

No RF implementation or FDTD solver is present in the inspected current-main tree (baseline 649c046). Existing Thermal/Structural/Circuit/CFD/Magneto authoring and independent numerical references are architecture examples, not RF validation. The older laboratory C:/frame tree is not the release baseline and was left untouched.

## Verification

CPU: `node --test plugins/rf/tests/authoring.mjs plugins/rf/tests/native-helpers.mjs`.
Native browser: `node plugins/rf/tests/run.mjs --headless` in a coordinated hardware slot.
Repository: `npm test -- --headless` and `npm run test:stress -- --headless`.

CPU adapters exercise the shipped plugin and helper contract, including invalid-input atomicity and forbidden numerical access. They do not certify real UI, binary HASH or GPU rendering. Native tests cover independent ownership, UI controls, tags, HASH and unavailability; they are discovered through tests/index.mjs. Full physics, GPU field timings and RAM/VRAM peaks remain unavailable until a real solver exists. Publication requires current-source native and release qualification; passing a CPU adapter is insufficient.
