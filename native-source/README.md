# Native rendering sources

These are the exact canonical28 source modules and deterministic AST bundler for the addressed native runtime. No private performance variants or browser test imports are present.

With a development-only TypeScript installation available, run `node native-source/bundle-native.mjs <output-outside-repository>`. `FRAME_TYPESCRIPT` may point to the installed TypeScript entry. Expected result:401302 bytes, SHA25650cf866dca7c5fbec7f3b7b0a32b3054d39933f30c56cf6f2bd6b0b0857c30b1. TypeScript is not a browser dependency.

The verified engineering ZIP contains the complete CPU/source/hardware oracles, receipts and package tools. See documents/R220_NATIVE_VIEWPORT.md.

Only gpu-display.mjs opaque/transparent phase ordering changes in r221; all native shaders and the28-module ABI remain unchanged. See ../documents/R221_PRINTER_OCCLUSION.md.
