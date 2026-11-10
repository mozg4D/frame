# Bounded opaque transport reference

`fixture-transport.mjs` connects the independent triangle reference to terminal-power accounting for one ray in tiny CPU fixtures. Each next event is selected by actual closest intersection. It supports return paths and repeated reflections without a prescribed surface sequence. No Frame module imports the experiment and no native geometry is read.

## API and models

```js
traceFixtureRay(
  {originMm:[x,y,z], direction:[dx,dy,dz], powerW},
  [{id, surfaceId, verticesMm:[[ax,ay,az],[bx,by,bz],[cx,cy,cz]], model}],
  {maxInteractions, maxPathMm}
)
```

The nonzero direction is normalized using the existing reference. Positions and physical path length are mm; power is finite nonnegative radiant watts. The existing geometry limit is 256 triangles, with unique triangle IDs and bounded surface labels. All triangles of a surface must declare the same model. Complete fixture/model validation runs before transport, including for zero watts or zero interaction budget.

The four explicit synthetic models are:

| Model | Event |
| --- | --- |
| `blocker` | Absorb all incident watts at the actual triangle, from either side. |
| `ideal-mirror` | Reflect specularly with ideal R=1, T=0, A=0; continue with unchanged watts. |
| `receiver-useful` | Terminate and assign watts to the fixture's useful receiving region. |
| `receiver-unwanted` | Terminate and assign watts to the fixture's unwanted receiving region. |

These are ideal benchmarks, not calibrated glass, metals, coatings or sensors. Receiver labels are fixture-authored classifications, not automatically inferred image mappings, irradiance targets, or proof that every requested target is served. No model is assigned from viewport appearance or object proximity.

The mirror reuses the existing interface reference's geometric reflected direction. Index-matched scalar arguments to that helper are used only to obtain direction; their Fresnel coefficients do not define the ideal mirror. The benchmark independently declares R=1. [PBRT 4, Specular Reflection and Transmission](https://pbr-book.org/4ed/Reflection_Models/Specular_Reflection_and_Transmission) treats direction laws and transferred fractions separately. This model does not implement lossy or dielectric branch transport.

## Geometry and self contacts

All triangle tests and nearest-hit ordering reuse `triangle-geometry.mjs`, including its explicit heuristic uncertainty. It remains a bounded CPU fixture scan, not a production GPU traversal strategy. Actual holes stay holes; there is no bounding-box replacement or automatic Design Space wall.

Each segment queries from the exact previous hit point with `tMinMm=0`. It may suppress only an exact zero-distance hit on the previous surface with a compatible winding normal. A planar triangle cannot be crossed again farther along that same noncoplanar straight segment. Suppression is recomputed for the next segment, so the same surface at positive distance remains eligible. Different-surface, incompatible-normal or initial zero-distance contacts stay unresolved. Near-zero or uncertain cases are never discarded as self hits.

There is no positional nudge and no positive global exclusion interval. A nearby distinct surface can therefore still obstruct the ray; a numerically unresolved thin gap stays unresolved. Exact-only self-contact suppression is conservative and may fail to continue general floating-point bounces. The inherited epsilon/conditioning filters are not certified visibility or watertight error bounds.

A concrete unqualified routing case is recorded: an incident +Z ray should reflect at the plane x+z=5 and reach a receiver at x=-3. The current kernel calls the receiver parallel to the initial ray uncertain even though it is noncoplanar. Transport stops before any event, with zero useful watts and all watts unresolved. The regression verifies this honest limitation; it does not count the physical 90-degree route as solved. A guarded noncoplanar-parallel miss predicate and stronger bounce-point handling are needed before general oblique transport can be accepted.

## Budgets and output

`maxInteractions` is an integer from 0 to 64. It counts confirmed positive-distance interactions, including terminal receiver/blocker hits. `maxPathMm` is a positive finite physical path budget. An exact endpoint receiver/blocker event can terminate; reflection at that endpoint leaves the continuing ray unresolved. These bounds control work; they do not certify convergence or optical quality.

The compact output contains `emittedWatts`, `usefulWatts`, `unwantedWatts`, `absorbedWatts`, `escapedWatts`, `unresolvedWatts`, `eventCount`, `pathMm`, `reason`, and false `solverCertified`/`physicalQualified` flags. There is no retained ray, vertex, event or path history. The bounded temporary candidate list contains only caller-authored fixture references.

All original watts end in exactly one terminal category. Geometry uncertainty, an unclassified contact, no hit in the finite examined segment, and exhausted interaction/path budgets preserve all remaining watts as unresolved. `escapedWatts` is always zero because this reference establishes no global escape domain. In particular, a miss within a finite interval is not proof of escape beyond that interval.

`pathMm` records examined physical travel, including a no-hit free-flight segment up to the remaining path budget. An uncertain segment stops at the last confirmed event. It is not refractive optical path length, an optimization objective or optical energy. A balanced aggregate alone does not certify correct geometry, source membership or target performance.

## Architecture and remaining work

Inputs and results are transient passive test data. This delta adds no persistence API, document record, HASH field, serializer or JSON scene payload. The new architecture requirement forbids JSON scene data in HASH; any future native authoring integration must use an agreed typed representation rather than saving these fixture objects as JSON. The experiment is not a second saved scene graph.

Native capture, transforms, enabled/hidden participation, shared GPU acceleration, cancellation/device loss, real material/coating properties, refractive media, branching/Fresnel transport, bulk absorption, escaped-power proof, full source/receiver attribution, Imaging, optimization and manufacturing remain open. Production geometry must stay GPU-owned. Runtime Solve remains unavailable.

Focused checks cover direct finite receivers, two-sided Blocker, actual holes, reflected return to an earlier plane, repeated-reflection budgets, ordering, uncertainty, exact self contacts and nearby obstacles, complete input validation, and streaming source watts checked against the existing ledger. Qualification records and raw output accompany the batch handoff. Hardware and common suites remain in the coordinator's queue.

## Recorded CPU qualification — 9 November 2026

This delta follows geometry handoff `c3a9f51`, which follows source handoff `28b3c6e`, on preview `cd90c4c`. Apply in that order. Using Node v24.22.1, the combined CPU run passed 69/69, zero failures/skips, in 1561.5541 ms, including 14 new transport tests:

```text
node --test --test-reporter=tap plugins/optics/tests/authoring.test.mjs plugins/optics/tests/power-ledger.mjs experiments/optics/reference.test.mjs experiments/optics/source-sampling.test.mjs experiments/optics/triangle-geometry.test.mjs experiments/optics/fixture-transport.test.mjs
```

| Fixture | Observed result |
| --- | --- |
| Ideal axial mirror return to earlier receiver | 5 mm, 2 events, 8 useful W |
| Same-surface-label mirror cavity | 635 mm, 64 events, 8 unresolved W at interaction limit |
| Collimated source N=1,16,256 | Fixed 8 useful W each; independent ledger residual 0 W |
| Blocker 1e-10 mm from mirror, starting between them | 2 events; all 8 W absorbed after reflection, no lost obstacle |
| Unqualified 90-degree routing | 0 events, 0 useful W, 8 unresolved W because of the inherited parallel-candidate limitation |

The passing limitation regression verifies an explicit unresolved result; the physical 90-degree route remains unqualified. Ideal benchmarks and bookkeeping do not establish production optical quality.

Ten thousand completed traces through an eight-triangle frame, including complete fixture validation and accounting assertions, took 642.22 ms against a 5000 ms CPU budget. Totals: 15000 absorbed W, 15000 unresolved W, 125000 mm examined path. These totals are accounting checksums over independent benchmark calls. No ray/event histories were retained. This is bounded CPU reference timing, not GPU or full-scene performance.

Both new module syntax checks and staged whitespace checks passed. Runtime imports, application UI, common files, HASH persistence and scene serialization were unchanged. Full npm test, stress, hardware checks and publication remain with the coordinator. Raw TAP output and source SHA-256 digests are included in the handoff.
