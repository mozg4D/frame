# Mill

Follow ../../AGENTS.md and ../../plugins.md. Runtime stays one plugin.js, borrowing the shared GPUDevice, evaluated buffer/texture geometry and native document/editor paths. No Printer runtime dependency, CPU triangle mirror, alternate scene or renderer. Read README.md and TODO.md before extending behavior.

Accepted human decisions override the original spec: Stock/Protected are global inherited native tags, independent of CNC parenting. CNC can inherit any native hierarchy. Unsupported skew/reflection/degeneracy/incompatible tool axes are red/ignored without blocking editing. Green skips computation without hiding helpers/descendants. Cutters are infinitely long; no holder/flute/stick-out fields. Step Down is a pass maximum. Preserve Printer's independently embedded cleanup, nested parity and occurrence union.

Default Slice builds full CAM in native preorder through ordinary nodes. Operations consume preceding actual cuts/position. Canonical material is original borrowed GPU source plus continuous analytic sweeps; XYZ subtraction/replay stay GPU-owned. Planning may read bounded conservative triangle-clipped fields and update only those derived fields from generated motions. Never replace canonical sources with CPU triangles. Display LOD, field resolution, numerical envelopes and requested Tolerance are distinct. Do not claim sampled cell diagonal certifies source/finished-surface error or silently weaken machining precision.

Flat/Ball/V share analytic shapes across accessibility/collision/subtraction/display. Quantize endpoints before full-sweep checks. Include out-of-box material, Safe Dist over entire rapids, actual Feed/vertical Plunge, signed contact, cumulative ramp XY, tool changes and final home. Custom state beyond the documented finite contract fails; accepted motions enter the common verifier/stream. Reachable residual failures block publication; uncertain/accessibility-limited samples stay explicit.

Publish N/Progress=N only after successful complete planning/replay/export validation. Failed/cancelled/stale jobs expose no partial result. Backward/random Progress uses immutable source/checkpoints; later operations never reset material. Retire derived resources on staleness/deletion/cancellation/scene/device changes; never destroy borrowed resources. HASH persists authoring, not GPU jobs.

Preserve assigned/inherited materials, polygon masks and UVs through native fragment filtering. Fallback styles/cut patches are derived presentation, not saved tags or another scene. No standing diagnostics panel. Time is a feed/dwell lower bound with unknown rapid/acceleration/manual-pause contributions.

Run node plugins/mill/tests/run.mjs --headless. Standard/stress discover all modules through tests/index.mjs. Extend independent numerical/program/stock oracles and completed-operation/frame/memory budgets with changes. Global validation/publication follow root instructions.
