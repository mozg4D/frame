# Native Thermal input observation prerequisite

This is an **unfinished, unregistered, read-only preparation experiment**. It does not install Material or Heater tags, classify geometry, prepare a grid, execute a numerical solver, publish temperatures or add an operation/UI. Ordinary Thermal remains authoring-only. The existing P(T) numerical backend is unchanged.

## What the current core actually provides

At the tested source, `context.scene.capture(hash, keys)` calls native `pluginSnapshot(hash, keys, true)`. There is no third tag-filter argument and no `prepareVolume` helper. The older Thermal classifier's call with a third tag argument silently receives no tags. Native capture returns scene-wide **visible** surface occurrences, their source-buffer identities, counts, source-accuracy metadata and exact owner-relative matrices. It does not clip to a Thermal box. The main signature rounds each matrix coefficient to 1e-9 and therefore cannot alone detect arbitrarily small changes. `sourceAccuracy` is an evaluator/document-polygon contract, not a closed-solid or cuboid-volume proof.

The current generic tag declaration accepts finite numbers, booleans and scalar-choice enums. `ranges` and `fieldOptions` declarations are rejected; array-valued P(T) tables are not supported. The installed Thermal manifest declares no Material or Heater tags. Previously saved unknown Thermal tags remain in opaque `ignoredAuthoring`, not active `node.tags`. They are never interpreted by this module.

The older scene-grid adapter expects `Heat capacity` in J/(m³ K). It is not the requested mass-specific heat in J/(kg K). Reusing that name/value as mass-specific heat would silently produce incorrect storage energy.

## Bounded data contract

`captureNativeThermalInputs(context, nativeOwnerHash, {signal})` must be invoked outside the existing Frame command FIFO, after native scene settlement. Calling it recursively from a `plugins.command` handler would re-enter the FIFO and is unsupported.

Calling native `tag.list` inherits the normal command's pre/post settlement. That settlement may evaluate geometry, plugins or Morph and may allocate/read GPU resources. The adapter does not bypass it. Therefore the whole call is **not** a zero-GPU-work operation. Resource metrics are explicitly `adapterOwnedGPUBytes:0` and `adapterGeometryReadbackBytes:0`, with `inheritedNativeSettlement:true` and `wholeCallGPUWorkMeasured:false`; these describe this adapter's direct operations only.

The experiment discovers actual installed definitions through native `tag.list`, verifies their native `thermal` plugin ownership, and accepts only these exact numeric scalar candidate schemas:

- `thermal_material`: `Density` in kg/m³, `Specific heat` in J/(kg K), and `Conductivity` in W/(m K).
- `thermal_heater`: `Power` in signed total watts for one native object.

All material values must be explicitly present, finite and positive. Density times specific heat is formed once, with overflow/underflow rejection. No material preset, density, fluid role, emissivity, latent heat or temperature dependence is inferred. Heater Power is retained once under `(sourceOwner, tagUID)`, never multiplied by occurrence count. Each physical tag UID must be unique against **all active tags on the same owner**, including non-physical tags. The same UID under different owner namespaces is allowed. Current native HASH validation/restoration does not enforce this uniqueness, so the adapter must reject collisions explicitly.

Repeated occurrences, native `instance`, `cloner` and `symmetry` owners, any owner declaring `instanceCloud`, and exposed replica metadata reject. A **single** visible occurrence does not prove direct source ownership: current native capture drops canonical `replicaSource` and `replicaMatrix` fields. The adapter never substitutes the instance/cloud occurrence hash for a hidden canonical source hash. Direct evaluated primitives remain observable; this is not a blanket rejection of generated surfaces or a proof of their physical geometry. Inherited physical tags, multiple active tags of one kind, missing materials and unresolved tag identities also reject. This narrow direct-owner policy is not a future inheritance design.

These declarations are **not installed**. On the ordinary preview the call fails with `THERMAL_TAGS_UNAVAILABLE`. Positive tests use candidate declarations in an explicitly isolated test registry or intercepted test manifest. That proves the generic current-core path, not the availability of physical authoring in the published application.

One to 64 captured occurrences are supported for this preparatory operation. The detached, deeply frozen snapshot contains canonical hashes, native source kinds, direct tag UIDs/source-owner provenance, exact unrounded occurrence matrices, the complete unrounded owner world frame, physical SI material properties and signed object watts. No GPU buffer, texture, device or triangle data appears in the returned snapshot. The observation object temporarily retains borrowed identity references for comparison and releases them on disposal, cancellation or failure. The adapter itself owns no GPU resources and performs no geometry readback; inherited native settlement is outside that accounting.

Orthogonal nonuniform and reflected Thermal frames reuse the installed physical-frame validator. Their owner-local millimetres-to-physical-metres factors are `axisLength * 0.001`. These are lengths only. No physical object volume, mass, cell classification or watts-per-volume is claimed until a separate geometry proof exists. Ambient and Initial remain Celsius observations. Ambient does not implicitly become a Dirichlet bath, convection model or exterior temperature condition.

## Presentation is not physical participation

The module identifies the native capture's presentation filtering explicitly and reports `completePhysicalScene:false`. An active physical-tag owner omitted by native capture rejects with `UNCAPTURED_PHYSICAL_SOURCE`; a hidden/Solo-filtered tagged source is not treated as empty space. Authored `enabled` state and enabled ancestors are checked separately from presentation visibility. Missing or ambiguous owner/hierarchy identities reject.

Untagged uncaptured geometry cannot be proven absent using this API. Bounds are never used to fill a solid, clip a source or certify domain coverage. A captured object far outside the Thermal box can be **observed**, but the snapshot still has `geometryClassified:false` and `solverReady:false`. It cannot be passed as a certified solver domain. Partial-domain geometry, including whole-object P(T) means requiring an outside temperature, remains blocked.

## Native lifecycle evidence and the asynchronous gap

The module observes `fields.read {owner, field:'name'}`. Its epoch and revision are actual shared native metadata tokens:

- Epoch is a runtime document/history generation and resets for native history and authoritative document replacement.
- Revision is `FrameAuthorData.generation`, a conservative **global** authoring transaction generation, not a per-owner or per-field counter.
- Author-data content/envelope revisions are separate persisted values and may rewind under Undo. They are not used as a document-lifetime lease.

The `checkObservedInputs()` method compares these observations, exact owner/source node identities, scene/device/resource identities, complete unrounded frames and physical tag values. It detects observed changes, same-hash owner replacement, normal ABA edits, Undo, HASH replacement, geometry changes and cancellation. A failure permanently retires the observation object.

However, the token read used by **this path** is asynchronous. The core now separately provides `context.fields.authoringStamp()`, a synchronous frozen `{epoch,revision}` observation of the same native counters. This module intentionally does not consume that capability or change its readiness claims merely because the method exists. A native edit can occur after the core took the async read and before the awaiting caller resumes. Changed physical values are caught by the synchronous data comparison, but an ABA edit ending at identical physical values in that gap cannot always be detected. A regression negative control executes real native tag commits and proves this limitation.

Consequently every snapshot and successful comparison carries `currentnessCertified:false`. A successful comparison means only `observationMatched:true`. It is **not** a synchronous numerical guard or permission to publish a result. Never pass the async function to `heater-power.js`'s synchronous `check` callback. There is no authoritative solver lease in this layer.

`checkObservedInputs()` is also unsuitable as an **in-flight numerical job guard** because its `tag.list` call re-enters native settlement, which can flush plugins. Depending on a future Thermal plugin's flush behavior, that could wait on the same job's own work tail. This is an integration risk to inspect, not a demonstrated current deadlock. Initial metadata discovery must stay separate from per-step and final-publication guards. The separate synchronous native authoring-stamp API avoids the FIFO/settlement path for authoring observations, but does not itself establish geometry completeness, certify resources or fence pending FIFO commands. Its transient `BUSY` result during held-pointer/navigation gestures means retry or pause, not proof that physical inputs changed. Integrating it into a numerical lifecycle remains separate work.

The global generation is deliberately conservative here. It is not a qualified physics-cache invalidation policy. The eventual solver must separate physical dependencies from camera, display Result, Section and other presentation changes; those must not cause an automatic Solve.

## Minimal core prerequisite before native execution

A broader shared read-only capture contract is still needed beyond the existing scalar authoring stamp, not a Thermal shadow registry:

1. Atomically capture document readiness/epoch, relevant authoring generation, exact native owner identity and current evaluated occurrence identities, plus declared active effective tag values with source-owner/tag-UID provenance. Reject native IO, replacement, history, gestures and unsettled geometry without triggering nested command settlement.
2. Use the existing **synchronous** authoring stamp as one observation when designing currentness checks for that native capture. Fence document/owner replacement and ABA edits before and after every numerical await, while separately retaining and validating actual resource/source/evaluation identity and full unrounded relevant transforms rather than only the existing rounded signature. Stamp copies are observations, not authenticity certificates or a complete capture-currentness predicate. No GPU allocation or readback is needed for authoring checks.
3. Define physical participation separately from viewport visibility/Solo and prove capture completeness for the requested domain. Do not call a rendering-filtered set a full thermal domain.
4. Then supply a bounded, independently validated geometry classification route on the actual current buffers. Begin with explicitly proved complete cuboids if useful. No bounds-only filling, hidden union, default material/fluid or partial-heater watts normalization is acceptable.
5. Separately define native P(T) table authoring, typed references, copy/HASH/Undo and stale evaluation semantics using supported native records. Scalar tag fields alone cannot represent the table. Do not reinterpret opaque legacy data or make literal tag UID strings into implicit references.

This observation module makes no core changes and does not consume the separately implemented authoring-stamp API. The broader capture, participation, geometry and source-table contracts above remain open and require shared-core review.

## Units and precision fixtures

An explicit analytic 20 × 20 × 10 mm aluminium test grid has V=4e-6 m³, density 2700 kg/m³, mass 0.0108 kg, specific heat 900 J/(kg K), volumetric capacity 2,430,000 J/(m³ K), and total capacity 9.72 J/K. At 40 W for 0.01 s, the insulated rise is 0.0411522633744856 K. The test maps those observed scalar properties into the **existing** explicit-grid P(T) planner and verifies invariant total watts and heat capacity under 1³, 2³, 4³ and 8³ refinement. Its dimensions are an independent analytic test oracle, not a classification result issued by this bridge.

A 100 mm aluminium cube has V=1e-3 m³, mass 2.7 kg and total capacity 2430 J/K. At 100 W for 0.01 s from 20 °C, the exact rise is only 0.0004115226 K. The nearest Float32 Celsius result has a 0.112915% source residual and cannot pass the unchanged 0.1% source gate. At 0.1 s from 20 °C the nearest residual is approximately 0.020218%. No tolerance, source gate or precision accounting is relaxed to force the first case through.

## Qualification

Run with Node 22 or newer from the repository root:

- `node --test experiments/thermal/tests/native-inputs.mjs experiments/thermal/tests/heater-power.mjs`
- `node experiments/thermal/tests/native-inputs-browser.mjs`
- `node tests/plugin-tag-fields.mjs`
- `node tests/scene-control-data.mjs`
- `node tests/syntax.mjs`
- `npm test -- --headless`

CPU fixtures execute exact source-extracted current native `pluginSnapshot`, `cloudRows`/`nativeSurfaceOccurrences`, HASH authoring validation/restoration, generic tag declaration/setter, checkpoint/Undo, author-data validation/CAS, registry/FIFO and epoch behavior. DOM/GPU storage and settlement are explicitly CPU adapters. No author-data method is replaced by a no-op. Regressions include one actual-shaped replica with a hidden canonical source, one cloud occurrence emitted by the real native function, and native HASH-accepted UID collisions. The detached observation is also tested for malformed material/schema/identity, unavailable legacy data, stale/cancel/replacement, precision and completed-operation latency. The 64-occurrence capture plus comparison budget is 1000 ms; only adapter-owned GPU bytes/readback are zero. A fixture counts actual native settlement calls rather than pretending the inherited command never settles.

The native browser gate uses fresh isolated headless contexts on the actual borrowed Frame hardware device. The first retains the installed manifest and proves absent physical tags are rejected. The second injects only candidate scalar tag declarations and a context-observation statement through test HTTP routes; application files remain unchanged. It exercises actual native tag.set, Undo, author-data CAS, HASH reopen, hidden-source rejection, a deliberately colliding UID retained through actual HASH export/reopen, and one genuine native Instance over a hidden canonical source. It records exact source hashes, adapter identity, operation timings and JS/console/GPU errors. The buffer-label monitor checks only `Thermal `-prefixed buffers, not every allocation or readback caused by inherited native settlement. It imports no numerical solver and is **not numerical hardware qualification**.

Full standard, geometry stress and actual native numerical qualification remain distinct. A successful observation test never means Thermal or native solving is ready.
