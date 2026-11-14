# Atomic

Runtime plugin.js embeds NEP89-1 weights, NEP4/ZBL kernels, charge diagnostic and license; provenance.json pins model source. Preserve energy/descriptor kernels, use shared device.

- One Atomic owns one world. Units: angstrom/fs/eV/amu; Temperature Celsius, Damping inverse ps, Time scale fs/s. Object affine motion never changes internal atom coordinates.
- Selection pauses physics; edits preserve velocities. Fixed atoms interact but skip integration. Velocity initializes local XYZ angstrom/fs once; Force continuously applies local XYZ eV/angstrom. Confinement is nonnegative constant-magnitude eV/angstrom toward local pivot, zero at pivot; do not alter NEP kernels.
- Store/Restore saves positions only, requires same stable IDs; restore clears velocity/clock/derived state, preserves playback. Zero time does not initialize NEP. Persistent typed arrays have separate HASH records; exclude runtime force/velocity/neighbors/charge/draw state.
- Common 60 fps timeline waits for Time scale/60 fs and GPU output. Fixed PSR animation precedes physics; Loop continues physical state. Red visibility does not stop physics; green applies only to Atomic/Fixed/Force/Velocity.
- Species native material rows use dynamic membership; selection materials override species. Charge color caps at 32768 atoms and is not electrostatic force. Appearance does not change species/physics; opacity/textures/roughness pipelines are omitted.
- Reuse native periodic table/gizmo/hierarchy/history. No per-atom Browser rows or private playback/UI. Detached atoms become native 20-triangle sphere instances; large groups use common child limits/material subgroups.
- Publish display buffers and GPU-reduced bounds from the same completed snapshot; retain previous complete display during updates. Paused preview lazily allocates working atom storage only on first GPU edit; owner motion/navigation needs no atom copy/reduction. Bounds match draw/pick, including disabled visible worlds.
- plugins.describe owns schemas; inspect <=4096 atoms. Temperature >=-273.15, Damping/Time scale/Confinement >=0; manifest declarations govern all writes. Diagnostics stay in automation.

Checks: npm run test:atomic; npm run test:atomic:comparison; npm run test:atomic:performance. tests/index.mjs owns catalogue checks; nep-reference.json retains independent force/energy expectations/provenance. Mega-scene generator stays reproducible; million-atom display/edit/history measurements do not establish physics throughput.
