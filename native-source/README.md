# Native rendering sources

These are the exact canonical 31 source modules and deterministic AST bundler for the addressed r223 native runtime. No private performance variants or browser test imports are present.

With a development-only TypeScript installation available, run `node native-source/bundle-native.mjs <output-outside-repository>`. `FRAME_TYPESCRIPT` may point to the installed TypeScript entry. Expected result: 436314 bytes, SHA256 00f75b25a59b10d334d72288e2ff33ca987e44b094c2714745b3203e622e9f55. TypeScript is not a browser dependency.

The verified engineering ZIP contains CPU/source/hardware oracles, retained failure receipts and package tools. See [r223 changes and limits](../documents/R223_CONNECTED_AND_SOFT_CANCEL.md), [r222 editing](../documents/R222_EDITING_AND_SELECTION.md), [r221 printer correction](../documents/R221_PRINTER_OCCLUSION.md), and [r220 native validation](../documents/R220_NATIVE_VIEWPORT.md).

The exact-corner worker refines native numeric inputs with exact dyadic predicates. GPU admission and aggregation remain native. Raw authoring occlusion is all-triangle DoubleSide; this does not claim display-alpha/stencil parity. The one-scene cache has explicit source/vertex/triangle retention budgets; per-query GPU buffers are fresh. Heavy interaction and cold selection still have substantial latency, documented in the release evidence.
