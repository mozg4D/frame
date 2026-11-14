# RF

Native problem authoring only; no Maxwell/FDTD solution, field/impedance/S-parameters/received power/optimized geometry.

- RF/Section are 100 mm XY planes, +Z normal. Terminal is a 2 mm cube, future impressed-current direction +X. Terminal/Section belongs to nearest RF ancestor; no hidden pairing/ground/connections.
- Use viewport.helpers/surfaceWarnings:false and native frames/params/tags/Undo/HASH; no private scene/device/job cache/CPU mirror. Material presets are intentions, not calibrated constants or visual-material replacements.
- status reports detached authoring/capability data. add-terminal/add-section commit once and await editor selection. settings validates merged Terminal values first. Numerical endpoints reject RF_AUTHORING_ONLY before capture/allocation. Diagnostics stay in API/red rows, not Attributes prose.
- Before physics define normalized excitation g, voltage/current/sign conventions, charge continuity/energy exchange, SI units/material dispersion/convergence. Multiple sections, Target polarization, material presets and possible later voxel-to-mesh optimization remain requirements, not numerical results.

Checks: node --test plugins/rf/tests/authoring.mjs plugins/rf/tests/native-helpers.mjs; node plugins/rf/tests/run.mjs --headless. tests/index.mjs discovers native authoring, not RF qualification.

## Native metadata and physical milestones

- TX and RX are independent flags: both/neither valid. Bands parses 1..32 comma-separated GHz frequencies/ranges. Power W and Phase degrees are authored source intent; RX matching/positive resistance/signed reactance are not computed loads or recommended impedance. settings/toggles validate all merged values before update.
- Reparenting through groups intentionally changes nearest-RF ownership; nested RF does not share terminals. Detached helpers remain authoring, red/missing-owner, never silently paired.
- Tags rf_metal/rf_dielectric/rf_target/rf_avoid/rf_optimize_space retain native preset/Target polarization/coverage metadata. PEC/Copper/Aluminium and FR-4/PTFE/Glass are names, no universal dispersion constants. Inherited Metal+Dielectric conflict is status.materialConflicts (bounded hash list), not a physical overlap proof; Target/Avoid are not materials. Ordinary geometry conflict coloring is unavailable with plugin-owned row hook.
- First numerical model requires bounded uniform 3D Yee GPU grid, actual GPU geometry classification, calibrated source and PML; no unverified subgridding. Prove plane-wave dispersion, interface/PML reflection and source orientation/amplitude convergence. Source/load causality and normalized generalized V/I/g must precede impedance/power/S-parameters.
- Later validate passive RX, loaded mutual coupling, broadband DFT, near/far-field direction/polarization and energy balance. Changing a Section is presentation, not physical rerun. Optimization must separate direct source radiation from induced structure and retrace final output with fresh Solve. Thin metallization/connected-feed equivalence/manufacturing remain open, native mesh conversion is separate.
