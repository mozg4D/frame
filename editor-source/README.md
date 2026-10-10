# Current editor source

This is the r235 rigid component preview implementation and deterministic editor integration. The shipped editor remains the complete application source. A small hash-checked extraction delta restores the pinned integration base from that file, avoiding another bundled editor copy.

Requirements: Node 20+ and TypeScript 5.9.3. Set `FRAME_TYPESCRIPT` to its `lib/typescript.js` path when needed.

    node editor-source/rebuild.mjs /absolute/path/outside/frame/editor.mjs

The output path must be new and outside the checkout. Unchanged sources reproduce 2,652,531 bytes, SHA256 `e333dd2896489bc928cf9e984bbbda42a5ec4e9dd5992622dc03805199a3682a`. Native source has its own [rebuild instructions](../native-source/). The command does not update the asset manifest or deploy.

## Scope

The fast path covers eligible indexed whole-island World Move/Rotate and Object-coordinate Move. It commits exact CPU arrays and sparse history, pins owner/source/context/selection state, and rejects outside contacts. Exact shared-edge connectivity permits reuse across internal quantization changes only when every bound raw vertex occurs in the selected faces; otherwise strict alias partition checks remain. Object Rotate, Scale, nonuniform-owner and other unsupported paths keep stock CPU behavior. Live bounds use GPU Float32 arithmetic; committed coordinates use the authoring result. Derived selection buffers and measurements run cooperatively after the committed history entry, with frozen committed views and guarded publication. New gestures and history cancel stale work. Undo/Redo restores overlay attributes, bounds, gizmo and Coordinate Manager frame synchronously. Sparse authoring commits and tight bounds still require synchronous release work. The general GPU v10 importer and pose store remain separate development work.

Plain wire shares the live position attribute, including the active GPU preview. Sparse geometry writes clear position-dependent topology caches. Marquee and tap use one latched 6-pixel threshold. The service worker verifies full asset hashes, updates at navigation boundaries and retains older caches for fallback; it never reloads an open scene.

## Portable checks

    node editor-source/tests/alias-guards.mjs
    node editor-source/tests/stable-face-proof.mjs
    node editor-source/tests/guards.mjs
    node editor-source/tests/lifecycle.mjs
    node editor-source/tests/derived-lifecycle.mjs
    node editor-source/tests/hash-loader.mjs
    node editor-source/tests/wire-gestures.mjs
    node editor-source/tests/service-worker.mjs
    node native-source/tests/rigid-resource-lifetime.mjs

These synthetic CPU/source checks cover exact alias rules, source/context guards, ordered cancellation and exception-safe history, generated legacy loader dependencies, saved normal/index preservation and GPU API resource cleanup with mocks. They do not claim browser, device or full-workflow acceptance. No private fixtures, browser scripts, receipts, historical snapshots or dependencies are bundled.
