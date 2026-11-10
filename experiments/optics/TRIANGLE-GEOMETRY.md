# Bounded triangle geometry reference

This independent CPU experiment queries actual triangles in tiny authored test fixtures. It provides the geometric reference needed before nonsequential transport: a candidate surface comes from an intersection and closest distance, not a prescribed list of optics. No application module imports it; it does not capture native meshes, mirror Frame geometry, implement a scene solver or choose refractive media.

## API and units

```js
intersectTriangle(
  {originMm:[x,y,z], direction:[dx,dy,dz], tMinMm, tMaxMm},
  {id, surfaceId, verticesMm:[[ax,ay,az],[bx,by,bz],[cx,cy,cz]]}
)
closestTriangle(ray, triangles)
```

Coordinates and interval distances are millimetres in one physical Cartesian frame supplied by the fixture author. The nonzero propagation direction is normalized, so distance does not depend on the input vector magnitude. Both interval endpoints are finite and inclusive, with `0 <= tMinMm <= tMaxMm`. There is no implicit design box, automatic clipping or hidden origin displacement. A finite interval miss means no supported intersection in that segment of this fixture, not that power escaped an entire optical scene.

Triangle and surface IDs are nonempty fixture labels of at most 128 characters, not native object ownership or material-volume identities. Every triangle in a closest query has a unique ID. At most 256 triangles are accepted. Passive ordinary numeric fixtures are the supported input; executable getters/proxies are not a sandboxed transport. Closed-volume validation, native hash references, enabled participation and affine frame mapping are future adapter responsibilities.

Results distinguish:

- `miss`: no intersection accepted in the supplied interval under this reference's policy.
- `hit`: `triangleId`, `surfaceId`, physical `distanceMm`, `positionMm`, three vertex-order `barycentric` weights, winding `geometricNormal` and `frontFace`.
- `uncertain`: an explicit numerical/ordering limitation with a reason; consumers must retain unresolved power rather than claim clear line of sight or physical success.

The geometric normal follows vertex winding. Intersection is two-sided; reversing winding changes orientation metadata, not opaque-blocker participation. An optical interface caller must separately select the incident medium and orient the interface normal against propagation, as required by `interfaceResponse`. A winding normal by itself does not identify glass or the inside of a body.

## Algorithm and numerical policy

The implementation intersects the ray with a triangle plane, then evaluates barycentrics using a dominant-axis 2D projection. All arithmetic uses JavaScript binary64. This is an independently written fixture oracle, not copied third-party code. [PBRT 4, Triangle Meshes](https://pbr-book.org/4ed/Shapes/Triangle_Meshes) discusses plane/barycentric intersection and why robust edges require special treatment. Its watertight method and error-bound implementation are not claimed for this reference.

`GEOMETRY_EPSILON = 128*Number.EPSILON` is an explicit relative numerical policy. Near-parallel directions, skinny triangles, nonexact near-edge coordinates, nonexact near-interval-endpoint hits and poorly conditioned coordinate scales may be uncertain. Exact shared edges are inclusive. Exact degenerate triangles and invalid input are rejected; nonfinite arithmetic is rejected instead of becoming a miss. These filters are practical diagnostics, not a proven enclosure of all floating-point errors or an arbitrary-scale guarantee.

Closest-hit selection is independent of array order. Distinct surfaces with equal or near-equal distances are ambiguous. An exact same-distance seam can select the lexicographically smallest triangle ID only when the surface identity and winding normal/plane agree; a folded seam or inconsistent orientation remains uncertain. Surface labels do not repair geometric ambiguities.

Any uncertain candidate conservatively makes the whole closest query uncertain, even if it might lie behind another candidate. This deliberately sacrifices availability in difficult fixtures rather than silently dropping a possible blocker. It is not a performant general-scene strategy.

## Physical and geometric test oracles

Analytic plane distances and constructed interior barycentric points provide independent expected answers. Direction scaling, reversed winding, interval endpoints, out-of-plane misses and shuffled candidate arrays test geometry rather than material assumptions.

A triangulated square frame has a real central hole: a center ray misses triangles, while a frame ray hits from either side. Neither its bounding box nor a filled replacement quad participates. Synthetic Blocker accounting absorbs only a confirmed surface hit; hole/uncertain cases retain unresolved watts because this helper has no complete transport domain.

A reflecting-boundary fixture uses the existing interface-law reference at an air-to-index-1.5 boundary. The reflected branch has 4% of incident power at normal incidence; the transmitted 96% remains separate. The next closest query of the reflected branch travels back to an earlier plane, demonstrating geometric event order and return paths without a forward-only surface sequence. This is not an ideal 100%-reflecting coating model or a general transport/medium-stack test.

Additional checks cover shared edges, different-surface and folded-seam ties, coplanarity, degeneracy, numeric extremes, deterministic randomized constructed hits, input validation and bounded completed CPU-query latency. Random seeds, observed errors, source hashes and timings accompany the handoff. No GPU or native browser result is inferred from these tests.

## Integration boundary

The bounded linear scan exists only as a small-fixture independent oracle. Production Frame geometry remains GPU-owned and must use shared borrowed resources and an acceleration strategy; do not read a native scene into this helper or compare every production ray with every triangle. The function neither launches a background job nor owns persistent scene state.

Nonsequential transport, receiver sampling/accumulation, source-to-target attribution, media, absorption along segments, surface coatings, branching/termination, closed-volume validity, optimization and manufacturing remain open. Physical native capture must first resolve hidden-geometry versus enabled participation. No result here enables Solve, changes authored geometry, or certifies an optical design.

## Recorded CPU qualification — 9 November 2026

The delta is based on the previously delivered source-emission commit `28b3c6e`, whose base is published preview `cd90c4c`. Apply this delta after that source-emission delta in the coordinated batch. No native plugin, shared core, manifest, GPU or application behavior was changed.

Using installed Node v24.22.1, the combined focused run passed 55/55, zero failures/skips, total 1545.8801 ms. Fourteen new geometry tests were included:

```text
node --test --test-reporter=tap plugins/optics/tests/authoring.test.mjs plugins/optics/tests/power-ledger.mjs experiments/optics/reference.test.mjs experiments/optics/source-sampling.test.mjs experiments/optics/triangle-geometry.test.mjs
```

Two thousand seeded constructed interior hits had a maximum observed position error of 3.5527e-15 mm (seed 20261109). This local test observation is not a general geometric accuracy bound. The return fixture checks a nonzero 0.04 reflected power fraction and its reflected direction, with the other branch kept separate; it does not claim a complete energy-transport simulation.

One hundred thousand completed closest queries against eight actual frame triangles took 1404.38 ms against a 5000 ms CPU budget: 50,000 hits, 50,000 hole misses, distance checksum 250000 mm. Per-query fixture validation is included. This bounded CPU reference timing is not a production scene/GPU benchmark.

Both new module syntax checks and staged whitespace checks passed. Full npm test, stress, hardware/browser tests and publication were left to the coordinator. No user windows, OBS or printing were touched. Raw TAP output and exact source SHA-256 values are saved with the batch handoff.
