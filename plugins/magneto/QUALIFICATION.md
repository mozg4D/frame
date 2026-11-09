# Focused native authoring qualification

The pre-integration isolated candidate passed the focused hidden Chromium hardware gate at DPR 1 and DPR 2: 71 checks each. AdapterInfo reports vendor nvidia, architecture ampere, isFallbackAdapter false; device/description strings are empty, so no exact GPU model is claimed. The shared device had no validation error, uncaptured error, loss or replacement. JavaScript and console checks were clean. Sources before and after each run match, and both runs used identical checked sources.

Core SHA-256: 249e38310644ac9deaa2ca753d121674adcbdd3319bd2e64a0dbca229b7334c5
Plugin runtime SHA-256: 908c82a3cb527fc268932f39ed245079d2d35487d50d54c6d96e17728cc7e9ff
Focused runner SHA-256: ca82c8c235b8e923bc605d74efe9c847a10ca205b0b4567e1d6542b08f31aaf5
Generic tag browser SHA-256: ea0e2867635135e85ac111e8d2fb4b13064d9161603bba7bdcb71d78edc4e852

Reports: tests/results/magneto-authoring-preview-dpr1.json and magneto-authoring-preview-dpr2.json. All source hashes and completed-operation timings are in these reports.

DPR 1 maximum measured native-helper frame CPU/GPU times: 0.90 / 3.18 ms. DPR 2: 1.00 / 6.30 ms. First creation: 96.85 / 98.99 ms; repeated mode/view batch: 611.23 / 611.05 ms; HASH reopen: 98.97 / 98.62 ms; helper selection: 25.68 / 24.89 ms. All declared focused budgets passed.

Original failed runs are preserved as -dpr1-fail01.json, -dpr1-fail02-diagnostic.json and -dpr1-fail03-helper.json in tests/results. The first comparison used raw Material tag serialization: HASH legitimately added materialUID and changed key order. The corrected assertion compares tag UID/kind/mask/params and resolves the native material identity from scene.inspect.materials, also checking persisted UID/index agreement. The helper fixture originally clicked the coincident edges of two planes; its corrected target is the enlarged owner's separate right edge. These were test-oracle corrections, not runtime changes. Both final DPR runs cover the corrected exact test sources.

Coverage includes lazy creation, visible unfinished state, Mode/view buttons, negative density and zero-crossing native animation, numerical rejection/atomicity, Material native UI/Undo/discrete animation, multi-owner tag validation, preserved explicit/inherited material authoring, HASH/hierarchy/frames, delete/Undo, native gizmo/deselection and helper stroke picking, plus shared-device frame/error checks. It does not certify pixel-accurate appearance, arbitrary scene scale or the 100M fixture.

43 generic core CPU checks, 8 plugin CPU tests and syntax checks also passed. Release integration subsequently reran focused and aggregate gates on its new application/worker stamp, as recorded below. No magnetic solver, calibrated material, closed-conductor current solution, field, force/torque, persistent magnetic state or physical animation result is implemented or qualified. The original isolated task did not commit, push or publish.

## Release integration

Release stamp: 2026 09 nov 03:01 (Europe/Moscow). Final core SHA-256: 207009dfc3d8b34b0966c1a9345ddaceba5502a5782c588506afa4fcfa4ef0d9. Native authoring runtime is unchanged from the candidate; only the application release stamp changed in core. Fresh focused, aggregate and heavy-scene checks passed for these bytes; reports are retained under tests/results. This remains unfinished authoring only, with no numerical backend.

## Final release gates

On core 207009dfc3d8b34b0966c1a9345ddaceba5502a5782c588506afa4fcfa4ef0d9, hidden hardware Chromium passed full standard (7,638 aggregate assertions), full DPR 2 stress (7,638), and full DPR 1 test:all (7,646 aggregate assertions plus 43 persisted heavy-performance checks). Fresh standalone Magneto DPR 1 and DPR 2 each passed 71 checks with matching before/after source hashes and NVIDIA/Ampere nonfallback hardware. Shared and fixture WebGPU validation/uncaptured checks and JavaScript/console checks were clean.

The all-fixtures run covered 287,250-triangle regular spline geometry, the current local original-scale STL (1,571,067 cleaned triangles), and the 100,548,288-triangle scene. All 64 heavy owners were framed; three real native gizmo drags completed in 134, 110 and 115 ms, preserving the existing 10-second publication budget and verifying Undo matrix restoration within 1e-9. Private fixtures are not included in the release.

Initial DPR 2 stress stopped at the existing context-menu outline assertion. Three unchanged isolated repetitions passed 72 checks each, and the complete unchanged stress retry passed. The original failure remains preserved. Initial test:all exposed a preexisting fixture setup defect: it focused a corner owner, then attempted to drag another owner with its handle outside the viewport. A framing-only diagnostic established causality. The test-only correction frames all owners, validates a native in-canvas hit, retains three 18-pixel drags and matrix/new-frame conditions, releases the pointer in finally and asserts Undo restoration. Independent source/evidence review accepted the correction; the complete test:all run was repeated successfully. No runtime was changed for either investigation.

Reports: magneto-standard.json, magneto-stress-dpr2.json, magneto-all-dpr1.json and magneto-authoring-preview-dpr1.json / magneto-authoring-preview-dpr2.json under tests/results. Failed attempts and focused heavy diagnostics are retained separately. These are editor/authoring and rendering qualifications, not magnetic-physics validation.
