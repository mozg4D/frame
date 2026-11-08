# Thermal authoring preview

Thermal is **under construction**. This preview provides native object authoring only. It does not calculate temperature, airflow, heat transfer or a numerical field. The helper box is not a validated physical domain. Ambient, Initial, Fan pressure/flow and direction are saved metadata, not active simulation controls.

## Available authoring

- Thermal uses the existing native 100 mm helper box and a genuine native 32 × 32 icon. The compact cube artwork is drawn directly on that grid with one-pixel box strokes and three lower 1.5-pixel heat marks at an intermediate four-pixel spacing; it is not a scaled version of a larger icon.
- Fan is a separate native child with an explicit Thermal reference. The shared box is scaled to 25 mm and placed at owner-local [-25, -12.5, -12.5] mm. Forward/Reverse follows the Fan's local X. Ordinary native transforms remain editable; detached metadata inspection does not certify numerical eligibility.
- Probe is a native 2 mm helper at the owner's origin with an explicit Thermal reference. It has no Measure action and produces no temperature.
- Native selection, Attributes, object-reference drop, transformation, duplicate, clipboard, HASH and Undo own all authoring. There is no parallel scene model, renderer or panel.
- Each object's Attributes shows the disabled native **Under construction** action. Thermal also has Fan and Probe creation actions. Material/Heater tags, Solve, results and temperature sections are not installed.

Creation commits once and awaits the core's editor selection queue. A selection endpoint error is surfaced after the creation commit; there is no invented rollback or automatic retry. A newer selection remains authoritative. Reparenting never silently changes the explicit Thermal reference.

## Automation

Discover through `frameAI.call('plugins.describe', {plugin:'thermal'})` and invoke operations through `plugins.command` with a native object ID.

- `create-fan` and `create-probe`: require a Thermal owner and empty arguments. Return the created native hash/type and `authoringOnly:true` after native selection completes.
- `fan-inputs`: accepts a Thermal or Fan owner and empty arguments. Returns authored local-X/world direction and detached frame/reference metadata, always `solverEligible:false` and `solverCoupled:false`. A supported frame is not proof of containment, grid alignment, enabled ancestry or physical validity.
- `status`: accepts Thermal, Fan or Probe and empty arguments. Returns `stage:'authoring-preview'`, `state:'under-construction'`, `authoringOnly:true`, `numericalAvailable:false` and `measurementAvailable:false`.
- `solve-grid`, `solve-scene`, `measure`, `inspect` and `inspect-velocity`: explicit read-only rejection endpoints. Any object arguments produce `THERMAL_AUTHORING_ONLY` before authoring mutation, geometry capture, device access or allocation. No numerical request is passed to an experimental solver.

Runtime consists of plugin.js and two resource-free reused helpers. native-fan.js retains the earlier native metadata contract. native-frame.js contains its existing frame validator without the unused numerical Probe sampling functions. The native viewport bridge alone owns its small line/uniform resources. No numerical GPU resource exists.

## Existing authoring and unknown data

The current core preserves unavailable declared plugin/tag metadata and declared binary records opaquely. Thus older Thermal Material/Heater tags remain saved but inactive. Copy remaps declared Thermal references and preserves unsupported payloads with their unresolved-reference marker; it does not infer unknown reference schemas. The importer reports unavailable plugins/tags and deliberately omitted **undeclared** extension records in its native import report. This preview does not change that behavior or promise lossless retention of undeclared raw extensions.

## Verification and limits

This preview is integrated on main 034e97ff3c942a81f1181a321f212f3172a4961e, preserving the published Scene Control, F1 Help and Doc geometry/lifecycle changes. Its core and service-worker delta is a matched release stamp only. A separate exact reversal layer verifies that no other core bytes changed. Release qualification binds the complete source inventory and includes dedicated authoring, affected native regressions, a bounded non-Unite profile, and service-worker update/offline checks. Older authoring or numerical hardware results do not qualify a newer source inventory.

Focused CPU commands:

```
node --test plugins/thermal/tests/authoring-preview.mjs plugins/thermal/tests/native-probe.mjs plugins/thermal/tests/native-selection.mjs plugins/thermal/tests/native-history-contract.mjs plugins/thermal/tests/opaque-authoring.mjs plugins/thermal/tests/browser-gate-contract.mjs
node plugins/thermal/tests/core-reference-contract.mjs
node tests/syntax.mjs
node tests/documentation-button-state.mjs
```

Source-extracted tests use the actual current creation/selection/API queues, native affine frames, history dispatcher, reference/copy/serialization helpers and opaque-authoring paths. GPU/DOM/checkpoint storage are adapters. They are not a full native browser or binary HASH acceptance result.

Dedicated hardware gate, run only in the coordinated isolated hardware environment:

```
node plugins/thermal/tests/authoring-browser.mjs
```

It requires identifiable hardware WebGPU and an isolated browser context. It checks defaults, immediate/queued child transforms, local-X direction, native reference drop and invalid drop, copy/clipboard/HASH, repeated history, disabled UI, numerical rejection, absence of solver requests/numerical buffer labels, GPU errors and measured CPU/GPU helper frames. The native Probe harness retains its existing assertions and budgets, with strict hardware-adapter identification. Test-only shared acceptance predicates additionally require a decoded native-size icon, all twelve Fan timing samples and exact owner/Fan/Probe restoration after delete/Undo; CPU negative controls are bound to the harness call sites. It must not use the user's scene, browser profile, OBS or printing.

Full standard/stress, large-scene/100M-triangle interaction and numerical qualification remain separate requirements. A bounded non-Unite release profile does not replace those broader gates. This preview has no public solve capability even if authoring passes. Qualification applies only to the exact tested source and current core; publication requires verifying the catalogue assets and service-worker update behavior.
