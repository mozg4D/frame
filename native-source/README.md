# Native rendering sources

These are the exact canonical28 source modules and deterministic AST bundler for the addressed native runtime. No private performance variants or browser test imports are present.

With a development-only TypeScript installation available, run `node native-source/bundle-native.mjs <output-outside-repository>`. `FRAME_TYPESCRIPT` may point to the installed TypeScript entry. Expected result:401302 bytes, SHA2560d288f380184d240a8ab6897ba6f36dec2468340bb3aa1705695d424604f86bb. TypeScript is not a browser dependency.

The verified engineering ZIP contains the complete CPU/source/hardware oracles, receipts and package tools. See documents/R220_NATIVE_VIEWPORT.md.
