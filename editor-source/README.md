This source reconstruction is updated for r246. The prior checked helper integrations remain explicit; a final hash-checked r243 delta reproduces the shipped runtime exactly. Baseline source/helper contracts are retained for regression oracles.

# Current editor source

This directory reconstructs the r241 edge-selection, STL-import and affine-island editor exactly. The shipped editor is the complete application source; a small hash-checked extraction delta recovers the pinned integration base without a duplicate bundle. The base rigid helper and integration steps are followed by the current affine helper, known-geometry binding helper and a compact exact delta. Subsequent STL-only helpers and compact integration deltas bind the exact crease and edge calculations, then the postprocess coordinator. The edge-selection helper, exact CM math and final checked delta complete the current source. A small reverse delta also supports pinned pre-edge regression oracles without duplicating the editor.

Rebuild requirements: Node 20+ and TypeScript 5.9.3. The affine test suite requires Node 24+. Set `FRAME_TYPESCRIPT` to its `lib/typescript.js` path when needed.

    node editor-source/rebuild.mjs /absolute/path/outside/frame/editor.mjs

The output must be new and outside the checkout. `build-manifest.json` pins the production editor/native paths, byte lengths and hashes. Unchanged sources reproduce the editor byte-for-byte; mismatches fail before output. Native source has separate [rebuild instructions](../native-source/). These commands do not deploy.

## Scope

Eligible indexed whole-island Move, Rotate and Scale in World/Object coordinates use owner-bound canonical affine work. Ordered authored coordinates, crease normals and topology follow the stock calculation, including cases that require the full stock path. Unsupported selections, extra vertex attributes, UV edits, soft selections and other unsupported contexts retain CPU behavior. The fast eligibility limit is 524,288 selected faces and 128 contiguous face runs. Actual latency depends on preparation, worker publication and selection size; no frame-rate guarantee is implied.

Source, device, owner, material, selection and gesture identities guard asynchronous work. Publication, cancellation, Save and Undo/Redo retain exact authored geometry and coordinate-manager/pivot behavior. Worker and display resources have explicit ownership and retirement. Plain wire remains tied to the current raw position view. Native `.hash` loading preserves saved normals and indices. The general GPU v10 importer/pose store remains separate development work.

STL import uses Float32-specific coordinate classes with guarded stock-format fallback near decimal boundaries. Both ordered crease passes, parser, axis conversion, bounds, picking, wire, transfer, cancellation and installation remain in their original order. The component stock crease function is unchanged. The private STL edge table retains full-key equality and encounter order. Typed capacity is capped at 4,194,304 slots (48 MiB of live table arrays), with exact stock Map fallback at the cap or on typed allocation failure. This is a table limit, not a bound on total import memory. When the compute budget has at least two slots, larger imports release the coordinator lease before independent BVH and wire jobs. Both crease passes remain serial and unchanged. Additional transferred index copies reserve a shared 64 MiB budget; copy pressure uses one combined BVH-then-wire worker. Small meshes and single-slot budgets retain the original serial path. Helper results, cancellation, leases and object-URL cleanup are guarded; the copy reservation does not bound total import memory.

Native accepted edge clicks prepare exact authored aliases and CM/gizmo measurements cooperatively. Current source, owner, selection, pivot and interaction guards protect publication and its later click continuation. This reduces redundant edge preparation; partial-face and very large selections can still be slow. Solid-picker changes are not part of this release.

## Portable checks

    node editor-source/tests/edge-selection/run-review.mjs
    node editor-source/tests/edge-cache/run-review.mjs
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

## r244 numeric Vertex certificate

The final r244 layer changes only numeric Vertex certificate handoff and mapped preparation. Final P/N/I, ordered selection, complete face membership and exact Float32 connectivity are revalidated; stale or declined proof retains Stock fallback. No old raw IDs, order or weld partition are assumed. The shipped r243 editor is retained solely as the pinned reconstruction input (`rebuildInputEditor`); production loads the new content-addressed editor. Native and slicer sources are unchanged.

    node editor-source/tests/numeric-vertex-certificate/certificate-controls.mjs
    node editor-source/tests/numeric-vertex-certificate/mapped-wait-controls.mjs

These 34 controls use public synthetic geometry and controlled GPU/renderer/intent transports. Actual browser acceptance and performance limits are recorded separately. Previous-publication queue wait, connectivity/wire work and the inherited artificial-retirement cleanup gap are outside this release.

## r245 warm Vertex numeric display

Warm complete/exclusive Vertex numeric translation in an unchanged ordinary owner/world/reference/unit/crease context. Cold/not-ready Vertex, Edge/Polygon, numeric Rotate/Scale, UV/soft/morph/edit-pivot and unsupported materials retain existing paths; this release adds no performance acceptance for them.

The final checked recipe rebuilds r244, replaces the eight effective last function declarations, and inserts `numeric-display-controls.mjs` before the first application statement. Production Native is explicitly pinned to the matching r245 module. Retained r243/r244 bundles are reconstruction inputs and regression oracles. Canonical authoring math/queue/history remain unchanged.

    node editor-source/tests/numeric-display/numeric-display-races.mjs
    node editor-source/tests/numeric-display/editor-adapter-races.mjs
    node editor-source/tests/numeric-display/private-packet-lifetime.mjs
    node editor-source/tests/numeric-display/private-cache-lifetime.mjs
    node --experimental-vm-modules editor-source/tests/numeric-display/native-layer-check.cjs

The 49 controls use public fixtures and mock GPU/transport; they do not establish presentation latency. Hardware receipt separately distinguishes 545 ms GPU command completion from the 2.50 s nested-rAF opportunity and leaves perceived latency unmeasured.

## r246 prepared Vertex post-Stock scheduling

The final layer reconstructs exact r245 first, then replaces only the last effective `frameAffineNumericMoveRun` through `r246-integration.json`. Old recipes/runtime inputs and retained controls remain pinned. Native remains the exact r245 module. Every eighth yielded budget cycle after Stock in prepared Vertex Move uses an ordinary timer task; the global helper, algorithms, stamps and cancellation guards are unchanged. This is a fairness change, not a hard 3 ms bound. Background timer throttling can delay hidden authoring; no general throughput or presentation guarantee is added.

    node editor-source/tests/post-stock-yield/controls.mjs

The three current-runtime scheduling controls complement the retained 49 display controls and 34 r244 controls. The source review independently exercised eight closure/drain/ownership/unit/timer-lifetime controls. HOME trusted wheel A/B, exact whole Stock/order and stale selection cancellation evidence is separate from these portable controls.
