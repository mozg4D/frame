# Magneto

Native authoring only; no magnetic solver, calibrated constants, fields/Force/Torque/remanence/curves. Numerical endpoints reject before mutation/work; Solve disabled.

- Helper 100x100 mm local XY, +Z normal; native scale defines size. Mode, signed animated Current Density A/mm2 and visualization choices are intent only.
- Magneto tag has one Material choice: Electrical Steel M19/M27, Pure Iron, NdFeB N35/N42/N52. Every preset has physicsAvailable:false. No Reset without persistent state.
- surfaceStyle fallback applies only without effective Frame Material; preserve explicit/inherited appearance, never create/edit materials.
- Native transforms/animation/records/Undo/HASH and shared helper own integration. No private scene/renderer/timer/CPU mirror/numerical GPU resources; experiments stay unloaded.
- Missing physical gates: evaluated geometry/current continuity, conductor cuts/divergence-free current basis, documented material data, GPU near/far solution, persistent magnetization and chronological result integration.

Checks: node --test plugins/magneto/tests/authoring.test.mjs; node plugins/magneto/tests/authoring-browser.mjs --headless. Catalogue tests/index.mjs qualifies authoring only.
