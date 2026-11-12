# Optics (unfinished)

This initial native authoring foundation follows the user-provided Frame Optics concept, Pasted text(4).txt, 8 November 2026, sections 2-8 and 13-16. Work resumed on 9 November. It is not a completed optical CAD, scene solver or optimizer.

## Available

- Lazy plugin, 32-pixel native icon, Design Space box and separate Subject, Sensor, Source and Target objects. Add plane uses a single normal transaction and selects the created object.
- Native Attributes, transforms, Object Browser selection, history and HASH. Plane ownership and Subject-to-Sensor / Source-to-Target links are native hash references. They do not depend on names, nesting or proximity, and native duplicate/clipboard/merge remap internal references.
- Multiple tasks and planes. References must target the correct role in the same task. Reassigning an actively linked receiver to another task rejects; deletion preserves dangling references for diagnosis rather than reconnecting them silently.
- Finite Subject depth offsets and an explicit Infinity angular field mode. Infinity hides inactive finite-depth inputs; returning to Finite validates their order. Upright/Inverted is a stored mapping choice, not a computed image.
- Sensor pixel counts, monochromatic Source power/wavelength and intended Lambertian/Collimated distribution, Target relative/absolute uniform-goal authoring. No arrays or allocations proportional to pixel count are created.
- Blocker and Optical tags in the shared native tag registry. Optical stores intended model/coating categories only. Unassigned is deliberately not a material, and neither tag currently changes light transport. Ordinary viewport materials remain untouched.
- Compact read-only status/inspect and explicit rejection of unavailable calculation/publication operations.

## Plane convention

The authored 100 by 100 mm rectangle occupies local X/Y at Z=0. The small +Z line is a frame marker, not a calculated ray. U increases along +X; V increases along +Y. Future forward emission and forward reception use propagation toward +Z. Subject depth offsets are along local +Z. Native translation, rotation and scale define placement and physical rectangle size, with no duplicate angle/size controls. The frame marker is included in native focus bounds; it is not sensitive area.

New Subject/Source is at owner-local Z=-75 mm, Sensor/Target at +75 mm; these are convenient initial positions, not boundary conditions. Planes may be anywhere, including inside the Design Space or on the same side. The box limits future design changes only, never ray termination. Fixed optics and Blocker outside it must participate in a future solver. Visibility is presentation; enabled controls future participation.

## API

Use frameAI discovery and native plugins.command. Operations: status, inspect, add-plane {role:subject|sensor|source|target}, and create-subject/create-sensor/create-source/create-target shortcuts used by the native buttons. Parameter writes use scene.update or the common field adapter, with declared schema/ranges/units. Object references use the ordinary native reference controls.

solve, optimize, stop, create-result, to-mesh and results reject OPTICS_AUTHORING_ONLY before any mutation or GPU work. No job is running, so Stop is not presented as an actionable UI control. Status explicitly reports unavailable scene solver, optimizer, material physics, result and viewport edge picking. Measured power/image are null rather than zero. Finite references are validated before mutation; inspection reports unresolved references without hiding or replacing authoring.

## Limits and next gates

Viewport helper lines use the existing borrowed Frame render pass/device, with two static tiny buffers. Object Browser selection and native gizmos are available. Direct viewport edge picking of these differently shaped helpers is unfinished: it needs a generic per-owner helper-line bridge, not an Optics-only picking/scene implementation. No scene geometry is captured or mirrored.

Materials, spectral presets, surface coatings, texture goals, unit-physical geometry snapshots, nonsequential scene tracing, measured distributions, ray rendering, optimization, geometry publication, cancellation/stale-result/device-loss solver paths and manufacturing validation remain unavailable. The standalone CPU primitives in experiments/optics test interface laws only; they are not loaded, and do not qualify any of those features.

See PLAN.md for acceptance gates. Never infer diffraction PSF, universal optimization, a global optimum or manufacturability from this foundation.

## Isolated result-accounting work

`validation/power-ledger.js` evaluates compact per-source terminal-power aggregates supplied by a caller. It is not imported by the plugin, included in manifest assets, or exposed as a Frame operation. It does not trace rays, capture geometry, assign receiver categories, change authoring, allocate GPU resources or enable Solve. See `validation/README.md` for the input contract and limits. The existing `measuredPower:null` and unavailable-operation behavior remain unchanged.

Run the focused accounting checks with `node --test plugins/optics/tests/power-ledger.mjs`. Their conservation checks qualify bookkeeping only; they cannot establish that physical categories are correct or disjoint, that receiver targets are met, or that a scene calculation is valid.


## Native icon artwork

The native 32 by 32 pixel icon has a centered 22-pixel lens and a one-pixel minimum clear gap between the lens and outgoing strokes. Incoming rays, convergence point and stroke styling are unchanged. No SVG or CSS scaling is used. The shared source and raster checks are `tests/plugin-icon-alignment.mjs` and `tests/compact-icon-artwork.mjs`; native authoring behavior is unchanged.

## Stable viewport depth

The viewport opts into `context.viewport.cameraWGSL` and its affine `frameCameraRelative` helper, documented in ../../plugins.md. The public camera uniform is unchanged. Only local projection arithmetic changes; depth policy, authoring, geometry, computation and persistence remain unchanged. The helper preserves tiny relative depth gaps but retains Float32 camera-base error. Native validation remains required.
