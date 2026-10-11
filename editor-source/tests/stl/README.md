# Portable integrated STL regression suite

Install this directory as `editor-source/tests/stl` in the Frame checkout.

    node editor-source/tests/stl/run-review.mjs

The directory can also be tested before installation:

    node /path/to/tests/run-review.mjs --repository /absolute/path/to/frame

Node 20+ only. No install, network, TypeScript, Three bundle, browser or private model is required. The runner reads product source and uses real Node workers; it does not write product files, reports or private models.

## Product resolution and exact source gates

`source-loader.mjs` resolves `productionEditor`, `productionSHA256`, `productionBytes`, `stlHelper` and `stlIntegration` from the checkout's `editor-source/build-manifest.json`. The exact embedded helper is read from its source file, rather than duplicated in this test directory.

The admitted editor is 58183ac11616b64a5e67f3dde8294a7a127d26ab4efab0f1301eb2b3fdb41014. Its 6,139-byte private helper has SHA256 e81dda84936ac8a3b8b33b8c6accb9a85eb5aba6b5f516c49f0f531ea15c258a. The private helper is the reviewed 48d65be0… candidate with exports removed and only framePolygonHash renamed to frameSTLCoordinateHash. This identifier change prevents touching the existing component helper.

The loader operates on actual unnormalized product source. It verifies the helper appears exactly once, all four private names have one declaration, the real worker body differs from its frozen stock body only at two crease calls, and the real coordinator contains the exact complete serialization list. Reversing only this insertion and list change must reproduce the complete published c4de74f9… baseline hash. All minimal frozen stock functions must still occur exactly in that baseline. Private names must not remain there. This proves no hidden wrapper, rebinding or unrelated source change was admitted. Source changes beyond this release require explicit reviewed updates to the pins.

## Numerical checks

- `candidate-oracles.mjs`: stock formatter comparisons, ordered classes, exact both-pass P/N/I, argument guards and binary/ASCII parser fixtures. The fixtures and numerical assertions were retained from the source review; the unused alternate WeldBits candidate comparison was removed. There is one actual runtime implementation under test, so 180 meshes produce 360 pass comparisons, not 720 duplicated comparisons across two alternative candidates.
- `independent-oracles.mjs`: independent Float32-key proof and deterministic seeds, complete ordered xyz classes and both-pass P/N/I comparisons against the untouched stock function. Exact subunit half ties, signed zeros, subnormals, near aliases and large values are represented.
- `collision-and-negatives.mjs`: replaces only the test copy's private hash with a constant, forces collisions and growth, verifies identical ordered IDs, and tests binary/ASCII nonfinite rejection.

The fast key proof is restricted to immutable finite packed Float32 data from the current parser. Float64 uses the stock fallback. A negative nonzero value rounded to zero must remain distinct from exact +/-0. Both crease passes remain required; no reordered joins, sums or parallel normal reductions are certified.

## Actual coordinator-generated workers

`actual-worker.mjs` evaluates the exact extracted `framePrepareSTLWorker`, actual private helper, actual worker main and frozen unchanged dependencies in a controlled coordinator environment. Its Blob/URL interfaces capture the real serialized source; that exact source runs in real Node workers with the frameSTLCoordinateHash name intact. There is no identifier-normalized production copy.

A 10,082-triangle binary grid checks P/N/I, exact bounds, BVH and wire. Near-alias ASCII checks P/N/I, bounds and retained small-mesh origin arrays. The caller uses the actual STL cosine of 46 degrees. Cancellation is triggered at waiting, parsing, first crease, second crease, BVH and wire stages, with successful reimport afterward. Lease, worker and URL cleanup counts must balance. This is deterministic API/worker lifecycle coverage; it does not replace trusted browser Escape, UI interaction, install/history or physical-frame testing.

## Verified result on the provisional r237 checkout

- Published source reverse and private bindings: passed
- 2,005,785 stock scalar checks; 164 class fixtures; 180 meshes / 360 both-pass P/N/I comparisons
- 1,994,104 independent finite scalar checks; 151 class fixtures; 300 both-pass P/N/I comparisons
- Forced collision growth, four argument guards and binary/ASCII nonfinite controls: passed
- Actual binary/ASCII generated workers: exact
- Six cancellation/reimport stages: passed
- 13 acquired/released leases, 13 created/terminated workers and 13 created/revoked URLs

Numerical fixture/oracle hashes are in `fixtures/provenance.json`; the stock source license is included. No diagnostic receipts, browser harnesses, complete editor/native bundles or private test.stl are included. There is no browser or hardware-performance claim.
