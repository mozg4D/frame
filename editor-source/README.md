# Current editor source

This directory reconstructs the r239 STL-import and affine-island editor exactly. The shipped editor is the complete application source; a small hash-checked extraction delta recovers the pinned integration base without a duplicate bundle. The base rigid helper and integration steps are followed by the current affine helper, known-geometry binding helper and a compact exact delta. Subsequent STL-only helpers and compact integration deltas bind the exact crease and edge calculations, then the postprocess coordinator.

Rebuild requirements: Node 20+ and TypeScript 5.9.3. The affine test suite requires Node 24+. Set `FRAME_TYPESCRIPT` to its `lib/typescript.js` path when needed.

    node editor-source/rebuild.mjs /absolute/path/outside/frame/editor.mjs

The output must be new and outside the checkout. `build-manifest.json` pins the production editor/native paths, byte lengths and hashes. Unchanged sources reproduce the editor byte-for-byte; mismatches fail before output. Native source has separate [rebuild instructions](../native-source/). These commands do not deploy.

## Scope

Eligible indexed whole-island Move, Rotate and Scale in World/Object coordinates use owner-bound canonical affine work. Ordered authored coordinates, crease normals and topology follow the stock calculation, including cases that require the full stock path. Unsupported selections, extra vertex attributes, UV edits, soft selections and other unsupported contexts retain CPU behavior. The fast eligibility limit is 524,288 selected faces and 128 contiguous face runs. Actual latency depends on preparation, worker publication and selection size; no frame-rate guarantee is implied.

Source, device, owner, material, selection and gesture identities guard asynchronous work. Publication, cancellation, Save and Undo/Redo retain exact authored geometry and coordinate-manager/pivot behavior. Worker and display resources have explicit ownership and retirement. Plain wire remains tied to the current raw position view. Native `.hash` loading preserves saved normals and indices. The general GPU v10 importer/pose store remains separate development work.

STL import uses Float32-specific coordinate classes with guarded stock-format fallback near decimal boundaries. Both ordered crease passes, parser, axis conversion, bounds, picking, wire, transfer, cancellation and installation remain in their original order. The component stock crease function is unchanged. The private STL edge table retains full-key equality and encounter order. Typed capacity is capped at 4,194,304 slots (48 MiB of live table arrays), with exact stock Map fallback at the cap or on typed allocation failure. This is a table limit, not a bound on total import memory. When the compute budget has at least two slots, larger imports release the coordinator lease before independent BVH and wire jobs. Both crease passes remain serial and unchanged. Additional transferred index copies reserve a shared 64 MiB budget; copy pressure uses one combined BVH-then-wire worker. Small meshes and single-slot budgets retain the original serial path. Helper results, cancellation, leases and object-URL cleanup are guarded; the copy reservation does not bound total import memory.

## Portable checks

    node editor-source/tests/stl/run-review.mjs
    node editor-source/tests/affine/run-review.mjs
    node editor-source/tests/alias-guards.mjs
    node editor-source/tests/stable-face-proof.mjs
    node editor-source/tests/guards.mjs
    node editor-source/tests/hash-loader.mjs
    node editor-source/tests/wire-gestures.mjs
    node editor-source/tests/service-worker.mjs
    node native-source/tests/rigid-resource-lifetime.mjs

The affine aggregate uses current manifest-resolved runtime and source files, the existing Three core module and small synthetic oracles. It retains the prior 69 lifecycle controls, with retired direct-GPU units identified separately, and adds active canonical affine, stock arithmetic, publication, cancellation, resource, Save, history and pivot contracts. Retired rigid-derived job tests are superseded by the active affine publication boundaries; their old 31-control count is not claimed for this implementation.

These are CPU/source and mocked GPU checks, not browser, physical-input or device acceptance. No private fixtures, browser probes, receipts, historical candidate bundles or installed dependencies are included.
