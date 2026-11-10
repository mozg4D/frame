# Structural native capture and bounded grid preparation

Uninstalled experimental continuation, 2026-11-09. This observes current native geometry and produces a local grid recipe with checked ownership/lifetime. It does not voxelize source polygons or run a scene solve. Existing installed Structural authoring remains unchanged.

## Current-core evidence

The inspected main is 649c046723fc2d181e75d234c43ddf73f5165e75. Its plugin scene bridge calls `pluginSnapshot(hash, keys, true)`. It returns evaluated occurrences with `hash`, per-snapshot `solid`, owner-relative `matrix`, conservative local `bounds`, borrowed positions/indices, counts and storage mode. It does not accept requested structural tag kinds or return effective inherited tag records. The saved older captureLoadInputs/collectSnapshotInputs path therefore cannot be activated unchanged. This experiment uses the actual two-argument contract and reports `effectiveTagsAvailable:false`.

CPU tests extract and execute that actual core snapshot function, with CPU providers for the renderer/device identity, native occurrences, local bounds and affine multiplication. This verifies the current function's snapshot fields and signature composition. Those providers do not evaluate geometry or emulate GPU arithmetic. Native browser/hardware behavior remains unqualified.

## Capture contract

`captureStructuralDomain(context, ownerHash)` requires a current Structural owner, the native synchronous `fields.authoringStamp`, scene capture/signature, document world/frame and shared device. It rejects an active transform, invalid pitch, unsupported world frames and excessive grid capacity before requesting resources.

The local box is the installed helper's [-50,50] mm on each axis. The retained domain reference converts native world scale and Voxel size in mm to SI distances. It accepts a right-handed orthogonal box, including rotation/nonuniform scale, and rejects shear, reflection, degenerate/unrepresentable coordinates. Counts are `ceil(physical length/requested pitch)`; actual uniform spacing fits the exact box and is at most the requested pitch. This retained reference policy is explicit; no cells are allocated outside the domain. This stage bounds the grid at 4096 cells to match the resolved-load handoff. The default 100 mm box at 1 mm exceeds this experimental capacity and rejects; no automatic pitch adjustment or claim of production capacity is made.

The returned frozen handle provides:

- `descriptor`: immutable ordinary metadata, grid recipe, source occurrence IDs/frames/bounds/storage/counts and explicit unavailable flags. No GPU objects or native resources appear in it.
- `borrowGeometry()`: current native positions/indices references plus copied occurrence metadata. These are borrowed, read-only resources. Check `assertCurrent()` before every GPU submission and after every asynchronous boundary. Do not map, destroy, write or retain them after retirement. No resource storage format conversion is performed; texture occurrences remain texture occurrences.
- `assertCurrent()`: checks the synchronous authoring epoch/revision, native frame, owner world matrix, captured source/resource signature, shared device and transform barrier. An observed mismatch permanently revokes the handle and drops its snapshot/resource references; returning to an earlier frame cannot revive it. Edit-back/Undo ABA is rejected even if final geometry/frames return to their earlier values. The native stamp is conservative/global, so unrelated native edits may revoke this observation; it is not yet a relevant-input physical cache key.
- `prepareAuthoredBoundaryCase(input)`: checks owner/frame/grid agreement, then reuses the second continuation's full resolved-material/load/fixture/PCG admission path. The output explicitly marks occupancy as caller-authored and `geometryClassified:false`. Masks do not become certified native occupancy merely because geometry was captured. This is a testable handoff for future classification output, not classification itself.
- `retire()`: idempotently revokes new borrows and drops the handle's snapshot/resource references. It does not destroy core-owned GPU resources. Already returned borrowed references remain subject to the caller's lifetime contract.

Conservative bounds are broad phase only: a proven distant occurrence is excluded; crossing or missing bounds retain the real source references. Bounds never create material cells. Different instances of one native source retain separate `solid` IDs. Polygon normals are neither captured nor used by this preparation layer.

## Boundary conditions and remaining work

Authored resolved cells must match the observed owner's physical grid/frame. The reused preparation checks explicit SI materials, unique owner+tag provenance, additive total Force/Torque, full-cell initial overlap fixture translations, conflicting constraints and every component's constrained rigid modes before any numerical device work. It preserves independent body grids. This does not derive fixture overlap from native geometry, transport rotating fixtures, implement sliding contact or activate unavailable Force/Material tags.

Next work requires a current-core-compatible robust clipped GPU occupancy stage and effective physical tag provenance, then numerical hardware comparison on the same captured geometry. No CPU triangle readback/mirror, polygon repair, native document mutation, user-scene changes, worker, renderer or additional device is introduced. GPU/shared suites remain paused for the coordinator's integration gate. See qualification.json and SOURCE-PROVENANCE.json for exact evidence.

Run the CPU gate from the prepared Frame checkout:

    node --test experiments/structural-capture/tests/capture.mjs

Tests cover the actual current capture function's fields, distant/crossing/unknown bounds, repeated buffer/texture occurrences, rotated scaled domains, unsupported frames/capacity, source/device/frame changes, ABA/stamp races, retirement, authored boundary-condition admission, metadata isolation and completed-operation CPU timing. Neither those tests nor historical PCG hardware reports qualify a current scene solve.
