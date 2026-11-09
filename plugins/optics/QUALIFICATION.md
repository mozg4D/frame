# Optics foundation qualification

Date: 9 November 2026. Isolated LAB Windows copy based on published Frame commit 649c046723fc2d181e75d234c43ddf73f5165e75. No user scene, visible window, OBS or printing was touched.

## Passed

- node --test plugins/optics/tests/authoring.test.mjs experiments/optics/reference.test.mjs: 16 tests, 16 passed, zero skipped. 20,000 seeded interface evaluations plus invariant checks took 128.61 ms against a 5 s budget; total run 216.08 ms.
- node plugins/optics/tests/index.mjs --headless: 47 native browser checks, 47 passed. Real NVIDIA Ampere, isFallbackAdapter=false, same shared Frame GPUDevice, no WebGPU validation, page or console errors.
- Native UI creation, role parameters, explicit cross-task rejection, Infinity UI, transforms/Undo, Blocker/Optical tags, HASH reopen, duplicate/clipboard/merge reference remapping, orphan diagnostics and unavailable-operation rejection were covered.
- Initial owner creation 95.41 ms; Subject button 65.37 ms; other plane creations 15.93-25.09 ms; links 10.47 ms; HASH export/open 29.89/80.74 ms. All completed-operation budgets passed.
- Twelve small-scene frames: maximum CPU 1.30 ms, GPU 1.236 ms, under 16.7 ms each. This is a bounded authoring scene, not a heavy-scene benchmark.

Focused native evidence: tests/results/optics-authoring-preview.json (Git-ignored), including per-source SHA-256. Tested index.html SHA-256: a3201279facd58d9861d5d8128f17b0cde10fbb50184f5bebc5aa03346bf75ee.

## Not qualified

Full npm test, stress and 100M-scene gates were intentionally left to the separate ongoing Optics integration chat to avoid duplicate/concurrent hardware work. No release/version bump, publication or Pages verification was performed here. Do not publish without the required aggregate checks on the final integrated bytes.

Direct viewport edge picking is unfinished and explicitly reported unavailable. Object Browser selection, native transform gizmos and shared bounds are supported. The gate verifies shader validity/render timing, not an independent pixel oracle or visual acceptance. No scene optical solver, image/power result, optimizer, material/coating catalog, texture target, production geometry or manufacturing qualification exists. CPU primitives cannot qualify these absent features.

## Unloaded power-ledger continuation

Separate delta based on the completed foundation commit d586efe8d609641fda746eb84d7042c5b48e3e3a. It adds only an unloaded aggregate-accounting module, its tests and documentation. No manifest asset, runtime import, native operation, shared core file or GPU code changes.

Node v24.22.1: `node --test --test-reporter=tap plugins/optics/tests/authoring.test.mjs experiments/optics/reference.test.mjs plugins/optics/tests/power-ledger.mjs` passed 30/30 tests, zero skipped, total 254.7288 ms. Fourteen new accounting cases cover source identity/completeness, per-source/global conservation, unresolved/zero power, explicit tolerances, invalid inputs, overflow, bounded arrays and immutability. The completed maximum 16,384-source accounting call took 116.6617 ms against a 1000 ms CPU budget; no GPU was used. This is bounded bookkeeping throughput, not ray-tracing performance.

The existing 47-check hardware report belongs to the authoring foundation and is not a new run of this delta. Full npm test, stress, browser/hardware qualification, publication and Pages verification remain with the coordinator's common batch. The default system Node v21.6.1 is below package engines; the continuation used the separately installed v24.22.1 executable explicitly.

Before future solver integration, the common capture policy must be resolved: current pluginSnapshot excludes hidden occurrences while the Optics concept requires hidden optical geometry to keep participating. No visibility toggle, CPU geometry mirror or plugin-specific core workaround is introduced here. Aggregate closure cannot certify correct transport or receiver coverage.
