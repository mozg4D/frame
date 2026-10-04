# Frame r185: acute sources keep their trajectory breaks

The latest user instruction supersedes r184's target of forcing a first-layer spiral on Acute tip 30 degrees. An acute-tip protocol requires a break, so a connector between these perimeter cycles is unnecessary. Nominal width W remains the default. This release removes spiral qualification for original source corners strictly below 45 degrees. It does not implement the separate acute-tip expansion, pressing, retrace and restart protocol.

## Implementation and changed acceptance

The source corner classification uses exact Float64 dyadic coordinates converted to one BigInt scale. For a convex source corner, a positive dot product and absolute cross product smaller than the dot product prove an interior angle below 45 degrees. The source ring orientation distinguishes convex corners from reflex corners. Clockwise and reversed source rings agree; exactly 45 degrees is admitted. The classification is separate from the existing 45-degree connector certificate. Eligible non-acute families still use the unchanged fixed/reseated spiral algorithms and guards. No radius, source-coordinate or containment tolerance changes.

The classifier runs only inside existing spiral scope: enabled spirals, at least two perimeters, one fixed-fallback source family, one original ring and at most 256 source vertices. Count 1 retains the entire r184 output exactly. The first-layer Acute tip 30 degrees at counts 2, 3 and saved 7 has 2/3/7 separate nominal perimeter paths and 2/3/7 travel commands. All its extrusion command widths are exactly W and nozzle radii W/2. No inter-cycle connector or connector-induced width ramp remains. The whole seven-pass model is inspected at all three corners in the rendered first layer. Existing ordinary closed-loop seams remain, and these are not claimed to be the required future acute-tip break protocol.

All seven retained r183 zoo spirals on layers 33-39 are also on a source triangle with a corner below 45 degrees. The new instruction supersedes the earlier request to retain them. They are removed for the same geometric reason; no valid non-acute spiral is rejected by this semantic gate. No zoo spiral is forced as a count-based acceptance target. Existing constant-neck routes can resume when the excluded acute connector no longer consumes the whole-layer junction choice. Those ordinary neck routes are not relabeled as acute spirals.

## Evidence

Actual saved input: C:/Users/mozg4/Documents/Codex/2026-10-01/task-2/qa/output/slicer-rebuilt-r179.hash. W=1 mm; 363 occupied layers; initial/layer heights .6/.3 mm. Every layer is checked at counts 1, 2, 3 and 7. Serial/14-helper raw packets, original references, Float32 source angles and complete public commands match at counts 1, 2 and 7. References and components unaffected by the removed spiral or restored existing neck choice match r184 exactly. Source and direction thresholds, exact 45-degree controls and non-acute families are checked separately.

Counts 1/2/3/7 yield 8,106/9,605/11,088/17,003 paths and 109,912/198,987/285,006/603,067 segments. Real rendered first-layer axis/endpoint-width buffers match every command-backed segment after Float32 packing: 3,264/4,330/7,864 at counts 2/3/7. The saved count-7 native gzip hash reimport reproduces the entire first layer and commands exactly. Browser lifecycle, old/new-volume invalidation/undo/redo, Start/Finish/Position, Human 3,332 layers and 27 exceptional sections, half human 2,967/24, 196,608-face dense 999-layer parity, cancellation/resource/protocol controls and normal service-worker update/offline checks use the retained bounded harnesses. Final pass receipts and absolute interleaved performance values are sealed in the task-6 QA handoff; do not infer a speed improvement from removed geometry or correctness-run times.

## W-long geometry milestone held separately in QA

The saved r184 failing endpoint witness is preserved byte-for-byte, SHA256 77a87693f7ce9235f94d6b0362e5209a6f32774efcdcd013d0f95f8a55bf53b3. Its two old expansion/contraction endpoints still fail exact nominal source clearance and remain outside the thin-wall exception. Simplified offset chords can pass at original vertices and dip below radius W/2 between them. Corrected attachments derive from immutable finite source-bank offset lines and rejoin safe retained axes. Only representable axis positions are selected; sources, nominal radius and zero boundary tolerance remain unchanged.

All ten saved geometry layers 1,6,12,13,14,21,24,26,28,32 now qualify in the standalone corrected geometry verifier. Each new axis has an exact dyadic squared-distance certificate at least (W/2)^2 against every original source edge, a fully contained flat ribbon, feeds in W-1.6W, W independent starts/ends and expansion/contraction travel at least W. The first-layer cumulative conservative seam charge is about .487064 W squared, below .5. A partial bank interval that initially failed the zero-tolerance flat-ribbon predicate was reseated to a nearby representable bank position while preserving W travel; it was not treated as universal infeasibility. The corrected candidate emits eleven actual real-scene layers (1,4,8,11,13,19,21,24,26,27,32). Full 363-layer serial/14-helper packets, references, source angles and first-layer commands match. Every emitted profile has a complete current source-bank association and exact clearance proof. Native reimport is exact, and all 2,111 first-layer renderer axes/widths match exported commands; the new continuous route has 38 commands. The ten saved static geometry successes and the current owner-qualified emission set are distinct: current-source finite bank/face coverage still limits other layers. Final malformed-helper/foreign-source campaigns and reverse-orientation/range qualification for this larger candidate remain pending. The W-long prototype is not included in this r185 production worker.

The full .6-1.6W neck range, through-neck thin-wall authority, acute-tip expansion/press/retrace/restart, general multi-junction/hole/split/merge spirals and all-path independent-start widths remain unfinished. In particular, this correction removes the unnecessary acute connector but does not yet replace the closed nominal acute loops with the specified pressing and no-feed return. Coverage and physical printing are not certified.

Base main: dc5a9909c2395d7620f513429ef1cfd983e89f69. Production worker SHA256: bb63a80d225c502b1c37dd7f579f592ccf49533ba6f438271363edc4dc98df0a. Engineering documents remain outside runtime code. Exact remote main, Pages commit, asset hashes and fresh browser/native checks are required for publication verification.

## Final isolated timing and guard costs

Full Slice means invocation with sources ready through two painted animation frames. Each row has two observations per version in ABBA order; correctness hashing and imports are excluded, and every Slice creates fresh workers. The retained harness's raw labels r183/r184 refer to current baseline r184 and the listed candidate. Count 2 is about 35% slower after restoring necessary ordinary neck finalization; this is a measured regression, not hidden as guard-only overhead. Count 1 is effectively unchanged. No general speedup is claimed.

|Candidate|Count|Condition|r184 mean s|Candidate mean s|Change|r184 observations s|Candidate observations s|
|---|---:|---|---:|---:|---:|---|---|
|r185-acute|1|cold|9.5158|9.4853|-0.32%|9.4481, 9.5835|9.4850, 9.4855|
|r185-acute|1|warm|9.3919|9.3686|-0.25%|9.3170, 9.4667|9.3061, 9.4311|
|r185-acute|2|cold|8.4304|11.4419|35.72%|8.4815, 8.3793|11.3583, 11.5255|
|r185-acute|2|warm|8.3085|11.2465|35.36%|8.3005, 8.3166|11.1710, 11.3219|
|r185-acute|7|cold|15.9424|15.2755|-4.18%|16.2049, 15.6800|15.2807, 15.2702|
|r185-acute|7|warm|15.6647|15.1368|-3.37%|15.7447, 15.5847|15.1300, 15.1436|
|W-long-QA|1|cold|9.4293|11.2756|19.58%|9.4946, 9.3639|11.4388, 11.1124|
|W-long-QA|1|warm|9.3498|11.1206|18.94%|9.4471, 9.2524|11.2410, 11.0003|

The acute classifier itself sums 0.2121/0.1921 seconds across overlapping owner/helpers; it does not explain the roughly three-second count-2 wall regression. Ordinary neck finalization resumes when the unnecessary acute connector no longer consumes the layer choice.

The unpublished corrected W-long candidate increases count-1 full Slice from 9.4293/9.3498 seconds (cold/warm baseline means) to 11.2756/11.1206 seconds: +19.58%/+18.94%. Its preparation sums 4.733/4.514 seconds across workers; exact clearances 0.761/0.744, source-offset construction 0.531/0.567, local seam charge 1.157/1.265, and owner/source/neighbor qualification 4.158/3.805 seconds. These nested overlapping sums must not be added to wall time. The valid clearance construction is retained in QA; its substantial guard/owner expense and remaining campaign scope require further work before production.
