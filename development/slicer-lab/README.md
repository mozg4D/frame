# Independent slicer development

Self-contained computational geometry and Node worker tests for bounded annulus and T routes. This directory does not install a browser application or replace a production Frame worker. Physical extrusion, deposited volume, printing and production integration remain unvalidated. Accepted spirals: 0.

## Run from a Frame checkout

Node.js 20 or newer; no package installation or network access:

```sh
cd development/slicer-lab
npm test
```

The 43 sequential stages reconstruct pinned workers, check source hashes and syntax, and run synthetic geometry, provenance, owner/JSON, cancellation and regression controls. Failures exit nonzero. Logs and generated test outputs stay in ignored `evidence/`.

The checkout must contain `modules/slicer-worker.e120c24f46831ec5c53d.js`, SHA-256 `e120c24f46831ec5c53de96d5704b4942fef99771e3fe19268aa4915fba40475`. `worker-deltas.json` and `scripts/prepare-workers.cjs` reconstruct three hash-guarded development snapshots into ignored `core/` paths. Production files are only read; changed generated files are never silently overwritten. `SHA256SUMS` covers tracked sources and the worker-delta manifest, which contains the expected generated hashes.

## Verified bounded routes

### Convex annulus

Three synthetic 128-edge, exactly homothetic two-bank annulus layers at W = 0.5, 1 and 2 select 130 contiguous commands each: one external start, no internal restart/travel and no retained-worker fallback. The cumulative computational bound is at most 0.015626354W. This does not extend to arbitrary annuli, holes or variable-width walls.

Print laps are clockwise in physical right-handed XY, Z up, viewed from +Z. Known-square, worker/JSON/owner and ordered provenance tests cover direction, original edge/face identity, winding reversal, tessellation and corrupted interval rejection.

### Orthogonal seven-W T

The isolated owner route generates fresh commands for each source, recompiles actual ribbons/rounds/bevels/triangles, verifies its complete proposal and replays only its own immutable buffer. Three new contours at W = 1, 0.5 and 2 select 701 commands, five paths and four non-extruding travels each. Three clockwise outside-in laps precede two central paths. No first-contour cache or retained-worker fallback supplies acceptance.

Supported inputs have one closed orthogonal T, exact seven-W bar and stem widths, exact vertical source triangles, right-angle rotations, source-separated local domains (left stem coordinate >10.25W, right arm >5.75W, height >12.25W), and representable guarded finite geometry. Reversed winding and collinear tessellation retain actual finite triangle provenance. This route retains its exact-width gate. The separate decimal route below admits only bounded representation differences; these bounds do not prove smaller or other T classes impossible.

P is independently prescribed from original C: only the square-minus-quarterdisk regions of six exterior half-W corner squares are excluded. No other source material is removed. An all-point local certificate transfers the reviewed rigid regions; exact rectangle-union sweeps cover the remaining arbitrary-length straight regions. Actual feed is separately contained in C and P, and every fixed W/2 nozzle capsule remains inside C with zero exterior tolerance. Total directed construction error is below 0.02W (below 0.019600991463W in the included size controls).

Every width phase is at least W in planned and emitted coordinates; widths remain within 0.6–1.6W. Five entire initial constant-W runs have exactly zero foreign prior overlap. The four coupled final-event charges are approximately 0.5, 0.5, 0.5 and 0.491951029474 W². Each includes both owners, event self-pairs, late contacts, ribbons, rounds and bevels, without credit for removed overlap. Commands, turns and both owners of every charged area bind original finite source intervals and actual triangle normals.

Width necessity is conditional on this source-first bank/root allocation; other layouts remain open. Two constructed direct links reducing the route to three paths fail the unchanged coupled budgets at about 1.76777 and 2.12132 W². This bounded connector search does not establish maximum continuity. Further valid connector allocations and longer continuous paths remain improvement objectives; no global optimality or impossibility theorem is claimed.

Size tests extend arms/stem by factors 10, 100 and 1000 while keeping channels seven-W wide. They do not establish performance for wider channels, arbitrary branches or dense meshes. The budget/dispatcher fixture implements the existing Frame adapter contract with one owned test worker; it is not the production scheduling service.

### Representation-near seven-W decimal T

A separate decimal mesh-owner route uses original exact triangle-section banks. It admits orthogonal bar/stem dimensions differing from seven nominal W by at most W/2^36, with the same separated local domains, right-angle rotations, vertical triangles and finite-representation guards. The planning grid must also be exactly representable as finite coordinates; otherwise construction rejects before certification. This is a representation restriction, not general arbitrary-decimal or arbitrary-width support.

Two fresh full worker/JSON/owner/replay cases at W = 0.4 and 0.6 select 701 commands, five paths and four travels. Three additional W = 0.15, 0.2 and 1.2 cases establish complete geometry only, not mesh-owner acceptance. The two full-route cases have total construction error below 0.019605W. Full-route latency remains several seconds per layer; production/UI performance is unresolved.

The dyadic unit contour is a planning approximation, never a replacement material target. An exact monotone source witness translates each complete original rounded corner square and disk; its displacement is added to the full material-transfer and finite-construction budget. Actual emitted polygons must still lie strictly inside original C/P, and the fixed nominal nozzle must fit C. No numerical tolerance permits exterior material, nozzle intrusion, extra startup overlap or shortened width phases.

Exact collinear triangle subdivisions are removed only from geometric planning. Every emitted interval is repartitioned onto original exact triangle fragments, retaining face IDs, angles, normals and finite parameters. The owner independently reconstructs the section, program, complete coupled events and runtime, compares the entire packet, and replays its own immutable buffer. An optional one-entry owner memo requires an identical freshly verified section/job/generation.

Bounded arithmetic caches store only exact hull/intersection/directed-distance results keyed by complete translated and positive-W-normalized geometry. They do not cache first-contour acceptance, event ownership, source faces or coverage targets. Logical work limits still apply on cache hits. A conservative bit bound gates intersection reuse; otherwise the original clipper enforces its intermediate-rational limits. All retained map entries, including numeric rationals, count against an explicit cache-accounting budget; this is not a process-RSS limit. Cache/native checks use distinct contours and compare complete results. Low-level arithmetic helpers require finite positive W; mesh and ledger entry points enforce that precondition.

Equal odd channel-count preflight now constructs 5W and 9W examples, but their complete prescribed-material coverage is unproved and they select no commands. The 11W example exceeds the unchanged 1536-cell ledger limit and rejects. These controls do not establish general branch, composite-layer or complexity support.

## Compact synthetic certificate

`fixtures/T-local-material-certified-projection-v1.json` is a necessary 397,082-byte input, not a cached execution result. Its SHA-256 is `c03704f2bbce5f1e97b448b270270cd2863563d189c70c7295ffd44f3d7b0375`. Exact consumed-field equivalence to the independently reviewed full synthetic proof was checked. The loader pins both this projection and its original proof provenance. Current commands, events, phases, triangles and provenance are generated afresh. No historical owner receipt is needed by the public suite.

For optional provenance reproduction, run `node tests/T-material-projection-equivalence.cjs /path/to/original-synthetic-proof.json` with the separately retained original proof. `node tools/project-T-material-certificate.cjs --generate` instead performs a full synthetic proof from current sources and writes an ignored, **unreviewed** projection. This expensive optional generation mode is not part of the short suite and has not been run for this checkpoint. A new digest needs independent review; it never updates the accepted pin automatically.

## Remaining limits

Use the mesh-owner route for actual triangle/face authority. Geometric qualifiers now bind emitted command and turn intervals to their source plan; actual mesh identity and fragment ownership remain owner obligations.

The annulus closure charge, total commanded repeated area and pairwise intersection sum are different quantities. For the W = 1 fixture, the additional closure charge is about 0.499999523W², while repeated area is about 1.285577422W². Positive-area triple coverage makes pairwise sums differ from repeated area in general. These are two-dimensional polygon calculations, not physical deposition or flow certificates. Internal restart overlap remains outside the accepted toolpath contract.

Earlier T-body/cap/open-portal constructions remain useful rejected controls; their results do not describe the newer bounded T route. General adaptive-width necessity, decimal geometry outside the stated representation class, Y/X and other branch classes, inclined walls, arbitrary rotations, rectangle full-material allocation and admissible spirals remain unresolved or unsupported. Historical full-model results are not current acceptance evidence. No current complete real-model baseline, production integration, G-code or physical printing is certified.

Original Frame and third-party license notices retain their terms. No user geometry, screenshots, historical reports, dependency caches or duplicate full workers are included. Reconstructed core fingerprint: `9ea9e79aebe55061e637b1e137f9836406b6119d0946ce7b622db6aa14db757f` (sorted JS/CJS basenames followed by exact bytes).
