# Circuit preview qualification

Base: verified remote main 82b0cc7bc4eadd832f1af535fd21c461c439967c.

- CPU authoring adapter: 17 focused checks passed. 100 completed component inspections: 1.08 ms against a 1000 ms budget. This is not native UI, HASH codec or hardware qualification.
- Source syntax: data.js, plugin.js and viewport.js passed Node syntax checks.
- Native browser authoring/HASH/copy/render gate: 40/40 passed on the requested WINDOWS-TNSI9R0 LAB, identifiable NVIDIA Ampere hardware adapter (RTX 3060), timestamp queries available, no WebGPU validation/page errors. Real component creation UI, native transforms/Undo, network merge/Ground Undo, stable HASH pin/net identities and native Duplicate/clipboard/Merge reference remapping were exercised.
- Completed-operation times: owner 49.2 ms; real Resistor action 51.5 ms; transform 3.3 ms; network merge 3.4 ms; HASH export 17.0 ms; reopen 33.8 ms. Twelve fresh frames measured maximum CPU 1.7 ms and GPU 1.45 ms, both within the asserted 16.7 ms small-authoring-scene budget. This is not a 512-component or heavy-scene benchmark.
- Exact source hashes and full results: tests/results/circuit-authoring-preview.json (ignored local evidence). The native core index tested is SHA-256 2dfbc2a48b192d62d1aa12fa22dc6c95af8e6cc34769e052badf5659ff676c9f, unchanged from the verified base. Browser and isolated test contexts were closed; no owned test process remained, with RTX 3060 at 943 MiB / 0% after cleanup.
- npm test, npm run test:stress and 100M-scene/render qualification: not run. Do not claim release readiness before the coordinator completes applicable gates.
- All electrical regression scenarios, closed-loop JS/WASM synchronization, Scope and bounded simulation-history tests: unimplemented and not run, never Passed.

No solver or third-party model artifacts are distributed. Numerical output is unavailable. The preview remains under construction even after its authoring gates pass.

## Reviewed network-cache correction

The subsequent correction adds the Circuit-owner inverse frame and each component's effective inherited visibility to network-cache identity. The actual shipped renderer/cache code passes seven new CPU resource-double checks, including independent owner motion, hidden ancestor removal, restored visibility, no-op reuse and buffer retirement. The combined authoring CPU suite passes 24 checks in about 15 ms. Red-test controls reproduce the owner-frame failure with the original stamp and the hidden-ancestor failure when only the inverse dependency is corrected. No GPU or publication was requested for this correction. The earlier 40-check native report above qualifies the previous viewport bytes only; fresh integrated hardware/release qualification remains required for the corrected viewport source.
