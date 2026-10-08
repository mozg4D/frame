# Native rendering sources

These are the exact canonical 31 source modules and deterministic AST bundler for the addressed r224 native runtime. No private performance variants or browser test imports are present.

With a development-only TypeScript installation available, run `node native-source/bundle-native.mjs <output-outside-repository>`. `FRAME_TYPESCRIPT` may point to the installed TypeScript entry. Expected result: 439647 bytes, SHA256 634f2da7e78aae73a81d0e16fc7817cec36996040f0f2f0066a08a04ddb4603d. TypeScript is not a browser dependency.

The verified engineering ZIP contains CPU/source/hardware oracles, retained failure receipts and package tools. See [r224 worker changes and limits](../documents/R224_EXACT_SOLID_WORKER.md), [r223 Connected](../documents/R223_CONNECTED_AND_SOFT_CANCEL.md), [r222 editing](../documents/R222_EDITING_AND_SELECTION.md), [r221 printer correction](../documents/R221_PRINTER_OCCLUSION.md), and [r220 native validation](../documents/R220_NATIVE_VIEWPORT.md).

The exact-corner worker refines native numeric inputs with exact dyadic predicates. GPU admission and aggregation remain native. Raw authoring occlusion is all-triangle DoubleSide; this does not claim display-alpha/stencil parity. The one-scene cache has explicit source/vertex/triangle retention budgets; per-query GPU buffers are fresh. Heavy interaction and cold selection still have substantial latency, documented in the release evidence.
