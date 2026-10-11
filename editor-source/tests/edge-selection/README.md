# Edge-selection and Coordinate Manager controls

Run with Node 22.7 or newer from a source checkout:

    node editor-source/tests/edge-selection/run-review.mjs

The suite can also be kept outside the checkout:

    node tests/run-review.mjs /path/to/frame-checkout

Alternatively, set FRAME_REVIEW_ROOT to the checkout root. The explicit command-line root takes precedence. Paths containing spaces and URL-reserved characters are supported. The installed resolver lives in support/source-paths.mjs and reads ../../../build-manifest.json, which is editor-source/build-manifest.json.

The aggregate runner writes one JSON report to stdout, exits nonzero for failures, and creates no files. It needs no install, network, browser, GPU, parser package or customer geometry. Redirect stdout yourself if you want to save a report. Individual scripts may also be run with the same optional checkout-root argument. This packaging adaptation was executed on Node 24.19.0.

## Current source bindings

- The build manifest selects the exact current editor, native runtime, edge-selection helper, edge-selection math and Three core.
- The current index.html frame-assets manifest selects its existing Three wrapper. Both wrapper and core retain the reviewed full SHA256 pins. The wrapper is imported through a generated in-memory data URL, with only its core specifier replaced by the existing core file URL. No adapter or runtime is written to disk.
- native-source/topology-islands.mjs is imported after its entire factory body is checked byte-for-byte against the SHA-pinned native runtime. Worker transfer/detachment controls use this same verified module through a tiny adapter.
- Historical editor/native inputs are reconstructed in memory by compact exact reverse-edit records. Every new-text slice is SHA256 checked, every replacement must be unique, and each reconstructed complete source must match its original full SHA256. Records contain only offsets, hashes, labels and necessary old snippets.
- source-index.json is the original frozen parser-free declaration-offset metadata, SHA256 pinned as a whole. Offsets are JavaScript UTF-16 string positions. Both original and current complete declaration lists are retained because the original source control compares all existing declarations and requires exactly eight to change. The index contains no function bodies.
- The only substantial legacy source fixture is the 18.6 KB topology oracle. Its exact contents are still compared to the reconstructed baseline factory. There are no complete old/current editor, native or Three bundles in this test directory.

Current editor SHA256: 4a5ef2cdfe5c6b0bfe062d1a7cc5970a269e855f0a1cef9df2ab2ddad5ede74b

Current native SHA256: 2e5af192ec3642b662cb54e98483b224dc6f124a68709ad0d0cfdc76b0fb0c85

## Preservation and scope

All arithmetic, worker, receipt, lifecycle, stale-continuation, boundary and additional behavioral assertion bodies remain unchanged. The four lifecycle/additional test files are entirely unchanged. Changes are limited to source-resolution/import setup, the tiny current-topology adapter, compact reversal storage and aggregate-runner diagnostics. The Three adapter spelling assertion now checks the actual existing core file URL rather than the old copied-core path. Additional source checks validate the manifest, exact source module, index checksum, declaration names and reversal slice hashes.

The original report covers math/worker controls, 99 receipt controls, 52 lifecycle controls, the original post-publication boundary probe, 35 post-publication mutation controls, 52 additional supported-state controls and 10 separately documented raw-unversioned boundary probes. Raw in-place changes without required revision/version/matrix updates remain documented limits; they are not counted as supported-state rejections.

This is synthetic source/Node review. Browser input/GPU callbacks are mocked. No natural browser reproduction, real-model latency, cold import timing, heap/peak, UI Undo/Redo, physical input or browser-worker acceptance is implied.
