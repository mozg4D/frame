# Independent slicer, checkpoint 13

Unintegrated development source. **Accepted complete layers: 0. Accepted admissible spirals: 0.** These files do not replace the live Frame worker or provide a separate browser application.

## Run from a Frame checkout

Node.js 20 or newer is required. No package installation or network access is needed.

```sh
cd development/slicer-lab
node tests/run-public-checks.cjs
```

`npm test` runs the same checks. The runner first reconstructs three exact checkpoint workers under ignored `core/` paths, then checks source integrity, syntax, reconstruction guards, contour regression, accuracy bounds, synthetic geometry and exact SAT, mesh/JSON/owner verification, rejected return-turn seam, local corner fan, and serial/helper/cancel worker equivalence. Generated logs stay in ignored `evidence/`. Failure returns a nonzero exit status.

The checkout must contain `modules/slicer-worker.e120c24f46831ec5c53d.js`, whose complete SHA-256 is `e120c24f46831ec5c53de96d5704b4942fef99771e3fe19268aa4915fba40475`. It is the byte-exact upstream checkpoint worker. No duplicate full workers are stored here: `worker-deltas.json` retains readable, byte-offset edits for candidate and optimized workers, plus expected sizes and SHA-256 values for all three generated files. The builder validates the pinned source, every edit, and every reconstructed hash before writing. It refuses to overwrite a changed generated file. Production files are only read.

`SHA256SUMS` covers tracked sources, including the delta file and its expected generated hashes. Generated worker paths are deliberately absent from that manifest. Run `node scripts/prepare-workers.cjs` to reconstruct them separately. After intentional source edits, regenerate checksums for the new checkpoint.

## Contents and limits

All 51 original core files are preserved exactly: 48 tracked modules and three byte-identical reconstructed workers. The public test set includes nine synthetic checks, a reconstruction check, their runner, and required helpers. Original Frame and third-party license notices retain their terms. Historical diagnostics, illustrations, reports, receipts, user models, screenshots, dependencies, and caches are omitted.

The T-shaped test selects 42 commands for one finite perimeter, but does not certify a complete layer. Flat 3.4W allocation remains rejected for missing original material. The alternate 1.7W seam remains rejected at about 1.70552628 W² joint charge, above the 0.5 W² limit; the default seam remains rejected at 0.575 W².

The corner fan is an unselected local coupon with 113 unqualified starts and an analytic computational bound of about 0.01887944494305048 W. Continuity, overlap/order, whole-route width necessity, complete material allocation, and corner mesh-face ownership remain unresolved. Internal restart overlap remains outside the accepted toolpath contract.

These checks do not establish browser/UI/GPU acceptance, production integration, general thin/acute/branching support, or physical print validity. Historical full-model results are not fresh checkpoint 13 evidence.

Reconstructed core revision SHA-256: `fa5f3f388e125af9d16ad471fc2c3b25990c6ed6fdef2868503de61157798d9d` (sorted core JS/CJS basenames followed by exact file bytes).
