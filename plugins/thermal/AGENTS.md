# Thermal authoring preview

Follow ../../AGENTS.md and ../AGENTS.md. Read README.md before changes.

- This installed preview is authoring only and explicitly under construction. Never register a solver or temperature measurement without separate current-core numerical and hardware qualification.
- Runtime stays in plugin.js with the existing resource-free native-fan.js metadata and native-frame.js validator. No custom renderer, panel, scene model, solver, field state, worker or second GPU device.
- Use the shared native 100 mm helper primitive. Probe is 2 mm at owner-local origin; New Fan is 30 by 30 by 10 mm (local X/Y/Z), at owner-local [-25,-12.5,-12.5], pointing along local X. These are one-shot packed creationFrame values; native frames are authoritative afterward.
- Creation uses one native authoring transaction and then awaits context.editor.selectOwner. Never replace it with UI-only document.select, recursive serialized API calls or selection repair.
- Fan and Probe hide internal Thermal references; Fan also hides legacy Direction and displays Pressure for the stable stored Shutoff pressure key. New Fans point along local +X; saved Reverse values retain legacy behavior. Thermal references are explicit native hashes, never inferred from parents or accepted as session IDs. Native drop, copy, clipboard, HASH and history must preserve current core semantics.
- Under construction is the existing disabled native attribute action. No Solve/Measure UI action. The named numerical API endpoints always reject before mutation/device access; do not return a pretend temperature or silently activate another runtime.
- Material/Heater tags are not registered in this preview. Existing unavailable declared authoring stays opaque in current core. Copy must preserve its payload and unresolved-reference marker. Undeclared extension omission must retain the core import report, never be described as lossless preservation.
- Tests execute source-extracted current core where possible and label CPU adapters honestly. Browser tests use a fresh context and hardware WebGPU, never the user's working scene or software fallback. Do not transfer old hardware PASS to new core.
- Run the focused CPU tests and source syntax checks. tests/authoring-browser.mjs is the dedicated hardware authoring gate; tests/index.mjs integrates it into the catalogue suite. Record exact final source hashes. Standard/stress and 100M-scene performance remain separate gates; honor the coordinator's explicit queue and hold before running them.
