# Circuit (under construction)

This is an authoring preview, not an electrical simulator. It deliberately returns no calculated voltage/current and has no running firmware or Scope. The completion criterion from the Circuit concept has not been reached.

## Available now

- An ordinary, empty Circuit owner. It has no square, surface, box or calculation volume.
- Separate ordinary Resistor, Capacitor, Inductor, Diode, LED, BJT, MOSFET, Voltage source, Current source, Controller and custom Component objects. Circuit Attributes has compact creation actions; components use native selection, transforms, visibility, parameters, Undo and HASH.
- Flat local-X/Z line symbols on a transparent background, drawn through the existing shared-device render callback. The symbols never face the camera automatically. There are no SVG-texture cards or extra rows for strokes/pins.
- Stable local pin identifiers and positions. Each component's native Circuit reference is explicit and independent of grouping. Creating a component from the owner makes it a child of that owner. Standalone components are unassigned.
- Owner-local stable networks, one-pin assignment/disconnection, rename/merge, explicit Ground, and a connected-tree visualization controlled by Nets. Crossing lines does not connect networks. Visibility affects only the authoring display.
- Common field discovery and native authoring writes for declared scalar parameters, with units/ranges supplied by the manifest. No competing binding registry.

These parameters are authored intentions, not complete validated electrical models. A Controller is an inert component. An LED has no calculated light output; its arrows are a static symbol. Polarity is retained as metadata; variant-specific symbol embellishment is unfinished.

## API

Discover with frameAI plugins.describe for plugin circuit, then call the existing plugins.command on an owner's native hash.

- status / inspect: inspect owner networks or component pins. Unavailable pin voltage is null with availability solver-unavailable, never a false zero.
- topology: read a bounded, detached connectivity snapshot for one Circuit. Includes stable component/pin/net identities, local pin positions and explicit owner/component enabled flags. Visibility and parenting do not alter electrical membership. It validates record integrity and rejects dangling net references; it does not validate electrical models or physical solvability.
- create-component: kind from resistor, capacitor, inductor, diode, led, bjt, mosfet, voltage, current, controller or custom; optional name. Custom accepts 1–64 explicitly labelled local-position pins. Compact create-resistor and equivalent actions are also registered.
- create-net: name; returns an existing or new owner-local stable ID.
- assign-net: component owner, stable pin ID, name. A nonempty new name creates a network, an existing name connects to it, and empty text disconnects that pin only.
- rename-net: Circuit owner, stable net ID, new name. An existing name merges all member pins and Ground into its canonical ID in one native Undo transaction.
- set-ground: Circuit owner, net ID or null. It observes an explicit reference network, not an implicit connection.
- move-component: component owner, target circuit hash. Explicit transfer clears network assignments while retaining pin IDs. Ordinary reparenting never transfers electrical membership.

Network names are Unicode NFC, trimmed, case-sensitive, 1–128 UTF-16 code units without control characters. Empty text is accepted only for pin disconnection. Unassigned pins are distinct, not one implicit node. Networks in separate Circuits are independent even if names match.

Topology node identifiers are `n_<net ID>` for assigned networks and `p_<component hash>_<pin ID>` for disconnected pins. Only the explicitly selected Ground maps to `0`; a network named `0` has no special meaning. Clients must address nodes as `(circuit, node)` because copied Circuits retain owner-local network IDs. Node names never contain user-entered net names. Components and nets are sorted by stable identity; pin order is the authored order. Disabled components remain in this authoring snapshot with `enabled:false`; this is not a compiled active solver graph. No connectivity snapshot is persisted in HASH or cached as a second scene model.

Creation and explicit or generic ownership transfer validate target authoring data before mutation. Generic owner edits also enforce the same component bound. Failed target preflight does not add an Undo step.

Bounds are 512 created components per Circuit, 64 pins per component and 1024 networks per Circuit. Authoring settings use seconds of electrical time per Frame second (default 0.001 s/s) and decimal MB (1 MB = 1,000,000 bytes). History is only a future allocation ceiling; the preview allocates no measurement history.

## Explicitly unfinished

- ngspice/WASM selection, reproducible build, licensing/dependency review and real JS/solver closed-loop prototype.
- DC, transient and AC analyses; model import, model validation/replacement, real-part/footprint metadata, netlist export and numerical tolerances.
- Controller execution and accepted-time event scheduling with Scene Control. Shared Scene Control currently exists but its full simulation/export lifecycle contract is not implemented by Circuit.
- Interactive Net/Ground/pin rows, pin/net hit-testing and highlights, compact labels and viewport context menus. Use the native Object Browser for selection and the API for network authoring. Custom component positions are preserved; custom pin lead artwork is unfinished.
- One shared Scope window, read-only Curves, differential measurements, history storage/decimation, reset/replay and memory qualification. No separate window or transport was copied from Docs.
- LED preset integration and current-dependent temporary emission.

solve, transient, ac, reset, scope, controller, results and export-netlist reject with CIRCUIT_AUTHORING_ONLY before mutation. Unsupported work is not reported as Passed. No ngspice, model-library or other third-party executable artifact ships in this preview; original project code/artwork follows the repository LICENSE.

## Data and lifecycle

Authoring JSON is stored in the existing native plugin record at the stable field identity declared in data.js. Only owner-local nets/pins/Ground are stored there. Circuit object references are normal native reference parameters, so native copy/HASH remapping owns them. Record values are replaced, never mutated in place. No samples, caches, derived polylines, GPU buffers, solver heap or live program state are saved.

The renderer reuses canonical Frame transforms, the shared device, native pass, camera and frame uniforms. Identical component symbols reuse one small vertex buffer. Network buffers are bounded, invalidated by authoring, Circuit-owner inverse frame, component world frames and effective inherited visibility, and retired on owner deletion/device loss. There is no competing scene graph, animation loop, Undo, panel, runtime, GPUDevice or electrical state.

## Checks

CPU: node plugins/circuit/tests/authoring.mjs. Native browser gate: node plugins/circuit/tests/index.mjs (visible hardware Chromium by default; --headless explicit). Catalogue discovery uses that same pluginChecks entry point. Source hashes and hardware evidence are written to tests/results/circuit-authoring-preview.json. CPU adapters do not certify actual HASH/UI/GPU behavior. Current test results and unrun release gates belong in QUALIFICATION.md.

## Stable viewport depth

The viewport opts into `context.viewport.cameraWGSL` and its affine `frameCameraRelative` helper, documented in ../../plugins.md. The public camera uniform is unchanged. Only local projection arithmetic changes; depth policy, authoring, geometry, computation and persistence remain unchanged. The helper preserves tiny relative depth gaps but retains Float32 camera-base error. Native validation remains required.
