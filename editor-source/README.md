# Current editor source

This is the r232 rigid component preview implementation and deterministic editor integration. The shipped editor remains the complete application source. A small hash-checked extraction delta restores the pinned integration base from that file, avoiding another bundled editor copy.

Requirements: Node 20+ and TypeScript 5.9.3. Set `FRAME_TYPESCRIPT` to its `lib/typescript.js` path when needed.

    node editor-source/rebuild.mjs /absolute/path/outside/frame/editor.mjs

The output path must be new and outside the checkout. Unchanged sources reproduce 2,639,935 bytes, SHA256 `9023e8f31bf6a28d5b4bde858b53741f235e810dc9d3de431352d3c1e7aba0ff`. Native source has its own [rebuild instructions](../native-source/). The command does not update the asset manifest or deploy.

## Scope

The fast path covers eligible indexed whole-island World Move/Rotate. It commits exact CPU arrays and sparse history, pins owner/source/context/selection state, and rejects reuse after logical alias splits, merges or outside contacts. Unsupported paths keep stock CPU behavior. Live bounds use GPU Float32 arithmetic; committed coordinates use the authoring result. Selection recomputation can still make release slow. The general GPU v10 importer and pose store remain separate development work.

## Portable checks

    node editor-source/tests/alias-guards.mjs
    node editor-source/tests/guards.mjs
    node editor-source/tests/lifecycle.mjs
    node editor-source/tests/hash-loader.mjs
    node native-source/tests/rigid-resource-lifetime.mjs

These synthetic CPU/source checks cover exact alias rules, source/context guards, ordered cancellation and exception-safe history, generated legacy loader dependencies, saved normal/index preservation and GPU API resource cleanup with mocks. They do not claim browser, device or full-workflow acceptance. No private fixtures, browser scripts, receipts, historical snapshots or dependencies are bundled.
