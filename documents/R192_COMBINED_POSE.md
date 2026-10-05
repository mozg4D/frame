# r192 combined Morph and point-animation roundtrip

## Reproduction

The retained native migration fixture reproduces on unchanged r191 (f2ce4174a88a928e7b9e33953f9691bb35ab4b9a). Its authored and decoded cage coordinate is 10.125; applying the loaded scene changes it to 10.1875 and changes the generated surface. Retained r177 loader evidence shows the same failure. Isolated Morph and isolated PLA previously passed because they did not exercise this composition.

Timeline evaluation wrote PLA before applying a changed Morph. Loading then reapplied every Morph after restoring animation. Exiting Morph pose edit and restoring a Morph undo command had equivalent ordering problems. A current pose adjusted away from its keys also changed during initial load because restoration resampled the keys.

## Bounded correction

Native import restores the stored current pose and animation channels without initial resampling. Spline and polygon Morph geometry is already materialized in the native scene; instance Morph retains its transient-cache reconstruction. The next deliberate timeline evaluation applies Morph before point, polygon-corner and handle channels, using the existing sampling and correspondence functions. Exact comparison keeps tiny F64 PLA changes. Pose-edit exit resumes the timeline after restoring Morph values.

Morph undo snapshots retain affected animated point/handle values in a runtime WeakMap. Restoring the tag restores these captured values as well, including manually adjusted current poses, then refreshes the affected geometry. This data is outside the scene records. Native polygon reconstruction retains supplied contour provenance but does not infer new saved provenance from an already posed render mesh when the input had none.

The native codec, snapshot/packing routines, Save worker code, fullBlob, file write and Share encoding are byte-identical to r191. The minimal 26-byte header, compressed record types and XOR keys remain. Existing F32 mesh and necessary F64 authoring words are preserved; there is no JSON native scene, Draco, quantization or precision reduction. Slicer, printer, service worker and the other 56 active assets remain unchanged. Prior runtime assets remain available.

## Verification

The final local release gate checks:

- The retained combined migration fixture, then 16 combinations: spline/polygon, static/animated Morph, material-before/Morph-before, and PLA-before/Morph-before channel insertion. Linear and soft interpolation, frames 0, 1, 5, 11, 12, 20, repeated frames, repeated loads, key edit/undo/redo, and actual mesh attributes, indices, groups and bounds are checked.
- Real browser filesystem Save/open into an existing scene, fresh file import and fresh Share load for all 16 combinations. Save, fullBlob and Share contain identical bytes for the same current scene. Different saved frames are used. Picker cancellation, malformed load, superseded repeated load, workers and compute-budget cleanup are checked.
- Eight retained bevel-tag combinations cover modelling/solve, enabled/disabled, and bevel-before/Morph-before. Fractional evaluations, 1.25e-10 F64 PLA motion, spline/polygon manually adjusted pose Save/load/Share, no-op pose edit, authored pose-edit undo/redo, and Morph value/key command undo/redo at frames 0, 5 and 12 are checked.
- Separate isolated Morph and PLA objects roundtrip at frames 0, 5 and 10, including signed zero, textured materials, typed metadata, parent/transform and generated surfaces. A large native worker load contains 300,000 stress-grid triangles plus combined polygon animation and an explicitly supplied valid contour origin. Supplied and absent provenance states, source records, rendered buffers, scrubbing and terminated workers are checked.
- All 15 native catalogue fragments, Save lifecycle cancellation/failure/concurrent-edit/buffer-ownership controls, actual Slice UI controls, retained certified spiral cases, 22 navigation rays and all 363 count-7 saved-scene public layer packets pass. Save/reimport preserves every packet.
- The normal 60-second PWA update retains an unsaved r191 page and its late assets. A fresh release page caches the exact critical assets and saves with native workers, reloads native scenes, loads library assets and slices offline. Combined animation also loads from Share and files and scrubs offline.

Native equivalence checks compare the address and type sets and every primitive numeric record byte. The existing binary-object property ordering can change on re-encoding; structured metadata is compared by exact values, signed zero and typed-array bytes. In the eight retained bevel/reference cases, the existing normalizer can make an inherited global approximation angle explicit on individual Morph reference segments; only that recorded default expansion is allowed by the separate comparator. No geometry or key value difference is waived. Rendered mesh arrays, indices, groups and bounds are checked independently.

## Scope and handoff

This qualifies the listed combinations, not every topology, constraint, curve mode, masked-axis arrangement, generator or large user scene. The 10-million-triangle Save benchmark is not rerun here: its worker and capture implementations are unchanged, and the lifecycle/offline worker regressions pass.

An unrelated existing createMorphCrowd defect is reproduced: it puts an undefined optional fixture field into instance Morph metadata and native Save rejects it with Unsupported binary value. The creator and codec are unchanged. Valid instance Morph reload is checked with that absent optional field omitted in the QA fixture only; this does not establish that the unmodified creator's output saves successfully.

Position 22 and pending slicer placement work remain outside this correction. There are no Library uploads. Local QA, including retained failed assumptions and reproductions, is kept in C:/Users/mozg4/Documents/Codex/2026-10-05/task-5/qa. Primary receipts are aggregate.json, combined.json, transport.json, extra-controls.json, manual-pose.json, pose-undo.json, morph-command-undo.json, isolated-roundtrip.json, worker-load.json, source-invariants.json, pwa-release.json and offline-combined.json. Publication is sealed separately with exact-head Pages CI and a committed-byte live inventory.
