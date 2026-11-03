# GPU Unite: surface preparation and validation

`Unite` is available in the object and polygon-component context menus. It also has the validated automation command `geometry.unite {ids?,selectedIslands?,fillRule?}`. Explicit IDs default to whole objects; the component menu expands selected vertex/edge/polygon seeds to complete exact-position-connected islands. Unselected islands pass through. One native transaction retains hierarchy frames, materials, interpolated UV corners, Undo/Redo and ordinary HASH polygon storage. Original input files are never overwritten.

The common plugin API is `context.scene.prepareVolume(snapshot, options)`, where `snapshot` is a current `context.scene.capture(ownerHash, [])` belonging to that plugin. It returns disposable positions/indices on the shared GPU device, counts, source-face provenance and a diagnostic report. It does not create an editor object. The native transaction consumes the same implementation. Printer exposes `prepare-volume` and `slice {prepareVolume:true}`; its normal sampled Slice remains available.

## Material rules

Input normals are ignored. Exact duplicate triangles within an occurrence are idempotent. Exact Float32 vertex equality determines source connectivity; there is no distance weld that can erase a thin wall. Local orientation is repaired across manifold edges. A globally reversed closed shell has the same interior. A nonorientable cycle rejects the operation.

For an already conforming nonmanifold face complex, bounded angular sectors around edges can recover closed volume cells. This handles a shared internal face stored once or in duplicate between adjacent bodies. Unused sheets remain subject to the two-sided interior check. An ambiguous radial order or a complex requiring unresolved intersection cuts does not receive an invented closure. Filling rules operate on the recovered closed cells; historical body membership cannot be inferred from a single unordered face complex. Keep bodies as separate occurrences when that distinction must survive global even-odd filling. Recovery currently accepts at most 500,000 source faces.

* `nested-union` is the default. One connected orientable shell uses nonzero signed crossing count, retaining self-overlap material. Intersecting shells of one occurrence form union clusters; distinct nested clusters alternate material/void. Separate occurrences unite. Thus an inner shell in the same object describes a cavity, while a separate contained object adds solid material. Positive-area coplanar overlaps participate in clustering.
* `union` fills the nonzero interior of every shell and combines all shells with OR, including contained shells.
* `even-odd` toggles all closed shells globally, using crossing parity inside a self-intersecting shell. Overlapping occurrences therefore produce symmetric difference, and two identical separate solids cancel. This explicit rule differs from the default occurrence union.

An open sheet contributes no invented solid interior. It is removed only when every arranged patch has closed material on both sides. An external/protruding open sheet or damaged exterior shell rejects atomically. Hole reconstruction is not implemented. Balanced four-face edges can be legitimate contact singularities, for example the touching lobes of a parity-filled bowtie; edge incidence is reported rather than silently perturbed into a manifold.

## Chosen implementation

The pipeline uses GPU source transformation, a conservative triangle BVH broad phase, exact bounded integer projected predicates for common contacts, and parallel two-sided membership queries. A transient worker exact-welds and orients sources, resolves uncertain dyadic predicate signs, recovers conforming cells when possible, constructs intersection arrangements, splits constrained faces, labels connected patches and assembles the result. Shared edges between shells remain classification seams even when no new cut vertex is needed. Only representative patches are classified; a clean shell needs one query rather than one query per triangle. Float64 side queries resolve numerically unsafe GPU cases. New intersection vertices receive a bounded Float32 lattice embedding when direct rounding would collapse or reverse a selected facet; authored source vertices stay pinned and displacement is reported. Final Float32 edge incidence and orientation are checked before publication.

Power-of-two normalization must preserve captured Float32 coordinates without subnormal arithmetic. A normalized source-triangle altitude below 128 times the solid-side numerical guard rejects. Tiny normals keep their GPU AABB pairs for the worker rather than losing intersections to squared-normal underflow. Distinct cut endpoints below arrangement resolution reject. Output edge conformity uses exact collinearity, without the older Boolean's proximity fallback.

GPU BVH, triangle-box, plane and projected-distance filtering retain the same 1.1e-6 near-surface band, covering the worker's 1e-6 clearance test. This prevents a rounded side probe from crossing a wall discarded by broad-phase filtering. Bounded empty outputs also receive an independent Float64 recheck. The 1..32-ULP hollow-box sweep requires both shells, exact captured coordinates and positive analytic cavity volume, including the formerly empty seven-ULP case.

The Float32 repair is a bounded greedy/local search, not an exhaustive feasibility solver. Its failed-embedding diagnostic reports failure of that search within the two-ULP window; it does not prove that no other embedding or rational-coordinate output exists.

This is a GPU-assisted surface arrangement with a CPU topology stage. It is not a fully GPU-resident Boolean or an exact rational-coordinate implementation. Completed time includes source capture/readback, worker startup and geometry, GPU synchronization, output upload and native editor publication. No SDF, full-volume voxel representation or physical solver is introduced.

| Alternative | Useful property | Assessment for this task |
| --- | --- | --- |
| Connected components / union-find | Shell and patch labels; unchanged regions avoid repeated classification | Connectivity alone cannot cut triangles or remove intersecting internal faces. |
| Multiple-axis LDI/LDNI | Fast parallel projection, interval operations, compact Printer input | Finite ray grids can miss thin/oblique detail. Reconstructing a complete 3D polygon boundary is additional work. |
| Direct intersections and arrangement | Keeps source polygons and explicit intersection curves; no sampling pitch | Robust coplanar contacts and consistent output embedding dominate difficult inputs; actual intersections can be quadratic. |
| Adaptive source-backed reconstruction | Can concentrate new geometry near intersections | Requires feature-preserving refinement and consistent transitions. Sample-only stopping rules cannot establish source topology. Not implemented as a competing runtime here. |
| CPU/WASM manifold kernel | A separate robust topology implementation with face provenance and tolerance | Pinned Manifold 3.5.4 is an optional research comparison. Its kernel status and native Float32 geometry require separate checks; it is not an application dependency or automatic fallback. |
| Implemented hybrid | GPU search/classification plus existing constrained topology machinery | Avoids a full fine grid, preserves unchanged source regions and exposes bounded numerical failures. |

The architecture follows the separation of arrangements and cell labels in [Mesh Arrangements for Solid Geometry](https://www.cs.columbia.edu/cg/mesh-arrangements/). [LDNI solid modeling](https://mewangcl.github.io/pubs/CADGPUModeler.pdf) provides the relevant GPU sampled alternative. [Hybrid Booleans](https://www.graphics.rwth-aachen.de/publication/0338/) motivates preserving original polygons outside refined intersection regions. [Interactive and Robust Mesh Booleans](https://arxiv.org/abs/2205.14151) demonstrates the importance of consistent numerical intersection decisions. These papers are references for the comparison; no published throughput is presented as a Frame measurement.

## Reproducible checks

```powershell
npm run test:unite -- --headless
npm run test:unite:cells
npm run test:unite:performance -- --headless
npm run test:unite:integration -- --headless
node plugins/3d-printer/tests/volume-preparation.mjs --headless
npm run test:unite:ldi -- --headless
npm run test:unite:corpus -- --headless
npm test -- --headless
npm run test:stress -- --headless
```

The focused fixtures independently check exact native edge incidence, analytic volume, oriented boundary sides and oblique-ray occupancy. They cover duplicates, exploded vertices, random winding, nested cavities/islands, occurrence ownership, coplanar partial contacts, near coincidence, self-crossing and multiply covered shells, three-way overlap, oblique rotations, shared-edge tetrahedra, and adjacent cells with a single internal divider. Shared-edge union volume is independently 5/3 and its symmetric difference is 4/3. UI checks cover menu events, complete selected islands, untouched geometry, mirrored owners, materials/UV, HASH and exact Undo/Redo. Open-input and numerical rejection checks require unchanged source arrays, including an external sheet attached to a recovered cell complex. Tiny intersecting/disconnected solids, far translated coordinates and normalization underflow have separate regressions.

`unite-cells.mjs` independently clips 2D triangle sections to audit 94 shared-edge tetrahedral configurations with exhaustive worker pairs and Float64 side decisions. Completed answers receive volume, boundary-side and occupancy checks; explicit unsupported/precision rejections remain separately counted. This CPU audit does not measure completed GPU/native operation time. `unite-performance.mjs` measures cold and warm native union of two independently generated dense box surfaces, with actual intersection cuts, observed memory and independent analytic output checks. At its default 64 divisions the input has 98,304 triangles; `--divisions=128` requests 393,216 triangles. Input construction and output-oracle time are excluded from operation timing, while all preparation and native publication work is included.

`unite-corpus.json` inventories all 11 original Telegram STL paths and hashes: ten nonempty binary files, 5,622,891 triangles and 281,145,390 bytes, plus one empty file. Original paths are never rewritten. All 11 captured byte sequences are preserved locally under ignored `tests/scenes/unite-source/`; keep these user fixtures. During the task the original paths `Part 2.stl`, `Part 3.stl` and `Part1.stl` became unavailable. Their previously staged copies matched the captured hashes and were preserved with the rest of the corpus. Final measurements explicitly use `--source-dir=tests/scenes/unite-source`; they do not recreate the missing original paths. Every selected input is hash-checked before and after its attempt. Temporary staging/exported results remain under ignored `tests/results/`.

`unite-corpus.py` independently audits exact Float32 topology and samples Float64 nearest-source distances; verified closed one-component sources additionally receive an independent oriented-side oracle. One-sided sampled displacement is not a complete surface-distance or occupancy certificate.

Reports bind the actual loaded runtime bytes. `timings.totalMs` measures shared preparation; `editorTotalMs` measures the complete native operation. `peakGPUBytes` counts preparation-owned GPU storage including readback staging; `editorPeakGPUBytes` records the tracked scene/publication/Undo peak, with `editorGPUBytesBefore` as its baseline. Driver, pipeline and swap-chain memory are not exposed by WebGPU. `peakCPUBytes`/`peakHostBytes` are explicitly labelled conservative array/table storage estimates, not process-RSS measurements; benchmark heap/process observations are separate. The CDP sampler records simultaneous worker and page JavaScript heap plus ArrayBuffer backing-store bytes every 20 ms. It reports the observed sampled peak and sample count; it excludes process/driver overhead and can miss shorter peaks. It never adds independent maxima from different times. Output triangle counts, candidate pairs, cut faces, patch queries, fallback counts and numerical diagnostics explain the measured work.

`unite-compare.mjs` measures completed existing Printer LDI/perimeter generation on the same analytic sources and records each occupancy mismatch. Completion and accuracy have separate fields. Its 2D sampled output and Unite's full 3D polygon boundary are different deliverables, so their raw times are not an equal-output speed ratio. The comparison intentionally retains failures caused by raw duplicate/winding geometry instead of relying on the former mesh-create distance cleanup.

Capacity and numerical failures reject before replacing editor geometry. Current bounds include two million input triangles, 256 occurrences/shells for the GPU classifier, four million candidate pairs/fragments, bounded per-face constraints and device binding limits. These are implementation limits, not an assertion that arbitrary corrupt polygon soup has a uniquely recoverable volume. Edge-incidence validation alone is not a general exact-arithmetic proof of intersection-free geometry.

## Measured results, 2026-11-03

The measurements below use native NVIDIA Turing WebGPU, runtime SHA-256 `65a7f0967280eddebbcd511f30cbf052da99108cebbe5bb118fea21b304c1b02` and Printer SHA-256 `d4c4d1fb76ba87762e49fd8bec1d8f7fe4dc499d26b2e50fb7f27732ed382827`. They are local individual cold/warm runs, not universal throughput guarantees. Full source-bound records are in [unite-results.json](unite-results.json).

Standard and DPR-2 stress each passed 7,116 assertions on those exact bytes, with no JavaScript, console or WebGPU errors, lost device or device replacement.

The focused GPU suite passed 337 checks, native integration passed 81, and Printer preparation passed 21. Its first small Unite completed in 658 ms including compilation; the other 23 analytic fixtures took 57–90 ms each. The 94-case CPU cell audit completed 78 correct outputs and explicitly rejected 16 unsupported/precision cases. It found no accepted answer with incorrect tested volume, orientation or occupancy. Analytic-volume errors include initial Float32 input quantization; the near-coincident ideal thin-box reference accounts for the largest relative error, 4.35e-5. The separate ULP sweep references the actual captured Float32 walls.

| Dense intersecting input | Output triangles | Cold / warm complete native time | Intersection segments / cut faces | Preparation and additional editor GPU peak | Observed worker + page managed peak, cold / warm |
| --- | ---: | ---: | ---: | ---: | ---: |
| 98,304 triangles | 59,632 | 1.419 / 0.930 s | 1,412 / 1,412 | 12.20 MiB | 96.5 / 101.4 MiB |
| 393,216 triangles | 230,056 | 3.243 / 2.854 s | 3,582 / 2,832 | 43.13 MiB | 254.8 / 345.7 MiB |

Both dense trials passed full native edge incidence and analytic volume, plus up to 1,024 sampled boundary facets and 64 occupancy probes each. Their conservative CPU storage estimates were 61.36 / 244.71 MiB. Additional editor GPU peaks happened to equal preparation peaks in these two workloads; full scene peaks and baselines remain separately recorded.

The real corpus completed **3 of 10** operations. The three successful Parts used the unchanged, validated one-shell surface path, not a million-triangle intersection workload. Each passed full exact-coordinate topology, 256 sampled source distances and 128 independently oriented boundary-side probes. Sampled output-to-source displacement was at most 7.6e-14 source coordinate units.

| Real input | Triangles | Complete time | Outcome |
| --- | ---: | ---: | --- |
| `1, 2.stl` | 462,486 | 0.917 s | Nonorientable topology; unchanged source |
| `3.stl` | 238,616 | 0.960 s | Shell/component capacity; unchanged source |
| `4, 4.1, 10 нов.stl` | 431,559 | 3.740 s | Constrained arrangement failure; unchanged source |
| `5 отдельно вертикально.stl` | 269,061 | 1.783 s | Unresolved intersection endpoints; unchanged source |
| `6 совместно.stl` | 211,946 | 1.587 s | Unresolved intersection endpoints; unchanged source |
| `7.stl` | 235,080 | 3.907 s | Bounded Float32 embedding search failed; unchanged source |
| `8, 9.stl` | 649,615 | 2.321 s | Unresolved intersection endpoints; unchanged source |
| `Part 2.stl` | 993,656 | 3.623 s | Completed, 993,656 output triangles |
| `Part 3.stl` | 1,095,324 | 4.347 s | Completed, 1,095,324 output triangles |
| `Part1.stl` | 1,035,548 | 3.322 s | Completed, 1,035,548 output triangles |

For Parts 2 / 3 / 1, preparation-owned GPU peaks were 63.01 / 66.88 / 64.24 MiB; additional full editor peaks were 157.35 / 170.18 / 162.61 MiB. Observed worker + page managed peaks were 305.4 / 309.4 / 312.1 MiB. Failed attempts have observed CPU memory and exact source-scene rejection checks in the JSON report. No JavaScript/WebGPU validation, device-loss or device-replacement error occurred. These results do **not** establish support for arbitrary self-intersecting or damaged polygon soup.

The existing two-axis Printer alternative completed all 24 analytic cases. It produced 2,753 occupancy mismatches in 51,912 probes across 10 cases, including duplicates, self-overlap and oblique/contact configurations. Its cold first build took 493 ms; warm builds took 18–88 ms, with 0.22–7.04 MiB tracked GPU peaks. This measures all-layer sampled LDI plus one layer's perimeters, rather than a complete 3D polygon boundary. No equal-output speed ratio is claimed.

## Optional CPU/WASM comparison

The [Manifold Mesh contract](https://manifoldcad.org/docs/jsapi/classes/manifold.Mesh.html) preserves face provenance and uses a size-dependent tolerance that can collapse short edges. Its [status/tolerance API](https://manifoldcad.org/docs/jsapi/classes/manifold.Manifold.html) and the resulting native Float32 geometry are separate observations.

The pinned 3.5.4 Node trial on `7.stl` took 24 ms to import/initialize, 542 ms for Frame's source preparation, 495 ms for mesh construction, and 873 ms for the OR kernel/output. It returned `NoError` with tolerance 7.50e-8 source coordinate units. Raw Float32 export had 12 zero-area facets, 13 geometric nonmanifold edges and 6 winding-edge errors. Exact position welding and removal of only zero-area facets took 430 ms and left one contact edge, no open/winding edges and no zero-area triangles. This cleanup is not a source-intersection or general fill-rule certificate. A representable thin cavity retained its expected volume. Peak Node RSS was 668.9 MiB including parsing, library, outputs and independent topology checks; this is a different memory scope from Frame's sampled managed storage. This experiment does not supply an automatic production fallback.

To reproduce without adding a runtime dependency:

```powershell
New-Item -ItemType Directory -Force work/manifold | Out-Null
npm pack manifold-3d@3.5.4 --ignore-scripts --pack-destination work
tar -xf work/manifold-3d-3.5.4.tgz -C work/manifold
npm run test:unite:manifold -- --module=work/manifold/package/manifold.js
npm run test:unite:corpus -- --headless --source-dir=tests/scenes/unite-source
```
