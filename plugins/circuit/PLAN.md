# Circuit continuation plan

Baseline: remote main `649c046723fc2d181e75d234c43ddf73f5165e75`, inspected alongside the original Circuit concept and the preserved November 8 authoring-preview package. The published folder, manifest, native icon, ordinary objects, network editing and cache correction already exist. Do not recreate them.

## Current bounded increment

- Read-only topology snapshots with owner-local stable network nodes, explicit Ground, distinct disconnected pin nodes, enabled flags and record/reference validation.
- Pre-mutation target validation for creation, transfer and generic owner assignment; consistent component capacity.
- CPU regressions and operation latency budgets. Native topology/HASH tests added to the existing plugin gate; execution remains a separate release gate.

This is authoring infrastructure. It is not electrical model validation, a SPICE netlist, a solver or a device qualification.

## Next milestones and ownership

1. Solver adapter: choose and pin an ngspice source/build, audit its actual COPYING and dependencies, and prove incremental closed-loop JS/RC execution before expanding the UI. Require accepted-time events, preserved capacitor state, trial-step callback discipline and bounded solver storage. Do not ship a batch-only wrapper as this proof.
2. Core coordination: Scene Control has managed programs and workers, but its documented timeline/export lifecycle remains unfinished. Agree one lifecycle contract with its owner; reuse common bindings, model time, transactions and diagnostics. Circuit must not add another runtime or simulation loop.
3. Authoring interface: interactive pin Net rows, Ground, stable pin/net hit testing and labels need the shared Attributes and picking contracts. Keep English UI, normal geometry and existing icon sizes. No Circuit-specific tags, PCB objects, Scope objects or pin Browser rows are required.
4. Models and compilation: validate built-in parameter sets/polarity, explicit model/pin mapping and provenance; then compile a supported netlist using identities, with diagnostics for missing models and references. Topology snapshots alone are insufficient.
5. Results and Scope: accepted state identity/revision, stale results, differential references, then the common Docs window lifecycle and a read-only Curves view. Do not copy the window transport or editor.
6. Qualification: analytical divider/RC/RLC comparisons, semiconductor currents, controller feedback, event determinism, bounded JS/WASM history, HASH size independence, reset/pause/seek behavior, lazy/offline loading and resource cleanup. Report each unimplemented or unrun scenario explicitly.

Keep plugin work in its isolated checkout. The release coordinator owns shared-file integration, hardware-test scheduling and publication. UI/core/solver milestones should claim separate file ownership before concurrent edits. No hardware run or main publication is implied by CPU test success.
