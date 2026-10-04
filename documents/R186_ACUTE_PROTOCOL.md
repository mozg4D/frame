# r186: acute-tip press, retrace and break

The saved first-layer Acute tip30 model now uses the requested acute motion at perimeter counts 1, 2, 3 and 7. Each perimeter starts with nominal W feed, follows its banks clockwise, expands up to 1.6W where the original source leaves room, contracts to W, and feeds W to a remaining wedge gap of 0.6W. It reverses the first W of travel with 0.1W feed, retraces the remaining approach without feed, then overlaps the incoming bank for 0.5W starting with 0.6W feed and expanding to W. The path ends there. The next perimeter restarts independently at W; there is no diagonal inter-cycle connector.

Feed-equivalent width and physical nozzle radius are separate. The radius remains W/2 through the entire motion, including the intentional thin-wedge feed and press. Source outer and hole coordinates are retained. Press motion displays the existing nominal bead; the no-feed return has zero extrusion volume and is omitted from Solid, Lines-Dots and print picking. Exported commands carry the same edge-specific widths, roles and extrusion flags as the renderer.

The implementation qualifies a single acute convex source corner below 45 degrees in a source-derived closed outer family. Exact dyadic angle predicates retain the strict threshold and an exact normalized-angle cache of at most 64 entries. Fitted geometry travels in existing prepared component packets; current-layer original-bank inclination and foreign-boundary checks remain mandatory. Multiple acute corners, holes, unsupported split correspondence and ambiguous source incidence retain their established source-preserving fallback. This is software qualification of the requested first-layer model, not a claim of universal acute coverage or physical print certification. The separate W-long neck transition candidate remains in QA.

Prepared nominal neck geometry now travels in the existing bounded cache and transport rather than being reconstructed for every output layer. The exact key includes source geometry, axes, nominal feed/display settings and addressing; current-layer angle and foreign-path evidence are not cached as acceptance. Existing worker admission, packet limits, cancellation, generation invalidation and lease release remain unchanged: 14 helpers plus the owner on a 16-thread host, at most 15 admitted leases.

Verification uses the real saved fixture, actual commands and render attributes, all 363 zoo layers at counts 1/2/3/7, exact serial/helper source references and angle arrays, authored binary native reload, human recovery, range controls, changed-source invalidation, cancellation and PWA fresh/update/offline behavior. Performance and exact release receipts are kept with the bounded task evidence.

Repository cleanup removes 54 superseded, critical-only historical modules (53,986,088 bytes). All current and prior r185 runtime assets, historical lazy catalog/worker dependencies, documentation and licenses remain. Git history is preserved. Fresh launch and r185-to-r186 update are checked with those 54 modules absent, including retention of an unsaved prior window and offline Slice/native reload. Native multidimensional hash-XOR-hash serialization and all model codecs remain unchanged; Lossless compression remains an independent experiment and does not ship here.

Runtime worker SHA-256: c4851ca970d757b9f4d8e7f12de413ea0035ffc984b35b70ce989faa1c0d5c34

Printer SHA-256: d75a3ae1c3ae44fa54536060f6d677c3907cc3abda20754ec99c380fcf83d228

A short 30-degree source triangle with W=1 and length3.5 has only1.10582854123W of source-derived nominal bank travel. Even peak W requires a W approach plus0.5W of retained overlap, totaling1.5W. That motion cannot fit there; its existing source-preserving fallback remains. Larger short controls choose actual fitted peaks1.06646W,1.17928W,1.35193W and1.52910W rather than rejecting a legal smaller fit.

Future save-format work requires one common.hash read/write pipeline for scenes and library scene fragments, with catalog presentation metadata outside the fragment. Preserve actual source precision, including Float64 values; no quantization, Draco, symmetry codec or format migration is included in r186.

## Matched full-Slice measurements

Slice starts with sources ready and ends after two painted animation frames; imports and correctness hashing are excluded. Each release uses its matching HTML, printer and assets, fresh workers on every Slice, and the same scene/settings. ABBA gives two cold and two warm observations per release and count. All24 runs had14 overlapping helpers, peak15 admitted leases, and zero workers/leases left active.

|Count|Condition|r185 mean s|r186 mean s|Change|r185 samples s|r186 samples s|
|---:|---|---:|---:|---:|---|---|
|1|cold|8.8202|7.2003|-18.37%|8.8657, 8.7748|7.1828, 7.2178|
|1|warm|8.7196|7.1596|-17.89%|8.6409, 8.7983|7.0850, 7.2342|
|2|cold|10.6204|8.9574|-15.66%|10.5186, 10.7222|8.9403, 8.9746|
|2|warm|10.5633|8.9859|-14.93%|10.4821, 10.6445|8.9657, 9.0061|
|7|cold|14.0575|15.0086|6.77%|13.9835, 14.1315|14.9887, 15.0286|
|7|warm|13.9635|14.8135|6.09%|13.9292, 13.9978|14.7020, 14.9249|

Counts1 and2 improve by about18% and15%; count7 is about6% slower. This is not a general speedup. The new acute protocol adds944,1888 and5576 segments respectively, with unchanged path counts.

The earlier r184-to-r185 count2 slowdown was not caused by longer output: paths decreased9606 to9605, segments199103 to198987, and total axis length decreased0.00416%. Main-owner continuous-neck geometry qualification rose from0.0007/0.0008s to2.9523/2.9400s when normal neck finalization resumed. Reusing the qualified prepared geometry addresses that repeated work without restoring the incorrect acute connector. Pure-neck-only matched ABBA improved count2 by17.68% cold and18.63% warm; the finished protocol comparison above includes actual new motion, exports and renderer cost.

## Profile attribution and precision investigation

Count2 function profiling reduces critical main-owner finalization from3.273/3.113s to1.102/1.134s, and main neck geometry from3.019/2.876s to0.622/0.624s. New acute owner work is0.238/0.265s: current-source proof0.199/0.217s, foreign checks0.033/0.038s, and main acute fitted-geometry preparation only4–5ms. Summed all-worker inset-material work is59.4/59.6s, prepared neck geometry6.89/6.94s, and acute fit0.317/0.313s. These scopes nest and helpers overlap; their sums are not wall time and must not be added together.

The profile identifies a much larger inset-material stage than the cached acute fit, but does not isolate Float64 arithmetic instruction cost. Actual Float32 versus Float64 execution, memory/transfer cost and robust topology/source-boundary quality require a separate bounded kernel experiment. JavaScript Float32 buffers or Math.fround loops alone would not establish faster Float32 arithmetic. No compute precision is reduced here.
