# Structural continuation: source-grounded work plan

Baseline: main 649c046723fc2d181e75d234c43ddf73f5165e75, checked 2026-11-09. The original structural.txt concept was read in full (2112 lines), including the opening correction to use Safety factor. The separate local PCG checkpoint and earlier structural-afe7d3de geometry/load/contact/topology research were inspected before edits. Current source/core/plugin files were compared to the main Git blob IDs; see the accompanying MAIN-SOURCE-AUDIT.json.

## Sanity decisions

- Keep the existing native icon, box, stored settings and Fixture/Preserve authoring. They already exist; recreating them adds no capability. No public Solve until real scene geometry, boundary conditions and results are qualified together.
- Retain one local grid and cache per Structural. Box transforms require an explicit SI coordinate contract: native object transforms are not automatically orthonormal physical FEM axes. Rotated/nonuniform boxes and unit conversion need dedicated oracle cases.
- Dirty geometry is best effort, not a claim of a unique interior for every open surface. Preserve unresolved occupancy and provenance internally; do not silently turn broad-phase boxes, ambiguous boundary cells or repaired polygon normals into authoritative solid material.
- Force/Torque are resultant wrenches about each native source pivot. Regions that cannot represent a requested moment need a defined internal outcome, never a changed physical load. Existing bounded load-mapping references should be qualified/reused rather than duplicated.
- Fixture overlap is defined before each independent load case. Frictionless non-penetration adds an active contact solve; a linear PCG pass alone does not implement it. Existing contact research is not a general-scene acceptance pass.
- Compliance/SIMP, yield-based Safety factor and stress are separate deliverables. GPU displacement convergence does not certify stress display, fatigue, buckling, contact, or topology. Runtime numerical data stays out of HASH.

## Parallel ownership and deliverables

| Direction | Existing work to retain | Next concrete deliverable | Dependency / gate |
| --- | --- | --- | --- |
| Plan and integration | Native preview, original concept, PCG and earlier references | This plan and corrected CORE-CONTRACT.md | Refresh main before integration; only coordinator changes shared files |
| Interface and icons | Native 32x32 icon, box, authoring settings, two marker tags | Once backend exists, native Solve/Optimize frame/animation actions with same-button Stop and Safety factor display | UI/API share one operation path; no fabricated result fields |
| Tags | Main's scalar parameter-tag validation/history/HASH | Multiple Force instances keyed by owner+UID; units/vector rows; effective inherited provenance | Shared core owner; atomic invalid writes, repeated tags, copy/merge/animation tests |
| Independent numerical lifecycle | Saved GPU matrix-free PCG checkpoint | Current local patch: exclusive bounded reads, scoped copy failures, shared disposal completion | CPU failure injection now; coordinated exact-source GPU rerun before promotion |
| Local domain and scene inputs | Preserved occupancy, box, load-input and body references | GPU clipped occupancy using actual borrowed core geometry and explicit owner/material provenance | Compare rotated/scaled domains, dirty meshes, nearest Material and independent overlapping Structurals; no CPU triangle mirror |
| Loads and fixtures | Preserved region-wrench and resolved-load reference | Qualified Force/Torque conservation and initial-overlap weld mapping across grid resolutions | Shared tag capture plus robust occupancy; analytical reactions and moments |
| Results and optimization | Saved CPU stress/topology/extraction references | GPU stress/Safety factor, runtime display; later shared animation topology and explicit Result to Object | Real scene Solve first; separate contact, memory and performance gates |

## Next qualification sequence

1. Review this small lifecycle delta independently. Run the original admission suite plus new delayed-map, scoped-copy-error and concurrent-dispose regressions; use the old source as a negative control.
2. Coordinator reserves one GPU slot after checking running jobs. Run the existing headless component gate on the modified source and current main; add real-device checks for pending diagnostic disposal and concurrent read rejection. Record source hashes, wall time and exact hardware. Never touch the user's working windows, OBS or printing.
3. Run focused native authoring tests; run required shared standard tests in the same reserved slot. Stress/large-scene verification belongs to subsequent geometry/rendering work, and must not be inferred from CPU emulation or tiny component grids.
4. Integrate only the approved delta, refresh main, repeat checks made stale by integration, then publish verified changes through the main chat. No concurrent edits to index.html, app.md, plugins.md, catalogue or shared tests.

## Current scope and blockers

This continuation changes only the isolated experimental PCG lifecycle and Structural-owned documentation. Existing installed plugin runtime, tags and UI remain unchanged. The older PCG hardware qualification does not transfer to the candidate. The GPU slot and shared integration/release gate have not been assigned in this task, so hardware/full-suite verification and main publication are pending. The saved reference remains intact. An extreme-aspect-ratio rank admission limitation is documented for separate numerical work.
