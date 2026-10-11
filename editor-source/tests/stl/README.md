# Portable integrated STL regression suite

Install this directory as `editor-source/tests/stl` in the Frame checkout.

    node editor-source/tests/stl/run-review.mjs

The directory can also be tested before installation:

    node /path/to/tests/run-review.mjs --repository /absolute/path/to/frame

Node 20+ only. No install, network, TypeScript, Three bundle, browser or private model is required. The runner reads product source and uses real Node workers; it does not write product files, reports or private models.

## Product resolution and exact source gates

`source-loader.mjs` resolves `productionEditor`, `productionSHA256`, `productionBytes`, `stlHelper` and `stlIntegration` from the checkout's `editor-source/build-manifest.json`. The exact embedded helper is read from its source file, rather than duplicated in this test directory.

The admitted r238 editor is 5aadcdee1557675d4b6f2b42a8d4dcd2a283f0a60407bb57e6e2e8e2881676ff. Its exact 9,502-byte private helper has SHA256 242096fbe092108ab3b7b3bc20a1cf3f193c2c8abb653f20ef009dd6d2aa3673. The helper combines the unchanged r237 coordinate classifier with the typed edge pair table.

The loader operates on actual unnormalized product source. It verifies the helper appears exactly once, all seven private declarations are unique, the real worker body differs from its frozen stock body only at two crease calls, and the real coordinator contains the exact complete serialization list. Reversing only the consolidated insertion and list change reproduces the complete published c4de74f9… baseline hash. All minimal frozen stock functions must still occur exactly there; private names must not remain. The three coordinate functions are independently pinned to their r237 bytes. Reversing only the two declared edge-lookup substitutions in the crease function must match the original r237 crease hash. This checks unchanged threshold, arithmetic, union, normal-sum and output code without duplicating an old helper.

The original measured candidate a30d80aa9cee995e79daa74b686f8bff3e8d01a191c64847e3edde5e1d411343 differs from the admitted final editor only in two comment lines. This relation was independently verified during review; final helper/editor hashes above govern the portable gate. No executable behavior or test override was changed by that comment cleanup.

## Numerical checks

- `candidate-oracles.mjs`: stock formatter comparisons, ordered classes, exact both-pass P/N/I, argument guards and binary/ASCII parser fixtures. The fixtures and numerical assertions were retained from the source review; the unused alternate WeldBits candidate comparison was removed. There is one actual runtime implementation under test, so 180 meshes produce 360 pass comparisons, not 720 duplicated comparisons across two alternative candidates.
- `independent-oracles.mjs`: independent Float32-key proof and deterministic seeds, complete ordered xyz classes and both-pass P/N/I comparisons against the untouched stock function. Exact subunit half ties, signed zeros, subnormals, near aliases and large values are represented.
- `collision-and-negatives.mjs`: replaces only the test copy's private hash with a constant, forces collisions and growth, verifies identical ordered IDs, and tests binary/ASCII nonfinite rejection.

- `edge-oracles.mjs` and `edge-fixtures.mjs`: evaluate the actual manifest-selected table, using narrowly anchored in-memory test instrumentation. Nineteen fixtures cover head zero, directed endpoints, degenerate and tiny-area aliases, nonmanifold older neighbors and transitive joins, high-valence fans, signed zero, threshold boundaries and collision growth/fallback. Across both passes and three configurations, 114 exact P/N/I comparisons and 114 complete lookup/head/pair/join/parent/next trace comparisons pass. All six initial/grow allocation failure points fall back without losing heads. Two non-allocation errors propagate correctly. BigInt verifies the packed-number boundary; separate table-only cases cover full uint32 IDs, string fallback and signed Int32 corner limits without allocating huge geometry. Production capacity arithmetic is checked independently.

The fast key proof is restricted to immutable finite packed Float32 data from the current parser. Float64 uses the stock fallback. A negative nonzero value rounded to zero must remain distinct from exact +/-0. Both crease passes remain required; no reordered joins, sums or parallel normal reductions are certified.

## Actual coordinator-generated workers

`actual-worker.mjs` evaluates the exact extracted `framePrepareSTLWorker`, actual private helper, actual worker main and frozen unchanged dependencies in a controlled coordinator environment. Its Blob/URL interfaces capture the real serialized source; that exact source runs in real Node workers with the frameSTLCoordinateHash name intact. Every generated Blob must exactly equal the full reviewed dependency closure and worker body before its bytes execute. There is no identifier-normalized production copy.

A 10,082-triangle binary grid checks P/N/I, exact bounds, BVH and wire. Near-alias ASCII checks P/N/I, bounds and retained small-mesh origin arrays. Two additional tiny-area ASCII cases exercise signed rounded zero after STL rotation and the 2→3-vertex first/second-pass alias case through that same real coordinator. The caller uses the actual STL cosine of 46 degrees. Cancellation is triggered at waiting, parsing, first crease, second crease, BVH and wire stages, with successful reimport afterward. Lease, worker and URL cleanup counts must balance. This is deterministic API/worker lifecycle coverage; it does not replace trusted browser Escape, UI interaction, install/history or physical-frame testing.

## Verified result on the final r238 checkout

- Published source reverse and private bindings: passed
- 2,005,785 stock scalar checks; 164 class fixtures; 180 meshes / 360 both-pass P/N/I comparisons
- 1,994,104 independent finite scalar checks; 151 class fixtures; 300 both-pass P/N/I comparisons
- Forced collision growth, four argument guards and binary/ASCII nonfinite controls: passed
- Edge tables: 19 fixtures / 114 P/N/I comparisons / 114 traces; six allocation failures and two non-allocation errors passed
- Actual binary/ASCII generated workers and two alias cases: exact
- Six cancellation/reimport stages: passed
- 15 acquired/released leases, 15 created/terminated workers and 15 created/revoked URLs

Numerical fixture/oracle hashes are in `fixtures/provenance.json`; the stock source license is included. No diagnostic receipts, browser harnesses, complete editor/native bundles or private test.stl are included. There is no browser or hardware-performance claim.

## Memory and performance boundaries

The production table starts at an estimate from face count, capped at 4,194,304 buckets (48 MiB across its three arrays). A grow step retains old plus new typed arrays, at most 72 MiB for those arrays. Map fallback does not cap total memory, and catching RangeError cannot promise process-OOM recovery. Constructor overrides and stats are private implementation/test facilities; the actual production crease call supplies only its initial capacity. No postprocess parallel prototype is included. This suite establishes source, numeric and lifecycle contracts, not Chrome timing or process/GPU memory.
