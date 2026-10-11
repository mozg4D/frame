# Portable affine source contracts

Run from the extracted Frame project with Node.js 24 or newer:

    node editor-source/tests/affine/run-review.mjs

The runner returns nonzero on failure and emits a JSON report to stdout. To save
results, redirect stdout to a location of your choice. Tests do not write reports
into the project. The deliberate proof-corruption negative control creates and
removes a private operating-system temporary directory.

The aggregate preserves the original 73 lifecycle, worker, and display entrypoints
and adds independent focused-Escape, non-unit coordinate-input, and connected Stock
routing controls. `entrypoints.json` is the executable list and includes the required
`--acceptance` flag for pivot repair contracts. Individual tests can also be run
with Node using their paths.

## Exact production inputs

`source-paths.mjs` resolves `editor-source/build-manifest.json` to the production
editor/native bundles, the affine helper and known-geometry source, and the
existing Three core. Every source remains fail-closed against reviewed hashes.
Native module tests import the project's existing `native-source/` files. No
candidate copy, old editor bundle, or duplicate Three bundle is needed.

`fixtures/three-core.mjs` is only a small export adapter to the existing production
Three core. The independent stock oracle, selected-face oracle, frozen stock
functions, and stock provenance remain byte-for-byte unchanged. Historical Stock
routing source equality is checked against the SHA-256 pins of the same six frozen
V4k source ranges, instead of retaining a second entire editor bundle.

If a future intentional production edit changes a source hash, review that source
change and refresh its expected pins consistently before rerunning. Do not remove
integrity assertions merely to accept a different bundle.

## Scope

These are exact-source JavaScript/Node VM tests with synthetic UI events and
mocked renderer/resource/queue adapters. Worker controls include actual generated
Blob scripts executed by Node worker threads. Passing proves only those source
contracts. It is not browser end-to-end, physical GPU, visual, timing, or performance
acceptance.
