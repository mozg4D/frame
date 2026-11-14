# Thermal

Native authoring only; no temperature/airflow/heat-transfer solver. The single runtime plugin.js includes resource-free native Fan/frame inspection.

- Shared 100 mm helper; Probe 2 mm at owner origin. New Fan 30x30x10 mm at owner-local [-25,-12.5,-12.5], pointing +X. These are creation defaults; native affine frames own subsequent placement.
- Create once in a native transaction then await editor selection. Explicit Thermal references are native hashes independent of parenting, never inferred/session IDs. Fan/Probe hide internal refs; Fan hides Direction and displays Pressure for stored Shutoff pressure. Preserve authored Reverse values.
- Ambient/Initial/pressure/flow/direction are intent only. Material/Heater tags are not registered. Unavailable declared metadata/records stay opaque; copy preserves unresolved markers. Undeclared omitted extensions retain import diagnostics, not a lossless claim.
- create-fan/create-probe/fan-inputs expose authoring; fan-inputs reports solverEligible/solverCoupled false. Numerical endpoints reject THERMAL_AUTHORING_ONLY before mutation/device access. Keep disabled Under construction; no Solve/Measure/cache/numerical allocation.
- No private panel/renderer/worker/device; shared helper bridge owns resources. Experiments stay unloaded research.

Checks: node --test plugins/thermal/tests/fan-ui.mjs plugins/thermal/tests/native-selection.mjs plugins/thermal/tests/native-history-contract.mjs plugins/thermal/tests/opaque-authoring.mjs plugins/thermal/tests/browser-gate-contract.mjs; node plugins/thermal/tests/authoring-browser.mjs --headless. tests/index.mjs integrates native gate; CPU adapters do not qualify native HASH/UI/GPU.

Continuation pointers: experiments/thermal/native-inputs.js, material-properties.js, material-storage.js and material-flux.js hold unloaded bounded contracts. fan-inputs validation of frame/reference never proves containment, grid alignment, inherited enabled eligibility or numerical coupling. Retain declared unresolved refs through native drop/copy/HASH; generic authoring changes and physical source snapshots are distinct. No prototype material/flow result can bypass THERMAL_AUTHORING_ONLY without a separately qualified current-core geometry/physics/lifecycle path.
