# Independent slicer, checkpoint 17

Development source only. Three synthetic convex-annulus layers pass the prototype owner's computational checks. This is not physical-print acceptance or production integration. Admissible spirals: 0. No live Frame worker or separate browser application is installed here.

## Run from a Frame checkout

Node.js 20 or newer is required. No package installation or network access is needed.

```sh
cd development/slicer-lab
node tests/run-public-checks.cjs
```

`npm test` runs the same suite. It reconstructs the pinned workers, checks source integrity and JavaScript syntax, then runs fifteen test stages: reconstruction guards, contour baseline/regression, accuracy and exact predicates, checkpoint compatibility, annulus geometry and owned-worker transport, physical direction, transition rejection, ordered provenance, seam/corner diagnostics, and serial/helper/cancel equivalence. Failures return a nonzero exit status. Generated logs remain in ignored `evidence/`.

The checkout must contain `modules/slicer-worker.e120c24f46831ec5c53d.js`, SHA-256 `e120c24f46831ec5c53de96d5704b4942fef99771e3fe19268aa4915fba40475`. `worker-deltas.json` stores readable source edits and expected hashes for the three original worker snapshots. `scripts/prepare-workers.cjs` reconstructs them into ignored `core/` paths after validating every source/edit/output hash, refusing to overwrite changed generated files. Production files are only read.

`SHA256SUMS` covers tracked sources, including worker deltas and their expected generated hashes. Generated workers are intentionally absent from that manifest. After intentional source edits, regenerate checksums for the new checkpoint.

## Verified synthetic scope

- One narrowly qualified class: a near-uniform, strictly convex, exactly homothetic two-bank annulus, one requested perimeter, exact physical Float64 section, and existing work limits. Acceptance was tested on 128-edge fixtures at W = 0.5, 1, and 2; it does not cover arbitrary annuli or variable-width walls.
- Each tested layer selects 130 contiguous print commands, one external start, no internal restarts or travels, and no retained-worker fallback.
- The all-point original-material-to-feed distance bound is approximately 0.015625094W; the cumulative computational bound is at most 0.015626354W. This is geometric approximation to the unchanged complete original partition, not exact set equality or a deposition-volume certificate.
- Actual print laps have negative signed area in physical right-handed XY, Z up, viewed from +Z. Known-square, worker/JSON/owner tests check that direction without an axis reflection. Transition planning uses the same sign.
- Ordered provenance preserves original edge/face identities, reverses directed interval order and endpoints, and keeps clipped canonical parameters consistent. Tests cover subdivided and reversed source rings, final owner JSON, and a deliberately corrupted interval order.

## Limits that remain

The closure length is at most 0.5W. Approximately 0.499999523W² is the *additional closure charge* under the existing unchanged-ribbon ledger. Total pairwise geometric overlap is approximately 1.285577422W², including approximately 0.785577899W² of prescribed nominal corner overlap. These are different quantities. No claim is made that nominal overlap is physically harmless; extrusion multiplicity, deposited volume and over-extrusion remain unvalidated. Internal restart overlap remains outside the accepted toolpath contract.

Multi-level transition tests retain the W-long width-phase and shared W²/2 limits. Actual generated transitions remain rejected for substantive geometry/overlap reasons; the synthetic bottom-bank connector test does not establish an accepted spiral or global maximal continuity.

T-shaped cases certify finite perimeter routes, not full material allocation. Rectangle full-material allocation, the unselected 113-start corner coupon, variable/multiple-hole annuli, nonzero section-conversion error, general topology beyond the existing budget, and admissible spirals remain unresolved or unsupported. Native UI, production scheduling, G-code and physical printing are not validated by this suite. Historical full-model results are not current checkpoint evidence.

Original Frame and third-party license notices retain their terms. No historical reports, user models, screenshots, dependency caches or duplicate full workers are included.

Reconstructed core SHA-256: `c7ecdadcb9ca2fd67e019a2955fa81425fd0cc9bb2de4028b9a797226c979f7d` (sorted core JS/CJS basenames followed by exact bytes).
