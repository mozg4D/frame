# r190: nominal nozzle clearance around a rectangular hole

Base: main r189, e2d0975765ce6f384aadf7d74750e67cd1380eb7. Worker SHA256: b74b1e49c5d1c9cdeda5b1c0542e6fdfeca8bafd8761df96dd28eee00ef90732.

The retained source at zoo reference 19/component 18 contains a 54 × 34 mm outer rectangle and a 34 × 15 mm rectangular hole. Sixteen generated, positively extruding round-offset chords approached the original hole boundary to 0.4820956855580134 mm at W=1 mm, below the fixed 0.5 mm nozzle radius. This was actual deposited software output, also observed in the GPU axes; it was not merely the retained Original comparison path. The sum of their exact flat-ribbon intersections with the original hole was 0.0029184939978327863 mm² (sum of intersections, not a union area).

The bounded primary nominal hole contour now uses a convex polygon of tangents. Every actual segment is checked against each immutable source ring with exact binary-rational minimum distance >= W/2, plus zero-tolerance flat-ribbon containment. Feed and displayed widths remain W, and each independent start remains W. The original section, hole, outer dimensions, original inset and all deeper level references stay unchanged. The complete convex boundary lies within the existing 0.02W trajectory band; the largest measured correction is approximately 0.017905W. Small outward representable-coordinate adjustments satisfy the exact clearance check; no clearance threshold or source boundary is relaxed.

The implementation qualifies two strictly nested axis-aligned rectangular source rings (eight vertices), one primary depth-0 hole path of 8–64 convex vertices, nominal offset W/2, hole dimensions at least 4W, and at most 32 component paths. Unsupported families keep their prior behavior. A source hole is not an inward child of the outer contour. Neither this change nor the travel planner creates a connector or modifies the rejected bridge.

Two independent nominal closed contours can now use the existing constrained travel planner. It fixes the first path, keeps directions, complete directed intervals, width metadata, depth order and continuous routes, and rotates only eligible nominal seams to existing vertices. The isolated retained fixture saves 37.336266 mm in the travel-only control. With the corrected geometry its travel is 12.574196275084384 mm instead of 49.92494366546646 mm. For layers with the clearance correction, the planner compares the actual-axis proposal with a proposal using retained nominal axes as ordering costs, then selects using actual travel length. The retained axes are diagnostics for ordering; extrusion commands always use the corrected axes. Acute thin-tip ownership is finalized once after the selection. This bounded heuristic does not certify a global shortest travel.

## Geometry and coverage evidence

Twenty-four exact geometry cases span W=0.4, 0.5, 0.7, 1, 1.3 and 2 mm, reflection, quarter-turn and translation. Eight additional size/translation cases prove exact convex enclosure and the full two-percent boundary band. Three controls retain disconnected, narrow and nonrectangular families. Forty-eight travel cases and 336 protected variants cover directions, current Float32 angle rephasing, continuous/spiral roles, variable width, nonextruding edges, open paths, explicit closure and stale angle counts.

Actual 32-triangle watertight annulus meshes at all six widths verify positive extrusion, exact fixed-radius clearance, zero flat-ribbon spill into the hole, clockwise closed paths, outer-before-hole order, GPU axes and nominal widths, and exact native-memory reimport. An inclined annulus retains current surface warning values up to 8.530780 degrees and the existing nominal warning association. Surface warnings and geometric evidence do not certify printed support or physical print quality.

Changing a corner axis changes its flat-ended footprint. The independent exact union diagnostic for W=1 removes 0.202491 mm² of previously covered valid material and adds 0.148552 mm². The hole contour length changes from 101.118437 to 101.179454 mm. The sum of pairwise ordinary corner overlaps changes from 1.155810 to 1.285645 mm²; positive spatial repeat difference is 0.447142 mm². These are corner-footprint diagnostics, not additional spiral seams. There is no new connector, retrace or extra seam. Existing ordinary seam handling and all existing spiral/continuity ledgers are preserved. Physical deposited beads were not measured.

## Complete retained regressions

All 363 zoo layers run at perimeter counts 1, 2, 3 and 7 in serial-owner and helper modes. Complete paths, metadata, current angles, references and public layers agree between those modes. Every retained section and inset reference is byte-equivalent. Nineteen primary hole cycles (layers 1–19) change at each count. Other geometric changes are limited to eligible ordinary seam rotations from the travel extension. All acute routes retain their coordinates, feeds, source-bank selection, restart overlap and angles; any neighbor indices refer to the same actual predecessor. Position22 retains incoming bank A and 0.5W overlap. All five W-long routes at layers 21, 24, 26, 27 and 32 and their charges are unchanged. The r185 acute triangular break is retained.

| Count | Paths | Segments | First-layer travel before / after (mm) |
| --- | ---: | ---: | ---: |
| 1 | 8106 | 110903 | 6048.196396 / 6048.171356 |
| 2 | 9605 | 200875 | 9089.534482 / 9089.509442 |
| 3 | 11088 | 287838 | 12096.877460 / 12096.852420 |
| 7 | 17003 | 608643 | 24392.697169 / 24392.703185 |

The count7 first-layer travel increases by 0.006016 mm because the clearance-corrected contour changes the legal geometry. Counts 1–3 shorten the first layer by 0.025040 mm. Unrelated unsupported cases are retained; this release does not claim full clearance or continuity certification for every holed family.

## Matched performance and runtime

ABBA comparisons use the same saved source, browser, device, worker budget and parameter changes, with the r189 worker and this exact worker substituted for every slicer owner/helper.

| Count | r189 mean (ms) | r190 mean (ms) | Change | Owned Chrome CPU before / after (s) |
| --- | ---: | ---: | ---: | ---: |
| 1 | 8226.350000 | 8352.400000 | 1.532271% | 82.613391 / 82.329234 |
| 7 | 15660.350000 | 16440.000000 | 4.978497% | 183.333646 / 184.836314 |

Private memory samples cover only owned Chrome PIDs, at approximately 150 ms intervals; they are observations rather than allocation-exact peaks, exclude Node and the sampler, and include heaps retained between ABBA runs. Observed baseline/candidate maxima are 3035148288 / 3172564992 bytes. Animation-frame p95 stays at approximately 16.8 ms. The shared heavy pool remains 15 threads on this 16-thread device, with all owned slicer workers terminated and zero active leases after regular Slice. Display/native scenarios retain one inactive UI scope, matching the established control. Cancellation, fresh-generation recovery, normal PWA update retention and offline Slice/native/library are checked separately.

## Remaining scope

The constant-W 45-degree outer-to-hole bridge remains rejected: departure overlap alone is about 0.707107W² and both joins about 1.414214W², exceeding the whole-layer added-spiral budget of 0.5W². Width is not altered to force it. Further multi-junction/holed inward continuity requires an independently legal topology and budget. Position22 needs the pending user choice; this release makes no choice for it.

The ring census contains 131 multi-ring references out of 1184: 111 actually holed references and 20 disconnected references, with 130 holes in total and at most two holes in a connected section. This corrects the broader “131 holed” wording in the earlier audit. No .hash input, memory file, untracked QA or preexisting SAFE_PAUSE document is changed.

Reproducible receipts and detailed handoff: C:/Users/mozg4/Documents/Codex/2026-10-05/task-3/qa/hole-clearance/.
