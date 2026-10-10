# Current editor source

This is the r233 rigid component preview implementation and deterministic editor integration. The shipped editor remains the complete application source. A small hash-checked extraction delta restores the pinned integration base from that file, avoiding another bundled editor copy.

Requirements: Node 20+ and TypeScript 5.9.3. Set `FRAME_TYPESCRIPT` to its `lib/typescript.js` path when needed.

    node editor-source/rebuild.mjs /absolute/path/outside/frame/editor.mjs

The output path must be new and outside the checkout. Unchanged sources reproduce 2,643,821 bytes, SHA256 `327a5cd2d878844c49ca80bbd9a5e8f23390f6c06f3290bac01675bcf64efbd6`. Native source has its own [rebuild instructions](../native-source/). The command does not update the asset manifest or deploy.

## Scope

The fast path covers eligible indexed whole-island World Move/Rotate and Object-coordinate Move. It commits exact CPU arrays and sparse history, pins owner/source/context/selection state, and rejects outside contacts. Exact shared-edge connectivity permits reuse across internal quantization changes only when every bound raw vertex occurs in the selected faces; otherwise strict alias partition checks remain. Object Rotate, Scale, nonuniform-owner and other unsupported paths keep stock CPU behavior. Live bounds use GPU Float32 arithmetic; committed coordinates use the authoring result. Selection recomputation can still make release slow. The general GPU v10 importer and pose store remain separate development work.

## Portable checks

    node editor-source/tests/alias-guards.mjs
    node editor-source/tests/stable-face-proof.mjs
    node editor-source/tests/guards.mjs
    node editor-source/tests/lifecycle.mjs
    node editor-source/tests/hash-loader.mjs
    node native-source/tests/rigid-resource-lifetime.mjs

These synthetic CPU/source checks cover exact alias rules, source/context guards, ordered cancellation and exception-safe history, generated legacy loader dependencies, saved normal/index preservation and GPU API resource cleanup with mocks. They do not claim browser, device or full-workflow acceptance. No private fixtures, browser scripts, receipts, historical snapshots or dependencies are bundled.
