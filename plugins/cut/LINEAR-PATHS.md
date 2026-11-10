# Standalone linear work intervals

The companion [linear-region validator](LINEAR-REGIONS.md) now checks explicitly supplied local linear motions against Avoid/No-cut polygons with holes. It shares `linear-geometry.js` predicates but is not automatically called here. This module retains its nonempty-region rejection; constructing work intervals alone does not qualify travel or active swept-width protection. The focused test report hashes the shared predicate dependency as well as this module and its test.

`linear-paths.js` is an unloaded CPU module. It constructs actual straight work segments from explicitly supplied, already-linear geometry. It is not imported by `plugin.js`, registered with frameAI, or connected to Generate, preview or Save. The runtime remains the native authoring preview and returns `CUT_AUTHORING_ONLY`.

## Input contract

```js
import {prepareLinearPaths} from './linear-paths.js';
const intervals = prepareLinearPaths({
  frame: {origin:[0,0,0], xAxis:[1,0,0], zAxis:[0,0,1]},
  areaMm: [1000,1000],
  sources: [{id:'qualified-source', closed:false,
    worldPoints:[[10,0,20],[40,0,60]]}],
  mode:'Cut', passes:2, speedMmMin:600, lineWidthMm:0.2,
  planarityToleranceMm:1e-6,
  regions:[]
});
```

All coordinates and dimensions are physical millimetres. `frame.origin` is a world position. `xAxis` and `zAxis` are unit orthogonal world directions, admitting only `1e-12` length/orthogonality roundoff. The implementation normalizes those axes and removes the admitted orthogonality roundoff. Its head-side normal is `cross(xAxis,zAxis)`, or negative Y for the identity frame. Projection subtracts the origin and takes dot products against this rigid basis. Points are projected to the work plane only after their normal deviation passes the supplied tolerance. For linear edges, vertex deviations also bound the whole segment's deviation.

This is not a native affine matrix adapter. A future adapter for an ordinary positively scaled owner must supply normalized physical axes and **physically scaled** rectangle dimensions, and transform source points to world millimetres. A 1000 by 1000 owner scaled 2 by 3 has `areaMm:[2000,3000]`; its basis remains unit length. Passing scale vectors rejects. Shear, reflected native frames and ambiguous head-side conventions need explicit adapter qualification rather than an inverse scaled coordinate frame.

The caller must deliver qualified linear sources. There is no native scene traversal, spline/Extrude discovery, consumed-source deduplication, visibility evaluation, instance expansion, source freshness, or source approximation attestation. `id` identifies each supplied occurrence and must be unique. Sources must explicitly set `closed`. Closed inputs omit the duplicate terminal vertex; closure is implicit. Caller arrays are copied and preserved.

Supported geometry is open Cut, open Mark and simple closed Mark. Closed Cut rejects because waste-side compensation and safe lead-in are unavailable. Open Cut retains its centerline without offset or special lead-in. Mark retains the original lines and carries the supplied full `lineWidthMm` unchanged as metadata. It adds no compensation or arcs. Closed Mark retains its first vertex as the seam and reverses the remaining vertices when necessary so local X/Z signed area is negative: CW from the stipulated head side.

Unknown input, frame and source keys reject rather than dropping constraints. Nonempty `regions` and source `tags` explicitly reject. There is no Avoid/No-cut implementation. Lead-in options, curves and machine blocks are unsupported input, not ignored settings.

## Admission and numeric limits

Every source must pass before any operation objects are constructed. Empty input, invalid scalars, nonplanarity, any out-of-rectangle vertex, unresolved short edges, self-intersecting/touching/near-touching closed paths and degenerate closed area reject the entire call. There is no clipping, source dropping, snapping, welding or topology repair. Adjacent straight continuation is allowed; overlapping reversal rejects. Nonadjacent closed contacts within `1e-6` mm reject conservatively. Edges of length at most `4e-6` mm reject. Open paths may self-cross; no polygon topology or part/hole relationship is inferred. Separate sources are not tested for mutual collision or nesting.

`LINEAR_LIMITS` caps a call at 128 sources, 16,384 total vertices, 512 vertices per closed source, and 131,072 expanded operations (segments plus two interval events, multiplied by passes). Closed validation uses bounded pairwise segment checks; it introduces no arrangement/offset engine or geometry dependency. Finite coordinates/dimensions have magnitude at most `1e9` mm; speed must be at least `0.001` mm/min and passes a positive safe integer. These are computational limits, not a machine/material recipe.

For each projection, the conservative floating-point working allowance is `128 * Number.EPSILON * max(1, |world coordinate|, |origin coordinate|, |delta|)`. Calls reject if sixteen times this allowance exceeds either `1e-6` mm or the requested planarity tolerance. This excludes giant translations and features smaller than the working envelope. The largest allowance is returned as `projectionErrorBoundMm`. It covers this bounded projection calculation, not unknown source/evaluator error or native Float32 world-coordinate loss.

Rectangle checks compare computed centerline coordinates directly with `[0,width] x [0,height]`. A segment whose endpoints pass remains inside this convex rectangle. Exact computed boundary values are admitted without a fuzzy outside allowance; rotated boundary data may conservatively reject due to arithmetic. Boundary admission is not a physical containment proof beyond `projectionErrorBoundMm`. The full swept cut/mark width is **not validated**; positive width near an edge may extend beyond the rectangle. No machine/head envelope or source-surface accuracy certificate is implied.

## Output and integration boundary

The immutable result labels itself `scope:'work-intervals'`, `travelPlanned:false`, `machineReady:false`. `paths` contains projected physical points, actual lengths, unsigned closed areas, winding and measured normal deviations. `intervals` expands source order then pass order explicitly. Each interval has `tool-on` at its start, one `work-line` per real source segment, and `tool-off` at its end. Work lines carry `speedMmMin`. These are abstract geometry events, not interpreted or emitted machine commands.

No line joins separate sources or passes. An open repeated pass ends tool-off at the authored end and the next interval starts at the authored beginning. Its required return travel is unplanned. A consumer must not concatenate these into a machine-ready route: it must add and validate all travel, including initial head placement, and enforce exclusion regions, swept widths, part dependencies and restart rules. `workLengthMm` sums only active straight work across passes; it is neither total route length nor a time estimate. No job duration, route improvement or global optimum is claimed.

Still excluded: cubic flattening/error qualification, shared Outline bridge, closed Cut compensation, hole/waste classification, tangent lead arcs, obstacle/No-cut routing, bridges/restarts, machine blocks/dialect/G-code, complete jobs, revision fencing/cancellation, native preview and export. This standalone output does not establish runtime Generate readiness.

## Focused verification

```text
node plugins/cut/tests/linear-paths.mjs
node plugins/cut/tests/model.mjs
```

Use Node 22+; qualification uses Node 24. The linear test integrates actual operations independently against analytic 3/4/5 lengths, rectangle/triangle/concave areas, both windings, an asymmetric 3D rotated/translated basis and a physically scaled area. It verifies explicit passes/on/off, no joins/arcs/offsets, unchanged Mark width geometry, whole-source boundary failures, topology, precision/planarity, unsupported constraints, budgets and caller immutability.

Completed-call performance budgets include admission and immutable allocation: three 16,000-point open four-pass calls below 2000 ms, five 512-vertex closed Mark eight-pass calls below 1500 ms, and 1000 small open calls below 1000 ms. The report prints Node version, exact module/test SHA-256 and actual times. These are local CPU latency checks, not hardware-independent guarantees or geometry/machine safety qualification.

No shared, browser, WebGPU, stress or heavy-scene test is run by this test. Parent integration owns those gates when runtime changes warrant them.
