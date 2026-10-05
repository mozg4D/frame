# Frame r191: reuse immutable travel-search distances

Base: main r190, 5ca57a4569cc6bbd1295715702bd0271fdc6edb6. Worker SHA256: 4fc8e89542ef11ef728c1a341c25d49570833e1a333ff7b01df1b325038c669c.

The constrained travel search repeatedly evaluates the same endpoint pairs while trying component swaps. Each call now retains those directed distances for its immutable swap-stage endpoints. Its affected-edge summation uses the same insertion and duplicate-removal order as the former Set, with fewer temporary allocations. Candidate traversal, exact Math.hypot operands, floating-point addition order, strict gain and tie comparisons, work counters and limits remain identical. Seam selection still follows the swap stage. The cache is local to one planner invocation, with at most the square of the existing 512-path limit in keys, and is discarded after that call. No persistent worker or cross-generation geometry cache is introduced.

The initial instrumented r190 profile found approximately 2.27-2.38 seconds in the owner travel geometry planner for zoo count1 and 2.96-2.99 seconds for count7 across all 363 layers. These diagnostic inclusive timings include instrumentation overhead; overlapping helper times must not be added to wall time. The actual uninstrumented full-Slice measurements below establish the bounded benefit.

## Full Slice measurements

The stopwatch starts at Slice API invocation and ends after two requestAnimationFrame callbacks. Import, source readiness, worker source loading and all correctness hashing are outside the stopwatch. Cold means first Slice in a fresh browser/page; warm means its immediate repeat. Every Slice creates fresh owner and helper workers. ABBA order provides two cold and two warm observations per version per scene/count. Both versions use the same actual model and settings in each pair. Values are median seconds with complete observed ranges.

The retained zoo contains 61,074 triangles and 363 layers at W=1 mm, layer height 0.3 mm and initial layer height 0.6 mm. The actual male standing catalogue fixture is fitted to 1,000 mm using its retained Float64 fit transform, with minimum path 0 and the same width/heights. All 3,332 human layers are retained; count7 produces 1,176,800 actual segments. Models, sections and exceptions are not dropped.

| Scene | Count | Condition | r190 seconds (range) | r191 seconds (range) | Change |
| --- | ---: | --- | ---: | ---: | ---: |
| zoo | 1 | cold | 8.609 (8.606-8.612) | 8.240 (8.194-8.286) | -4.29% |
| zoo | 1 | warm | 8.339 (8.315-8.364) | 8.009 (7.987-8.031) | -3.96% |
| zoo | 2 | cold | 10.008 (10.002-10.013) | 9.662 (9.639-9.686) | -3.45% |
| zoo | 2 | warm | 9.780 (9.738-9.823) | 9.530 (9.522-9.537) | -2.56% |
| zoo | 3 | cold | 11.666 (11.607-11.725) | 11.122 (11.019-11.226) | -4.66% |
| zoo | 3 | warm | 11.261 (11.223-11.299) | 11.110 (10.921-11.299) | -1.34% |
| zoo | 7 | cold | 16.038 (15.909-16.166) | 15.847 (15.796-15.897) | -1.19% |
| zoo | 7 | warm | 15.998 (15.839-16.157) | 15.666 (15.623-15.709) | -2.07% |
| human1000 | 1 | cold | 4.030 (4.017-4.043) | 4.035 (4.006-4.064) | +0.13% |
| human1000 | 1 | warm | 3.916 (3.902-3.931) | 3.979 (3.896-4.062) | +1.60% |
| human1000 | 2 | cold | 6.685 (6.676-6.695) | 6.669 (6.667-6.670) | -0.25% |
| human1000 | 2 | warm | 6.532 (6.507-6.557) | 6.579 (6.555-6.602) | +0.71% |
| human1000 | 3 | cold | 8.246 (8.169-8.323) | 8.130 (8.101-8.160) | -1.40% |
| human1000 | 3 | warm | 8.019 (7.980-8.057) | 8.027 (8.001-8.053) | +0.11% |
| human1000 | 7 | cold | 13.384 (13.263-13.506) | 13.108 (13.095-13.121) | -2.06% |
| human1000 | 7 | warm | 13.063 (12.988-13.138) | 13.212 (13.187-13.238) | +1.14% |

Zoo medians improve in every measured count/condition, with the strongest consistent gain at count1. Count3 warm ranges overlap and the count7 cold margin is small. Human results vary between approximately 2.1% faster and 1.6% slower across conditions; this fixture does not establish a consistent benefit. These results support a bounded zoo travel-search gain, not a general Frame speedup.

The existing shared heavy budget remains 15 leases on the 16-logical-thread host (owner plus 14 helpers). All owned slicer workers terminate and active leases/scopes return to zero after regular Slice. Animation-frame p95 remains approximately 16.8 ms. Maximum observed frame gaps in the primary campaign reach 200.1 ms for zoo and 216.7 ms for human. UI frames continue; continuous 60 fps is not established.

An independent ABBA repetition at counts1/7 samples only owned Chrome PIDs, using fresh browsers per version/ordinal and a 150 ms sleep between read-only polls. Actual sampling timestamps are retained; process reads add overhead to the interval. These are sampled private-memory observations, excluding Node and the sampler, rather than allocation-exact peaks. The maximum observed private bytes are 3060621312 for r190 and 3134205952 for r191. Raw timing, CPU and sampling ranges are retained separately.

## Exact output and runtime gates

Complete zoo and human Slice runs at counts1/2/3/7 compare the candidate in helper and serial-owner modes against fresh r190 output. The zoo control also matches retained r190 receipts. Entire paths, metadata, travel scheduling/work, canonical reference definitions and public geometry/commands are exact. Additional hashes preserve typed-array bytes and signed zero, including raw Float32 warning values. All five r189 W-long routes, rectangular hole correction, nominal W/2 clearance, widths, outside-first/clockwise ordering, acute ownership and overlap charges are retained. Position22 keeps its r190 placement; no pending user choice is inferred.

The 48 travel controls and 336 protected variants exercise reflected/scaled geometry, protected continuous/spiral routes, open and explicitly closed paths, variable widths, nonextrusion and stale-angle rejection. Another 144 deterministic cases exercise up to 512 paths and the 32,768 swap-test cap, compare actual and retained ordering costs, and require full output equality. Their maximum recorded total work is 39,671, within the 65,536 cap. Eight exact rectangular-hole cases and three unsupported-family controls pass.

Actual intermediate-layer cancellation clears stale preview and terminates every owned worker. A fresh generation recovers the same commands. First-layer and all five W-long layers survive native in-memory export/reimport, and actual Solid/Lines-Dots GPU data matches r190. Finite-bank/source-angle, minimum-path/contact, model invalidation/undo/redo, in-flight edit/delete and range UI regressions pass.

The normal PWA update throttle retains an unsaved r190 window while staging exact r191 resources. A fresh r191 page loads offline, slices, reloads native data, loads a cached catalogue model and completes offline worker Save. The service worker, editor, printer module, catalogue .hash bytes, authoring precision and physical geometry predicates are unchanged. No tolerance or validation threshold is weakened.

Publication is direct main and the existing GitHub Pages site after these gates. The release receipt verifies exact-head Pages CI and every retained live asset by SHA256. Detailed evidence and the final handoff are retained in C:/Users/mozg4/Documents/Codex/2026-10-05/task-4/qa/.
