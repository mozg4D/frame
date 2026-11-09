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
## Connectivity continuation, November 9

Base: remote main `649c046723fc2d181e75d234c43ddf73f5165e75`, separate laboratory checkout. The preserved authoring-preview and net-cache-fix packages were inspected; their runtime work is already present in this base.

- CPU authoring and resource-double regressions: 31/31 pass, 46.86 ms total on Node 21.6.1. This runtime is older than the repository's declared Node >=22 requirement; supported-runtime release qualification remains pending.
- Completed-operation latency: 512-component topology snapshot 6.57 ms; 100 small topology snapshots 2.91 ms; 100 component inspections 1.39 ms. Each asserted budget is 1000 ms. The 512-component case uses two pins per component and does not qualify the maximum 64-pin payload.
- New coverage: missing/malformed target records reject creation, transfer and generic assignment before mutation; capacity enforcement; explicit Ground; disconnected nodes; detached snapshots; display-only changes; disabled state; dangling references; component-only target rejection.
- Core syntax check: two executable and five lazy scripts passed. Changed plugin runtime and browser test files passed syntax checks; whitespace checks passed. The core runtime, rendering code and assets are unchanged.
- `npm test -- --headless` was attempted and failed before browser startup: `ERR_MODULE_NOT_FOUND`, package `playwright` absent in the isolated checkout. No standard test success is claimed.
- Native browser topology/HASH assertions are added but unrun. Hardware scheduling and publication await the release coordinator. No GPU, OBS, printer or user window was controlled. No electrical, Scope, JS/WASM feedback, memory-history or release qualification is claimed.

Local machine-readable CPU evidence: `tests/results/circuit-connectivity-cpu.json`. Earlier hardware results do not qualify this increment.

## Focused hardware follow-up, November 9

The coordinator granted one exclusive focused GPU slot. A fresh elevated read-only process preflight found no active competing Frame/Playwright test; RTX 3060 was 0% / 895 MiB. No dependencies were installed. The ignored checkout-local node_modules junction reuses C:/frame/node_modules.

- Node 24.22.1, Playwright 1.64.1, installed Chromium 156 (chromium-1248). The CPU suite reran under supported Node: 31/31 pass, 35.70 ms total; 512 two-pin components 4.70 ms.
- One focused native gate `node plugins/circuit/tests/index.mjs --headless`: 43/43 pass on identifiable NVIDIA Ampere hardware, fallback false, timestamp queries available. Native topology/Ground/disconnected identity and HASH round-trip assertions passed alongside the existing authoring, merge Undo, copy/clipboard/Merge, lazy loading, icon and renderer checks.
- Topology snapshot: 7.79 ms; HASH export: 14.45 ms; reopen: 37.74 ms. Twelve fresh frames: maximum CPU 2.00 ms and GPU 1.402 ms, within the 16.7 ms small-scene budget. No WebGPU validation/uncaptured errors or page errors.
- Exact tested core SHA-256: a3201279facd58d9861d5d8128f17b0cde10fbb50184f5bebc5aa03346bf75ee. Full runtime/test source hashes are in the focused JSON and were rechecked against checkout bytes.
- Browser contexts/server closed through the existing runner lifecycle. Post-run process inspection found no remaining Frame test Node or Playwright browser root. RTX 3060 returned to 916 MiB / 2% desktop utilization; the GPU slot is released. User windows, OBS and printing were untouched.

Evidence is preserved in the task's circuit-connectivity-delta/HARDWARE-RESULTS.json and CPU-RESULTS-NODE24.json, plus ignored tests/results/circuit-authoring-preview.json. This supersedes the dependency/supported-Node/focused-hardware blockers in the earlier continuation entry. Standard/stress integration and publication remain coordinator work. No electrical solver, controller feedback, Scope or simulation-history qualification is claimed.
