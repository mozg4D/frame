# Magneto bounded CPU reference core

This folder is an isolated CPU reference continuation, not an installed Frame plugin or a release. A separate native Magneto authoring preview already exists in main, with Solve disabled (coordinator-audited main anchor 649c046723fc2d181e75d234c43ddf73f5165e75; runtime blob fe2ca2ebe251ed60f57eabc09bce5408135fbf54). This CPU work neither changes nor republishes it. The prior candidate known only as 1f1eb902 remains historical unrecovered evidence. The original 41,657-byte specification SHA256 is 4af36eb3073313a02243d5269cb938f9ac88e1f427408d7a65f242b7b91ab77e. No upload retry, shared-batch modification, Git/main/live publication, GPU/browser work or user-window interaction was performed in this continuation.

## Implemented

- physical-state.js: opaque backend-lease lifecycle with fixed physical baseline, convergence-gated atomic commit, same-time replay, cancellation, stale rejection, reset and explicit checkpoint restore.
- direct-kernel.js: bounded three-dimensional regularized dipole interactions, energy-consistent analytic forces/torques, selected-group internal cancellation, prescribed-current quadrature fields and magnetic-dipole loads.
- materials.js: explicit-parameter soft tanh saturation and hard reversible/vector-play remanence. These are synthetic reference laws, not calibrated named presets.
- reference-solver.js: at most 128 explicit weighted local magnetic samples, rigid local/world transforms, equivalent-sphere diagonal demagnetization, nonlinear residual solve with backtracking, signed prescribed-current scaling/cache, lifecycle session and fixed-moment resultant loads.
- conductor-current.js: at most 32 nodes/64 explicitly supplied oriented flux-tube edges, closed Kirchhoff flow, signed cut normalization and minimum Joule dissipation; optional explicit geometry-to-currentBases quadrature mapping. See conductor-current.md for the average-density model and topology/scale restrictions.

Read the per-module notes before use. SI units are mandatory. No source geometry is read from native Frame. No CPU mirror of GPU triangles or magnetic sample buffers is created. The small CPU arrays here belong only to the numerical reference backend.

## Verification

npm test runs all CPU suites. npm run verify records exact source hashes before/after, TAP output, test counts and completed-operation performance in results. Independent review tests remain in the suite, including previously reproduced ownership, stale-state, overflow and cache-provenance defects.

Textbook/independent checks cover magnetic sphere demagnetization, a separate nonlinear scalar root, dipole far-field limits, force/rotation energy derivatives, action/reaction, rigid covariance, signed current-ring fields/gradients, weak/strong/partial magnetizing pulses and retained remanence. Agreement with the chosen regularized equations is not proof of arbitrary finite-body or production accuracy.

## Not yet implemented or qualified

- Native LDI/parity preprocessing and automatic weighted sample generation.
- Actual material presets from validated manufacturer curves.
- Arbitrary native/polygonal closed-conductor current-density cut/topology preprocessing and solve. The explicit graph oracle is only a bounded numerical component.
- Hybrid near/far GPU solver, spatial convergence and tiny-gap qualification.
- Production field rendering and solver-state integration with the separate native Magneto tag/plane authoring preview.
- Solve Animation event/refinement/checkpoint/curve integration.
- Browser/hardware/full Frame aggregate testing and release.

preview-contract.json and preview-integration.md describe this folder's uninstalled CPU boundary and remaining native solver adapters. NOT_INSTALLABLE applies to this folder, not to the separately published authoring preview. Native Solve must not be represented as ready until its missing adapters and gates exist.
