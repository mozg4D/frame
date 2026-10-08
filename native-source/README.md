# Native rendering sources

These are the exact canonical 31 source modules and deterministic AST bundler for the addressed r222 native runtime. No private performance variants or browser test imports are present.

With a development-only TypeScript installation available, run `node native-source/bundle-native.mjs <output-outside-repository>`. `FRAME_TYPESCRIPT` may point to the installed TypeScript entry. Expected result: 435992 bytes, SHA256 29e96e091a1f485ceb06627d86509c5a39a6fe18cbc2418124c04dd710472559. TypeScript is not a browser dependency.

The verified engineering ZIP contains CPU/source/hardware oracles, retained failure receipts and package tools. See [r222 changes and limits](../documents/R222_EDITING_AND_SELECTION.md), [r221 printer correction](../documents/R221_PRINTER_OCCLUSION.md), and [r220 native validation](../documents/R220_NATIVE_VIEWPORT.md).

The exact-corner worker refines native numeric inputs with exact dyadic predicates. GPU admission and aggregation remain native. Raw authoring occlusion is all-triangle DoubleSide; this does not claim display-alpha/stencil parity. The one-scene cache has explicit source/vertex/triangle retention budgets; per-query GPU buffers are fresh. Heavy interaction and cold selection still have substantial latency, documented in the release evidence.
