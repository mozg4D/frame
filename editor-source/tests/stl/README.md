# Portable integrated STL regression suite

Install this directory as `editor-source/tests/stl` in the Frame checkout.

    node editor-source/tests/stl/run-review.mjs

The directory can also be tested before installation:

    node /path/to/tests/run-review.mjs --repository /absolute/path/to/frame

Node 20+ only. No install, network, TypeScript, Three bundle, browser or private model is required. The runner reads product source and uses real Node workers; it does not write product files, reports or private models.

## Product resolution and exact source gates

`source-loader.mjs` resolves `productionEditor`, `productionSHA256`, `productionBytes`, `stlHelper`, `stlIntegration`, `stlPostprocessHelper` and `stlPostprocessIntegration` from the checkout's `editor-source/build-manifest.json`. The exact embedded helper is read from its source file, rather than duplicated in this test directory.

The admitted r241 editor is 4a5ef2cdfe5c6b0bfe062d1a7cc5970a269e855f0a1cef9df2ab2ddad5ede74b. A compact hash-checked edge-selection reverse delta recovers the exact df08be98… STL stage for the original whole-editor oracles. Actual STL worker execution still extracts the current production functions. Its exact 9,502-byte private helper has SHA256 242096fbe092108ab3b7b3bc20a1cf3f193c2c8abb653f20ef009dd6d2aa3673. The helper is unchanged from published r238 and combines the r237 coordinate classifier with the exact edge pair table. The separate 6,267-byte postprocess runtime has SHA256 d58572698090cd8026cb67311530a228ae45625eed160e2b2fe076b8e6104ae4.

The loader first reverses the exact postprocess runtime insertion, coordinator signature/message flag and worker defer condition to published r238 SHA256 5aadcdee1557675d4b6f2b42a8d4dcd2a283f0a60407bb57e6e2e8e2881676ff. It independently applies the manifest's compact line delta and runtime token to reproduce every final editor byte. The remaining prior STL gates operate on that hash-verified reference. The loader operates on actual unnormalized product source. It verifies the helper appears exactly once, all seven private declarations are unique, the real worker body differs from its frozen stock body only at two crease calls, and the real coordinator contains the exact complete serialization list. Reversing only the consolidated insertion and list change reproduces the complete published c4de74f9… baseline hash. All minimal frozen stock functions must still occur exactly there; private names must not remain. The three coordinate functions are independently pinned to their r237 bytes. Reversing only the two declared edge-lookup substitutions in the crease function must match the original r237 crease hash. This checks unchanged threshold, arithmetic, union, normal-sum and output code without duplicating an old helper.

The exact current import coordinator, worker body and helper runtime are extracted separately for actual execution. No full current/old editor, coordinator fixture, postprocess-runtime copy or helper copy is kept in this test folder.

## Numerical checks

- `candidate-oracles.mjs`: stock formatter comparisons, ordered classes, exact both-pass P/N/I, argument guards and binary/ASCII parser fixtures. The fixtures and numerical assertions were retained from the source review; the unused alternate WeldBits candidate comparison was removed. There is one actual runtime implementation under test, so 180 meshes produce 360 pass comparisons, not 720 duplicated comparisons across two alternative candidates.
- `independent-oracles.mjs`: independent Float32-key proof and deterministic seeds, complete ordered xyz classes and both-pass P/N/I comparisons against the untouched stock function. Exact subunit half ties, signed zeros, subnormals, near aliases and large values are represented.
- `collision-and-negatives.mjs`: replaces only the test copy's private hash with a constant, forces collisions and growth, verifies identical ordered IDs, and tests binary/ASCII nonfinite rejection.

- `edge-oracles.mjs` and `edge-fixtures.mjs`: evaluate the actual manifest-selected table, using narrowly anchored in-memory test instrumentation. Nineteen fixtures cover head zero, directed endpoints, degenerate and tiny-area aliases, nonmanifold older neighbors and transitive joins, high-valence fans, signed zero, threshold boundaries and collision growth/fallback. Across both passes and three configurations, 114 exact P/N/I comparisons and 114 complete lookup/head/pair/join/parent/next trace comparisons pass. All six initial/grow allocation failure points fall back without losing heads. Two non-allocation errors propagate correctly. BigInt verifies the packed-number boundary; separate table-only cases cover full uint32 IDs, string fallback and signed Int32 corner limits without allocating huge geometry. Production capacity arithmetic is checked independently.

The fast key proof is restricted to immutable finite packed Float32 data from the current parser. Float64 uses the stock fallback. A negative nonzero value rounded to zero must remain distinct from exact +/-0. Both crease passes remain required; no reordered joins, sums or parallel normal reductions are certified.

## Actual coordinator-generated workers

`actual-worker.mjs` evaluates the exact extracted `framePrepareSTLCoordinator`, actual postprocess runtime/new `framePrepareSTLWorker`, private helper, worker main and frozen unchanged dependencies in a controlled coordinator environment. Its Blob/URL interfaces capture the real serialized source; that exact source runs in real Node workers with the frameSTLCoordinateHash name intact. Every coordinator and BVH/wire helper Blob must exactly equal its complete reviewed dependency closure and worker body before its bytes execute. There is no identifier-normalized production copy.

A 10,082-triangle binary grid checks P/N/I, exact bounds, BVH and wire. Near-alias ASCII checks P/N/I, bounds and retained small-mesh origin arrays. Two additional tiny-area ASCII cases exercise signed rounded zero after STL rotation and the 2→3-vertex first/second-pass alias case through that same real coordinator. The caller uses the actual STL cosine of 46 degrees. Cancellation is triggered at waiting, parsing, first crease, second crease, BVH and wire stages, with successful reimport afterward. Lease, worker and URL cleanup counts must balance. This is deterministic API/worker lifecycle coverage; it does not replace trusted browser Escape, UI interaction, install/history or physical-frame testing.

## Verified result on the current checkout

- Published source reverse and private bindings: passed
- 2,005,785 stock scalar checks; 164 class fixtures; 180 meshes / 360 both-pass P/N/I comparisons
- 1,994,104 independent finite scalar checks; 151 class fixtures; 300 both-pass P/N/I comparisons
- Forced collision growth, four argument guards and binary/ASCII nonfinite controls: passed
- Edge tables: 19 fixtures / 114 P/N/I comparisons / 114 traces; six allocation failures and two non-allocation errors passed
- Actual binary/ASCII generated workers and two alias cases: exact
- Six cancellation/reimport stages: passed
- 30 acquired/released leases, 29 created/terminated workers and 29 created/revoked URLs (one cancelled admission creates no worker)

Numerical fixture/oracle hashes are in `fixtures/provenance.json`; the stock source license is included. No diagnostic receipts, browser harnesses, complete editor/native bundles or private test.stl are included. There is no browser or hardware-performance claim.

## Memory and performance boundaries

The production table starts at an estimate from face count, capped at 4,194,304 buckets (48 MiB across its three arrays). A grow step retains old plus new typed arrays, at most 72 MiB for those arrays. Map fallback does not cap total memory, and catching RangeError cannot promise process-OOM recovery. Constructor overrides and stats are private implementation/test facilities; the actual production crease call supplies only its initial capacity. The guarded parallel postprocess runtime is included only through manifest-resolved product source. This suite establishes source, numeric and lifecycle contracts, not Chrome timing or process/GPU memory.

## Final postprocess protocol and proof

`postprocess-source.mjs` resolves unchanged dependencies from actual source and the existing stock oracle. It derives the old serial reference from the verified exact r238 reverse, and derives the final coordinator/runtime directly from the manifest-selected editor. It also checks the unchanged shared-budget factory. Both normal and fault-test workers verify their raw generated Blob bytes against one of these exact closures before execution; only the browser/Node Worker API bridge is substituted.

- `postprocess-contracts.mjs`: 21 cases / 156 assertions, retaining the supplied numerical, transfer, copy-pressure, single-permit, concurrent-import, cancellation/error/stale/corrupt/unreadable/duplicate and malformed-response checks.
- `postprocess-independent.mjs`: six cases / 50 assertions covering Uint32 wire immediately below/above the sorting cutoff, binary/ASCII, both helper permits queued then cancelled, and constructor/postMessage failures. Original numerical and ownership assertions are retained; only source resolution and actual closure verification were adapted.
- `postprocess-malformed.mjs`: six endpoint controls / 51 assertions for null, undefined, primitive, array, Error-throwing property validation and late null after success. Every case settles once and releases worker/URL/lease without manual cancellation.
- `postprocess-falsy-negative.mjs`: five explicitly known-gap controls. A synthetic getter throwing undefined/null/0/false/empty string reaches the inherited truthiness-based finish(error), resolves undefined, and cleans up once. The wrapper later rejects missing geometry; it can await the sibling first. These getters cannot arrive through ordinary Worker structured cloning. The report labels reproduction as knownGapReproduced and acceptancePass:false. Overall suite success means this caveat was reproduced as documented, not that universal validation-exception rejection is guaranteed.

Both crease passes, exact P/N/I, face/join/sum order and all BVH/wire algorithms remain unchanged. BVH and wire consume the same final geometry in separate helpers; BVH receives original P/I and returns them, while wire receives one index copy and point count. No helper mutates the other's input. Successful outputs are compared to the serial reference and original stock numeric oracles, including bounds/origin, BVH preorder/order arrays and wire ordering.

The coordinator terminates/releases before helper admission; each helper obtains the unchanged shared native permit. The 64 MiB counter reserves additional index-copy ownership synchronously across imports in this editor realm. Pressure/oversize uses one combined helper without this copy. Cancellation/failure aborts siblings, awaits settlement and releases the reservation. This cap does not cover all arrays, GC-retired storage, GPU allocations or process RSS. The inherited coordinator handler is outside the new malformed-helper guarantee, and helper-result checks are structural rather than a proof against arbitrary semantic corruption.

The suite makes no Chrome performance, memory-reduction, physical CPU-core or GPU claim. Browser evidence, including the measured memory tradeoff, remains separate from these source and Node gates.
