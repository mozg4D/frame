# Gizmo rules

The gizmo is object-agnostic. The same transform rules apply to meshes,
splines, generators, instances, nested objects, and skewed objects.

## Reference frame

- The gizmo origin is the object's pivot (or the shared pivot of a selection).
- **Object** mode uses the pivot's local axes.
- **World** mode uses world axes.
- All transforms preserve the complete affine matrix, including skew.

## Move and rotate

- Axis and plane handles move in their displayed coordinate frame.
- The upper white handle moves in the screen plane.
- Vertex snapping is calculated from the gizmo origin, not from the cursor or
  the white handle.
- Moving changes Position. Rotating changes Rotation, but not Position.
- Quantization is measured from the transform's starting state.

## Scale

- Scaling always happens around the pivot and never translates the pivot.
- Axis scale follows the selected World/Object coordinate frame.
- Uniform scale uses the central handle, ignores spatial snapping, and only
  applies scale quantization.
- Size cannot be negative.
- In Pivot Mode, scale still scales the object; Pivot Mode only changes the
  behavior of move and rotate.

## Pivot Mode

- Move and rotate edit the pivot frame while keeping geometry fixed in world
  space.
- Coordinate Manager Position and Rotation edit that same pivot frame.
- Multi-selection edits the shared pivot without moving selected geometry.

## Coordinate Manager

- Position and Rotation describe the pivot in the selected World/Object frame.
- Object Size is measured along object axes.
- World Size is the world-axis-aligned bounding-box size, so it may change when
  the object rotates.
- A mixed multi-selection field displays `multiple`; entering a value applies
  that component to the selection.

## Component modes and history

- Components are editable only for editable polygon meshes and spline control
  points. Procedural geometry and Spline Patch surfaces fall back to selecting
  the whole object.
- Every completed gizmo or Coordinate Manager operation is one undoable action;
  undo and redo restore both object and pivot transforms exactly.


## Surface pipeline

All application JavaScript lives in `index.html`; Three.js 0.162.0 and optional format loaders use the existing CDN import map. The environment texture is embedded.

- `FrameCageCells`: combinatorial shell selection from spline vertices and cubic segments; rejects planar internal cuts with incident curves on both sides. No primitive-type switch.
- `FrameSurfaceKernel`: mathcode and meshcode from surface_unified_r6e91. Curved cells use its advancing front and cross-tangent interpolation. Planar contours and holes use Three.js triangulation.
- `buildSplineSurface`: reuses angle-approximated boundary samples; shares node and segment/sample IDs across cells, validates edge incidence, degeneracy and winding, and orients closed surfaces outwards.
- `cmdParametricToSplinePatch`: Cube/Sphere/Cylinder/Tube become a Spline Patch with one ordinary editable spline child. The parent keeps its identity, transform and tags. Undo restores the primitive.
- `evaluateSplinePatchNode`: rebuilding is driven by child spline data and its transform. No retained primitive semantics or radial-normal override.

At the default angle, expected cell counts: cube 6, sphere 8, cylinder 6, tube 10 (including two planar annuli). Cylinder has four vertical cage segments; tube has four outer and four inner segments.

Validation: 24 geometry cases across 1/3/10/30/90/180 degrees, plus application DOM tests with real Three.js geometry for conversion, transformed objects, cage edits, Undo/Redo and native scene serialization. WebGL rendering is mocked in these DOM tests; they do not establish visual browser correctness. Cell selection remains combinatorial, not a proof against arbitrary self-intersections. Curved cell sides currently correspond to cubic cage segments; supported curved cells have 2–6 sides.

## Current curved-cell meshing

Curved 2–12-sided cells use the local snake front with immutable perimeter
samples. Interior spacing is independent of perimeter segment lengths.
A fixed map uses 64 surface positions (66 for triangles); normals and their UV
derivatives reuse those positions. Cached differentiation/interpolation weights
produce a directional metric, including mixed curvature. Triangles and quads start
at one complete boundary edge and advance in alternating rows. The previous row
is traversed sequentially with two candidates and no spatial search. Other domain
types retain the local tail cursor. Convex quads choose their diagonal once when emitted. Triangle-normal
feedback and all post-build swaps are disabled. This is approximate angular resolution for
moderately curved cells; features between probes can be missed. Self-intersections
remain authored geometry.
Interactive meshes are emitted before global QA; deferred checks preserve every
vertex and index. The existing per-cell worker/cache ownership
and stale-revision guards remain. See tests/README.md for tests and measured
throughput; the 5 M triangles/s target has not been reached.

### Temporary spline mesh stepping (2026-09-11)
Play now inserts the next interior mesh point; Next key completes the remaining
triangle/quad rows. Play after completion restarts inspection. Rows all travel
in one direction. Linear 64/66 probe estimates include the domain boundary;
boundary normals are extrapolated from interior probes without inserting mesh
boundary vertices. No post-build swaps. See tests/README.md for validation and
remaining performance/quality limitations.

### Point reuse experiment (2026-09-11)
Play now adds one point together with its joining faces; no debug text overlay.
Next key is restored to its ordinary timeline action. Triangle/quad spacing now
incorporates normal estimates from already accepted row/tail positions, with no
extra surface calls beyond the initial probe map. Row-wide spacing is still an
approximation; this experiment increases depressed-sphere density. See tests notes.

### Curvature correction (2026-09-11)
Interpolate signed normal derivatives before squaring; locally verify strong
cancellation using cached surface probes. Reliable row estimates replace the seed
without a fixed blend. Match the two local tail candidates by 3D distance.
The common transverse row height remains approximate. See curvature-cancellation
regression and tests notes for measured correctness/performance limits.
