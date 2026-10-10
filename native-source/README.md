# Native viewport sources

The 31 source modules in this directory and `bundle-native.mjs` produce the native viewport bundle used by the current r226 application:

`modules/native.634f2da7e78aae73a81d.js`

## Rebuild

Requirements: Node.js and a development TypeScript installation. Set `FRAME_TYPESCRIPT` to the installed `lib/typescript.js` entry if TypeScript is not available to Node's module resolver.

From the repository root, write the bundle to a temporary file outside the checkout:

    node native-source/bundle-native.mjs /absolute/path/outside/frame/native.js

Expected output: 439,647 bytes, SHA256 `634f2da7e78aae73a81d0e16fc7817cec36996040f0f2f0066a08a04ddb4603d`. TypeScript is a build-time dependency only. The command builds this native bundle; it does not rebuild or publish the whole application.

## Boundaries

WebGPU owns display and selection. The exact-corner worker refines geometric decisions with exact dyadic predicates. Raw authoring occlusion uses all-triangle DoubleSide geometry; it does not imply display-alpha or stencil parity. Capability checks and resource limits remain explicit, and heavy interactions still have latency.

Keep authored precision and source identity intact; see [numeric rules](../docs/NUMERIC_PRECISION.md). Unfinished GPU authoring changes live separately in [development/gpu-v10/](../development/gpu-v10/).
