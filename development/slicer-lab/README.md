# Independent slicer, checkpoint 19

Development source only. Three synthetic convex-annulus layers pass the prototype owner's computational checks. This is not physical-print acceptance or production integration. Admissible spirals: 0. No live Frame worker or separate browser application is installed here.

## Run from a Frame checkout

Node.js 20 or newer is required. No package installation or network access is needed.

```sh
cd development/slicer-lab
node tests/run-public-checks.cjs
```

`npm test` runs the same suite. It reconstructs the pinned workers, checks source integrity and JavaScript syntax, then runs twenty-two test stages: reconstruction guards, contour baseline/regression, accuracy and exact predicates, checkpoint compatibility, annulus geometry and owned-worker transport, physical direction, transition rejection, ordered provenance, seam/corner diagnostics, T-body and cap candidates, exact commanded-polygon multiplicity, input-rejection guards, rounded material boundaries, open-portal provenance, and serial/helper/cancel equivalence. Failures return a nonzero exit status. Generated logs remain in ignored `evidence/`.

The checkout must contain `modules/slicer-worker.e120c24f46831ec5c53d.js`, SHA-256 `e120c24f46831ec5c53de96d5704b4942fef99771e3fe19268aa4915fba40475`. `worker-deltas.json` stores readable source edits and expected hashes for the three original worker snapshots. `scripts/prepare-workers.cjs` reconstructs them into ignored `core/` paths after validating every source/edit/output hash, refusing to overwrite changed generated files. Production files are only read.

`SHA256SUMS` covers tracked sources, including worker deltas and their expected generated hashes. Generated workers are intentionally absent from that manifest. After intentional source edits, regenerate checksums for the new checkpoint.

## Verified synthetic scope

- One narrowly qualified class: a near-uniform, strictly convex, exactly homothetic two-bank annulus, one requested perimeter, exact physical Float64 section, and existing work limits. Acceptance was tested on 128-edge fixtures at W = 0.5, 1, and 2; it does not cover arbitrary annuli or variable-width walls.
- Each tested layer selects 130 contiguous print commands, one external start, no internal restarts or travels, and no retained-worker fallback.
- The all-point original-material-to-feed distance bound is approximately 0.015625094W; the cumulative computational bound is at most 0.015626354W. This is geometric approximation to the unchanged complete original partition, not exact set equality or a deposition-volume certificate.
- Actual print laps have negative signed area in physical right-handed XY, Z up, viewed from +Z. Known-square, worker/JSON/owner tests check that direction without an axis reflection. Transition planning uses the same sign.
- Ordered provenance preserves original edge/face identities, reverses directed interval order and endpoints, and keeps clipped canonical parameters consistent. Tests cover subdivided and reversed source rings, final owner JSON, and a deliberately corrupted interval order.

## Limits that remain

The closure length is at most 0.5W. Approximately 0.499999523W² is the *additional closure charge* under the existing unchanged-ribbon ledger. For the tested W = 1 annulus, exact convex-ribbon union accounting gives commanded repeated area D = sum(ribbon areas) - union area approximately 1.285577422W², including approximately 0.785577899W² before the closure. Pairwise intersection sum P equals D for that fixture because its positive-area triple coverage is zero. Generally P and D differ; the triple-retrace negative test has D = 2W² and P = 3W². The closure ledger, D and P are different quantities. This certifies commanded two-dimensional polygon accounting only. No claim is made that nominal overlap is physically harmless; physical extrusion multiplicity, deposited volume and over-extrusion remain unvalidated. Internal restart overlap remains outside the accepted toolpath contract.

Multi-level transition tests retain the W-long width-phase and shared W²/2 limits. Actual generated transitions remain rejected for substantive geometry/overlap reasons; the synthetic bottom-bank connector test does not establish an accepted spiral or global maximal continuity.

T-shaped finite perimeter routes still do not certify full material allocation. A new source-derived T-body candidate covers the central cell missed by the finite perimeter construction, using only nominal W commands. For the tested 329W² T, its 14 commands leave 10.5W² of original CAD material uncovered and have D = 0. Adding three diagnostic caps leaves 1.5W² uncovered and raises D to 9W²; the cap overlap fails the unchanged joint budget. Both cases remain rejected by the mesh owner, with no selected commands or execution. They establish no new accepted full T layer or spiral.

## Rounded T material and open portals

The exterior 90-degree material target is independently constructed from the original T and the usual fixed-width round nozzle rule: six disjoint inward W/2 squares retain their quarter disks. Only each square-minus-quarter-disk region is excluded; original material elsewhere is unchanged. The total excluded area is 1.5(1 - pi/4)W². Rational bounds enclose pi and all analytic boundary arcs. The material-boundary approximation is below 0.003862W in the tested cases, but contains no print commands and is not a complete feed or centreline certificate.

For the diagnostic body-plus-cap construction, the remaining material required by this rounded target is still approximately 1.178097245W². The target, original-CAD difference, and numerical construction error are separately accounted. The 2%W limit measures numerical deviation against the prescribed reference; it does not silently authorize arbitrary CAD loss. Body-only candidate construction remains distinct from a complete prescribed route.

Source-owned open portals retain the original body target and directed original-edge/triangle provenance. Tested terminal and branch coupons are continuous and satisfy their local joint bounds; the combined coupon fails the unchanged W²/2 bound. Complete outputs still have 13 or 14 separate components and remain unselected. Local fixed-placement overlap and fixed-Y channel arguments do not establish impossibility for general two-dimensional routes. No internal restart overlap or variable-width shortcut is introduced.

Input checks reject concave, self-crossing and non-2D polygons, malformed work budgets, oversized rational coordinates and invalid T boundary order. Tests preserve valid reversed/subdivided input, check nonzero construction error near the 2%W limit, and reject forged targets and owner proposals.

Rectangle full-material allocation, the unselected 113-start corner coupon, variable/multiple-hole annuli, nonzero section-conversion error, general topology beyond the existing budget, and admissible spirals remain unresolved or unsupported. Native UI, production scheduling, G-code and physical printing are not validated by this suite. Historical full-model results are not current checkpoint evidence.

Original Frame and third-party license notices retain their terms. No historical reports, user models, screenshots, dependency caches or duplicate full workers are included.

Reconstructed core SHA-256: `9ea9e79aebe55061e637b1e137f9836406b6119d0946ce7b622db6aa14db757f` (sorted core JS/CJS basenames followed by exact bytes).
