# CFD authoring architecture

## Native ownership

The static manifest registers cfd, one ordinary scene object type, a native 32x32 icon and four scalar/choice parameters. Its module is lazy. Scene objects, fields, transforms, pivot, animation, selection, hierarchy, Undo and HASH are owned by the core. This plugin stores no parallel model, GPU buffer, result, cache, job or source geometry snapshot.

activate(context) registers one read-only status operation, three explicitly rejecting numerical contracts, a parameter guard and the existing disabled native Attributes notice. The shared viewport bridge receives twelve box edges and three local-X direction segments. It owns the device resources for those ordinary helpers. The surface shader always discards, so no geometry recoloring is presented as a physical field. The plugin never creates another device or touches canonical geometry resources.

LOCAL_BOX and helperLines describe local millimetre authoring geometry. Native owner transforms place it; the default pivot is the lower box corner. The flow marker spans opposite local X faces regardless of pivot edits. It is not a simulation result and does not vary with Speed.

## Availability and lifecycle

Every owner has authoring-preview / under-construction status. No action enters preflight, solving or completed; there are no physical fields to become stale. Parameter changes validate before native mutation, and the core handles normal reconstruction on HASH, copy, Undo and device replacement. No runtime records are serialized.

The numerical source checkpoint remains outside this release payload and is never imported or preloaded. It retains its own independent development/test constraints. A new numerical capability must be coupled, qualified on current hardware and accepted in the native scene workflow before any Solve/results controls or result operation are enabled.

## Tags

No tags are registered. The concept specifies automatic participation by evaluated geometry intersecting a box, rather than names or source tags. Future physical admission must include clipping, unsupported motion and ambiguity rules, and must not interpret this authoring helper as admitted geometry.
