# RF

Native problem authoring only; no Maxwell/FDTD solution, field/impedance/S-parameters/received power/optimized geometry.

- RF/Section are 100 mm XY planes, +Z normal. Terminal is a 2 mm cube, future impressed-current direction +X. Terminal/Section belongs to nearest RF ancestor; no hidden pairing/ground/connections.
- Use viewport.helpers/surfaceWarnings:false and native frames/params/tags/Undo/HASH; no private scene/device/job cache/CPU mirror. Material presets are intentions, not calibrated constants or visual-material replacements.
- status reports detached authoring/capability data. add-terminal/add-section commit once and await editor selection. settings validates merged Terminal values first. Numerical endpoints reject RF_AUTHORING_ONLY before capture/allocation. Diagnostics stay in API/red rows, not Attributes prose.
- Before physics define normalized excitation g, voltage/current/sign conventions, charge continuity/energy exchange, SI units/material dispersion/convergence. Multiple sections, Target polarization, material presets and possible later voxel-to-mesh optimization remain requirements, not numerical results.

Checks: node --test plugins/rf/tests/authoring.mjs plugins/rf/tests/native-helpers.mjs; node plugins/rf/tests/run.mjs --headless. tests/index.mjs discovers native authoring, not RF qualification.
