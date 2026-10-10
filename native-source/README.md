# Native viewport sources

The 33 source modules in this directory and `bundle-native.mjs` produce the native viewport bundle used by r232 rigid component preview:

`modules/native.971568c756454593010d.js`

## Rebuild

Requirements: Node 20+ and TypeScript 5.9.3 (the pinned build version). Set `FRAME_TYPESCRIPT` to the installed `lib/typescript.js` entry if TypeScript is not available to Node's module resolver.

From the repository root, write the bundle to a temporary file outside the checkout:

    node native-source/bundle-native.mjs /absolute/path/outside/frame/native.js

Expected output: 498,823 bytes, SHA256 `971568c756454593010d3afe51a9beaa0a2b811de43d6596f5e7096367afa0b9`. TypeScript is a build-time dependency only. The command builds this native bundle; it does not rebuild or publish the whole application.

Mip generation is selected by fresh native/actual GL controls for the current GPU owner generation. Production and calibration share gpu-mipmap.mjs; the baseline bilinear profile is preferred when it passes. The measured area profile integrates odd-dimension footprints in linear RGB and writes each mip to an sRGB8 target. The .008 control tolerance, exact base uploads, default source texture settings, implicit LOD and POT/NPOT color/bump gates remain enforced. Loss/Retry repeats calibration for the new device generation.

## Boundaries

WebGPU owns display and selection. The exact-corner worker refines geometric decisions with exact dyadic predicates. Raw authoring occlusion uses all-triangle DoubleSide geometry; it does not imply display-alpha or stencil parity. Capability checks and resource limits remain explicit, and heavy interactions still have latency.

Keep authored precision and source identity intact; see [numeric rules](../docs/NUMERIC_PRECISION.md). Unfinished GPU authoring changes live separately in [development/gpu-v10/](../development/gpu-v10/).

The r229 startup calibration keeps both fresh mip-generation attempts and every POT/NPOT, implicit-LOD, 1x/4x color/bump control. One exact owner/device/generation session retains the GL renderer and separate hooked case materials, selected mip resources, and cubic pipelines until its final cleanup. Aligned staging buffers batch mip and cubic readbacks; cubic commands use distinct vertex/uniform buffers per case. Receipts, tolerance, shader pins and production freshness checks are unchanged. Recorded desktop timings do not establish Redmi startup performance.

Connected background workers opt into exact packed coordinate/edge tables with stable numeric radix ordering. The legacy generator stays available; all result arrays preserve its IDs and encounter order. The worker Blob includes its MessageChannel task dependency. Main-thread topology snapshots and worker slices use owned task queues, closed on disposal; explicit injected yieldTask remains supported. No authored welding, GPU v10 activation, selection policy or geometry transform change is included.

## Portable Connected checks

Run from the repository root with Node 20 or newer:

    node native-source/tests/portable-connected-contracts.mjs
    node native-source/tests/connected-cache-lifecycle.mjs

The tests compare all 21 output arrays from the unchanged legacy generator with packed tables, exercise real Node workers and superseding cancellation, and check owned queue/lease cleanup. They use synthetic geometry, write no result files and make no browser or hardware acceptance claim.

The current rigid preview adapter is `gpu-island-preview.mjs`. It shares display/pick storage, checks ownership and retires temporary resources on failures. Its editor transactions and portable checks are in [editor-source/](../editor-source/). CPU authoring arrays remain authoritative at release.
