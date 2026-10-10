# Native viewport sources

The 32 source modules in this directory and `bundle-native.mjs` produce the native viewport bundle used by the current r228 application:

`modules/native.c8d821f1cd358ff0a32e.js`

## Rebuild

Requirements: Node.js and a development TypeScript installation. Set `FRAME_TYPESCRIPT` to the installed `lib/typescript.js` entry if TypeScript is not available to Node's module resolver.

From the repository root, write the bundle to a temporary file outside the checkout:

    node native-source/bundle-native.mjs /absolute/path/outside/frame/native.js

Expected output: 454,556 bytes, SHA256 `c8d821f1cd358ff0a32edb8b4ee0306094f7e4c9bd7ceb50acee03561f474664`. TypeScript is a build-time dependency only. The command builds this native bundle; it does not rebuild or publish the whole application.

Mip generation is selected by fresh native/actual GL controls for the current GPU owner generation. Production and calibration share gpu-mipmap.mjs; the baseline bilinear profile is preferred when it passes. The measured area profile integrates odd-dimension footprints in linear RGB and writes each mip to an sRGB8 target. The .008 control tolerance, exact base uploads, default source texture settings, implicit LOD and POT/NPOT color/bump gates remain enforced. Loss/Retry repeats calibration for the new device generation.

## Boundaries

WebGPU owns display and selection. The exact-corner worker refines geometric decisions with exact dyadic predicates. Raw authoring occlusion uses all-triangle DoubleSide geometry; it does not imply display-alpha or stencil parity. Capability checks and resource limits remain explicit, and heavy interactions still have latency.

Keep authored precision and source identity intact; see [numeric rules](../docs/NUMERIC_PRECISION.md). Unfinished GPU authoring changes live separately in [development/gpu-v10/](../development/gpu-v10/).

The r229 startup calibration keeps both fresh mip-generation attempts and every POT/NPOT, implicit-LOD, 1x/4x color/bump control. One exact owner/device/generation session retains the GL renderer and separate hooked case materials, selected mip resources, and cubic pipelines until its final cleanup. Aligned staging buffers batch mip and cubic readbacks; cubic commands use distinct vertex/uniform buffers per case. Receipts, tolerance, shader pins and production freshness checks are unchanged. HOME timings are desktop measurements, not a Redmi startup claim.
