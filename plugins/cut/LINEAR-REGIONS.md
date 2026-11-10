# Standalone linear region validation

`linear-regions.js` exports `validateLinearRegions` and `REGION_LIMITS`. It is an unloaded CPU module for supplied, already-qualified Cut-local physical millimetre geometry. `plugin.js` does not import it. It adds no runtime API, native geometry capture, stored scene data, HASH records or serialization. Generate, preview, G-code position and Save remain unavailable.

```js
import {validateLinearRegions} from './linear-regions.js';
const result=validateLinearRegions({
  regions:[{id:'protected-bridge',kind:'No-cut',
    outer:[[4,-1],[6,-1],[6,1],[4,1]],holes:[]}],
  motions:[
    {id:'before',type:'line',from:[0,0],to:[2.9,0],tool:'Cut',lineWidthMm:2},
    {id:'bridge',type:'line',from:[2.9,0],to:[7.1,0],tool:'off',lineWidthMm:2},
    {id:'after',type:'line',from:[7.1,0],to:[10,0],tool:'Cut',lineWidthMm:2}
  ]
});
// result.valid === true; result.machineReady === false
```

This is a **region-only** check of explicit lines. `valid:true` does not certify work-area bounds, a connected route, initial head placement, source coverage, lead/restart safety, part dependencies, unknown machine blocks or machine readiness. Coordinates outside or negative relative to the work rectangle are allowed here: native projection and complete area validation remain separate future work, especially for travel. Each supplied line is independently checked; gaps between entries are never filled or treated as safe. Passes must be explicitly supplied, including every travel line and dwell. No ordering, routing, splitting, offsetting or automatic tool switching occurs.

## Geometric and motion contract

Each region explicitly supplies a unique `id`, `kind:'Avoid'|'No-cut'`, an `outer` simple polygon and `holes` array. Points are `[x,z]` in physical millimetres, without a repeated closing vertex. Winding has no significance. Holes must be strictly inside the outer ring, disjoint, nonnested and without touching or unresolved near contacts. Malformed polygons reject; no arbitrary even-odd interpretation, topology repair, snapping, clipping, polygon union, external geometry library or private offset engine is used. Different regions may overlap. Their protected filled sets combine by independent checks; Avoid always takes priority.

Each motion explicitly supplies a unique `id`, `type:'line'`, `from`, `to`, `tool:'off'|'Cut'|'Mark'` and nonnegative full `lineWidthMm`. Tool-off width is retained as metadata and does not make No-cut active. A zero-length line is occupancy/dwell at that point: Avoid still blocks it; active Cut/Mark still checks the radius disk. No duration or machine command is inferred. Nonzero arbitrarily short motion lines receive the same continuous check rather than being dropped.

Avoid rejects any head-reference point along the complete closed segment that enters, touches or is unresolved near its filled region, including both endpoints. This deliberately checks the head reference, without inventing a whole-head radius. It applies to every tool state.

No-cut permits tool-off motion. For active Cut and Mark it rejects the complete closed swept disk with radius `lineWidthMm/2` if its distance to the protected filled region is at most that radius plus the numerical working tolerance. This includes both round end caps and dwell disks. Exact tangency rejects conservatively, including zero width. A centerline that clears a No-cut bridge can still damage it through width or a restart end cap. The validator rejects that line; it does not find a bridge or restart.

Continuous segment/edge intersection and Euclidean closest distance use actual polygon edges. Membership checks also detect a filled polygon completely enclosing a segment without boundary crossings. Hole membership admits motion in the empty hole only when the entire swept disk clears all protected boundaries. Concave empty corridors remain usable where physically wide enough; bounding boxes are never substituted for geometry.

## Failures, immutable results and limits

All regions and motions pass structural, topology, numerical and complexity admission before collision results are constructed. Unsupported keys or arcs throw `CUT_REGION_UNSUPPORTED`; malformed records, missing fields, sparse values, invalid IDs/scalars and empty motion lists throw `CUT_REGION_INVALID`. Unresolved polygon topology throws `CUT_REGION_TOPOLOGY`; excessive numerical magnitude throws `CUT_REGION_PRECISION`; exceeded hard complexity limits throw `CUT_REGION_BUDGET`. Errors carry `code` and frozen `details:{path,message}`. A malformed suffix cannot produce partial successful validation. Empty region arrays are allowed and still cannot certify a route.

Geometric conflicts return `valid:false` and frozen diagnostics with `code`, `motionId`, `regionId`, `centerlineDistanceMm`, `sweptRadiusMm` and a message. One conflict per affected motion is reported: the first conflicting Avoid in input order, otherwise the first conflicting active No-cut. Distance is conservative computed filled-set distance, saturated to zero for membership or unresolved boundary proximity. Avoid diagnostics always use radius zero. The result includes all detached frozen input geometry, `scope:'linear-region-validation'`, `machineReady:false`, the tolerance and counts. Neither input arrays nor nested records are mutated or retained by reference.

The fixed working tolerance is `1e-6` mm. Polygon edges of length at most `4e-6` mm and nonadjacent ring contacts within tolerance reject; exact adjacent straight continuation is allowed. Coordinate and width magnitudes must be finite and at most `1e9` mm, and `16 * 128 * Number.EPSILON * max(1,abs(value))` must be at most the working tolerance. The latter is the tighter numerical admission envelope. The tolerance handles the admitted local arithmetic, not source approximation, native Float32 loss, projection error or a machine/material accuracy specification. Caller-supplied geometry qualification remains essential.

Hard limits are 64 regions, 128 total rings, 256 vertices per ring, 4096 total vertices, 4096 motions and 2,000,000 conservative pair-work units. Ring self-validation reserves `n*n`, ring-pair checks reserve `n*m`, and continuous motion checks reserve `3 * motionCount * totalVertices` for two membership scans and one distance scan. The aggregate is checked before collision evaluation, even if a collision could exit early. Work is bounded; over-budget inputs reject without producing a partial result. IDs are nonempty unique strings of at most 256 UTF-16 code units, independently scoped to regions and motions.

`linear-geometry.js` shares straight-segment distance/contact and simple-ring predicates with the prior [linear work-interval module](LINEAR-PATHS.md). It is a bounded predicate layer, with no arrangement or offset implementation. The work-interval module still rejects nonempty region inputs and performs no region validation on its own; a future route consumer must explicitly supply every actual movement to this validator.

## CPU verification

```text
node plugins/cut/tests/linear-regions.mjs
node plugins/cut/tests/linear-paths.mjs
node plugins/cut/tests/model.mjs
```

Use Node 22+; qualification uses Node 24. Region tests compare 400 deterministic random physical segments against a separate Liang-Barsky rectangle intersection and analytic distance reference. Analytic cases cover donut holes and reversed windings, diagonal vertex/edge near misses, enclosing filled regions without crossings, concave L shapes and narrow corridors, tool-off transit, repeated passes, zero-length dwell, tiny contacts, tangent end caps and bridge-width preservation. Admission, immutability and complexity failures are covered separately. Both geometry suites print SHA-256 for every transitive source dependency plus their test source.

Completed-call latency includes validation and immutable allocation: three 256-edge/2000-line calls must complete below 3000 ms; 1000 small calls below 1000 ms. Results print exact Node version, hashes and measured times. These are local CPU budgets, not hardware-independent guarantees. This stage runs no browser, GPU, shared, stress or heavy-scene tests. Parent integration owns those gates and publication.

Full evaluated source projection, source freshness, curved motion, shared Outline compensation, lead arcs, routing, automatic No-cut splitting/bridges/restarts, complete jobs, cancellation, preview and machine dialect/output remain future work.
