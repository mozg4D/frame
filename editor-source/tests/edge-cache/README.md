# Compact edge-cache controls

Install this directory as `editor-source/tests/edge-cache/`. From the checkout:

```sh
node editor-source/tests/edge-cache/run-review.mjs
```

For a separate review checkout, pass its root as the optional final argument.
The command uses Node built-ins only, prints one JSON report to stdout, exits
nonzero on failure, and does not write files, rebuild product assets, install
dependencies, use the network, or require TypeScript/a JavaScript parser.

## Inputs and exact historical oracle

`inputs.mjs` reads `editor-source/build-manifest.json` and resolves its
`productionNative`, `nativeSHA256` and `threeCore` against the checkout root.
It verifies the exact reviewed final production native SHA256
`2e5af192ec3642b662cb54e98483b224dc6f124a68709ad0d0cfdc76b0fb0c85`.
The candidate tested in every suite is this final production bundle.
The relevant public functions and private compact-generator declarations are
also bound to the checked-in `native-source` modules.

Only the two small frozen reverse-edit oracles are retained. The loader reverses
the metadata edit set in memory and verifies the complete accepted intermediate
SHA256 `2e10321a8de53806ff34fc7591ce38353cd17a2812cecc6c95f0eefc41741eef`.
It then reverses the compact-cache edits and verifies the complete original
baseline SHA256 `4ab552e1b39abbd2b4bab7ebfdb8f6f9ae6245c862bcdd8e687a25e20e0b9463`.
Each inverse edit must match exactly once. Both complete versions are imported
directly from memory. No historical native bundle, candidate runtime copy, or
Three bundle is included in this directory. Three is loaded from the manifest
and verified against the accepted core SHA256.

## Preserved coverage

- Semantics: 46,550 exhaustive/adversarial/precision/topology fixtures, independent
  string-key oracle, exact encounter/alias order, numeric safety threshold,
  cooperative yields, 16 malformed inputs and 100 public-cache integration cases.
- Ribbon: 2,160 exact differential rank cases, analytic scan/tie/radius controls,
  mock-device protocol, ROI/uniform/instance ordering, resource cleanup, stale
  and abort paths, complete baseline-versus-current prepare/ribbon/session public
  results, CSS grid/identity maps and reopened warm sessions.
- Lifecycle: all 14 controls for complete source comparison, view ranges/private
  snapshots, byte budget, shared storage, identity replacement, cancellation,
  concurrency, per-session GPU cleanup, invalidation, dispose while opening, and
  latest-request replacement.

The original full-session baseline oracle is preserved; it is not replaced by
an adapter over current code. The only semantic assertion adjustment is the
approved new `edgeFirstCorners` topology field: its type and length are checked,
then every original topology field is still compared exactly with the baseline.
The detailed metadata semantics have their own separate Connected/CM controls.
Original fixture loops and behavioral assertions otherwise remain intact.

## Boundaries

These are CPU/source/synthetic mock-device controls. They do not establish real
WebGPU raster behavior, browser or real-model acceptance, or performance. The
numeric-key threshold controls reserve large zero-initialized typed arrays; the
runner permits 1024 MiB JavaScript heap per child process. No test result file is
created automatically; redirect stdout yourself if a saved report is wanted.
