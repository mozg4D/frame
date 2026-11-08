# Scene Control core data milestone qualification

## Qualified runtime

Release: Frame 2026 08 nov 10:05 UTC.
Index SHA-256: 38c05f49552245080c8aef6a2274824db1facb85ecbbed036b565df7e2f717a6.
Service-worker SHA-256: e785e431a4ac4a3500611bbdb2988e994058f82664c914a45c15016474e52918.
Base main: d98aca74b4be7e4703a26bf51caa874821dcc73b.

This milestone adds inert source/schema/binding records, native name/visible authoring CAS, read-only scalar current-parameter observations, typed references, native history/HASH persistence and bounded document-lifetime ID reservations. It does not implement source execution, a Control panel, custom Attributes, managed Workers, autostart or subscriptions. No plugin or Unite implementation changed.

## Executed final-byte checks

All following native results use the exact index and service-worker hashes above, on NVIDIA RTX 3060 / NVIDIA Ampere, without software fallback, using existing Node 24.22.1, Playwright 1.64.1 and Chromium 156.0.8078.4.

- CPU: 403 checks passed, including 248 existing HASH/Doc/plugin-reference/current-empty-editor checks and 16 exact source-binding assertions. CPU suites passed in cloud and on LAB. Syntax passed two core blocks and five lazy scripts.
- Source audit: 112 bound sources and 14 reviewed transitive test modules passed. Runner/audit bytes and runtime assets are bound.
- Focused native Scene Control: 891 assertions in 14 cases passed in 7731.13 ms. This includes real native Save/Open, Duplicate, Copy/Paste/Merge, cross-tab clipboard, Undo/Redo owner disappearance, stale epochs, actual dirty Doc popup barriers, committed post-settlement error receipts, malformed pre-disposal HASH preservation, injected failed installation and explicit New/Open recovery.
- Native Doc button/editor: 19 checks passed, including visible empty Doc, editing the first text, clearing, deletion, repeated clicks and New.
- Explicit non-Unite release profile: 249 assertions passed. The same bounded profile with 32 shared-suite frame samples passed another 249 assertions. Shared suite, real UI/viewport status, next interaction, live viewport, 2304-cell load/drag, SIMD, MCP and fresh startup all passed.
- Bounded installed-PWA check: 15 checks passed. The final shell installed, reloaded offline on hardware WebGPU, opened an editable empty Doc, preserved inert author data and documentation through a native HASH roundtrip, and never executed stored source. Offline reload was 903.11 ms, HASH export 6.86 ms and reopen 61.18 ms.

No unexpected page/console errors, GPU validation/uncaptured errors, device loss or replacement occurred. The explicitly injected installation fault was expected and recovery was verified. All 554 candidate source files matched their pre-run hashes after the native checks. All owned browser/server resources closed; no owned or recorded test process remained. Qualification prose and this source inventory were finalized afterward without changing any runtime, service-worker, test or audited dependency bytes.

Raw report SHA-256 values:
- Scene native: d3f77f04b5f3ff559fba73bda15f2bffd5fa25895fcbb72ecb111e066a094729.
- Doc native: 6e146aa3df15be3956ed77688c3724633530b4682fb60705b4da6a0bf9c828e1.
- Non-Unite: f2728b901c03779df156393e1fda4f9aaa6f581fafb9587cabccc28b97f6114d.
- Non-Unite 32-sample replay: af3e5dae0a95d796ca558bcb3a64b2976bb23bcd4e29ff3b4fdcf97cf8701f80.
- Bounded PWA: d982a5e6fe67b2784ff6779e86a39704465186fd614392e3168bbf4e03c39370.

## Provenance and previous failure

The five exact layers reverse release stamp, startup seam, reservation ledger, scalar parameters and original author data to the complete original main index SHA-256 bfa3b3bf0d34c8fbaa4fbe229ac4fc7ba135be7b38bf7bffe5235cacdd4bacce. Intermediate hashes and replacement counts are mandatory. The service-worker change reverses exactly to its original hash; the four Doc runtime files remain byte-identical. The source-only release delta checked all 550 R2 inputs and all 554 outputs before testing. SCENE-CONTROL-DATA-SOURCES.json excludes only its own self-hash.

The first native candidate 0c083557 failed at startup before browser assertions because native records were not yet installed. The actual startup seam reproduced the defect before its minimal fix. The corrected R2 candidate 619e12e7 passed the focused native gate; the final release-stamped bytes were then independently rerun as recorded above. Neither the failed run nor historical R2 results are relabeled as final-byte evidence.

## Explicit exclusions and reproducibility

Run node tests/release-non-unite-audit.mjs before node tests/release-non-unite.mjs --headless. Add --stress only for the same bounded profile with more shared-suite frame samples. Source changes fail closed. On LAB, any external Playwright loader must be inherited through NODE_OPTIONS by the spawned MCP child. FRAME_BROWSER selects the existing verified browser; no software-GPU fallback is accepted.

handWorkflow is excluded because it executes geometry.unite. Direct unite, uniteIntegration and uniteConditioning stages are excluded. Every other omitted standard stage is named in tests/release-non-unite-profile.json and each report. Plugin test discovery, optional large fixtures, full standard/stress and full installed-PWA update/plugin behavior are not qualified. Existing npm test and npm run test:stress execute Unite and were not used. No assertion or latency threshold was weakened.

Current parameters have phase current and revision null; observedFrame is context, not a completed-simulation guarantee. Units and ranges are not inferred. The 128-code-unit stable field ID permits 122 code units after param:. Source remains inert. Performance tests retain complete-operation budgets, including 100,000-owner CPU observations and native operations.
