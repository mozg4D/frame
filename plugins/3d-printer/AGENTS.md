# 3D Printer

Follow the root AGENTS.md, plugins.md and requests.md. Keep runtime code in this directory and plugin checks in tests/index.mjs. The standard and stress runners discover these checks through the plugin catalogue.

- A printer is an ordinary independent scene object; creation must allow multiple instances. Parameters, transforms, visibility, animation, Undo and HASH belong to the core editor.
- Local +Y is the build direction. The volume is X/Z [-500,500] mm and Y [0,1000] mm. Exclude fragments outside the volume and on the bed from surface-angle warnings. Share the core GPU device, evaluated geometry and raster depth; never retain a CPU triangle mirror.
- The current warning is an immediate face-angle preview, not a slicing/support result. The core derives the visible-side geometric normal from raster derivatives without reading supplied shading normals or winding. For a closed object viewed from outside, this is its outward visible side. Open zero-thickness faces are classified on the viewed side; their material interior cannot be inferred. Top faces must not be classified as undersides. Respect mirrored/rotated frames and visibility. Bed exclusion includes 0.001 mm tolerance for Float32 projection reconstruction.
- Author the printer icon at native 32x32 pixels without scaling, using a subdued color. The layer controls have an 8 px gap after Layer position through the declarative breakAfter field.
- The user reset slicing to raw GPU plane intersections on 2026-10-23. The previous perimeter planner is removed. Machine output and the full planner are deferred.
- Attributes contain only editable controls and requested spacing. Diagnostics stay in the API/developer data.
- Each test checks observable editor or GPU behavior and useful completed-operation latency. Do not open a visible browser unless --headed was explicitly requested. Do not treat missing WebGPU as a pass.

## GPU raw sections, stage 1 (2026-10-23)

The previous perimeter planner has been removed at the user's request. Runtime is one file, `plugin.js`, plus the native 32x32 `icon.svg` and discovery metadata. No worker, external geometry code, repair, welding, deduplication, contour union, offsets, minimum-length/width filtering, perimeter generation or solid fill runs in this stage.

GPU transforms each current evaluated triangle into printer-local coordinates, computes its first and last active layer, and adds two counters to a layer difference array. Only this bounded metadata returns to CPU for prefix sums and output allocation. A second GPU pass writes raw plane/triangle intersections directly into compact 32-byte endpoint/width records, already grouped by layer. The default triangle-span kernel visits each source triangle once for counting, then once per output buffer; a per-layer GPU baseline is available through `slice {algorithm:'layer-scan'}` for measurement. No triangle or section coordinates return to CPU during slicing. Explicit bounded `inspect` diagnostics are the exception.

Layer 1 is sampled at Initial layer height / 2; later centers are Initial layer height + (zeroBasedLayer - 0.5) * Layer height. Half-open Y intervals handle vertices and coplanar faces consistently. Float32 plane comparisons correct span rounding. Input winding is ignored; duplicate, open, cracked, tiny and overlapping sections remain separate raw segments. At this stage X/Z boundaries do not clip sections or add boundary edges. The build Y window remains 0..1000 mm. The data is an unstitched linear spline-segment set, not ordered closed contours or printable trajectories.

The preview draws only native GPU line-list segments in subdued grey-green, at one physical pixel. Physical Line width is stored in each endpoint, and camera-facing butt-ended ribbon code remains in the same module for the next stage; no ribbon/polygon draw is submitted now. The three edges meeting at (-500,0,-500) identify +X red, +Y green and +Z blue even while selected. The face-angle warning remains independent.

Jobs are independent per printer and publish atomically after GPU completion. Cancelled/stale/failed jobs release unpublished buffers. Geometry, visibility, frame, line width and layer heights invalidate derived sections. Preview controls and Overhang angle retain them. Perimeters and Min path length are deferred planner parameters and have no effect in stage 1. First nonempty success initializes Finish; later success preserves/clamps it. HASH saves controls, not output buffers.

Limits are 4096 layers, eight million total raw segments and at most 64 MiB per output binding (also bounded by device limits). A single layer exceeding one binding or output beyond these bounds reports an API-only error; no partial result is published. Metadata readback is at most 16392 bytes, rather than section geometry. `peakGPUBytes` measures job-owned scratch plus retained output, not total adapter VRAM. `triangleVisits`, per-stage completed wall times and `metadataReadBytes` are available in status. Inspection reads at most 4096 segments for one selected layer.

Run `npm run test:slicer`, `npm run test:slicer:corpus`, `npm run test:slicer:performance` and the standard/stress suites. The current tests validate raw intersections; earlier perimeter/coverage acceptance no longer describes this implementation.

## Remaining slicer specification and architecture

The following is deferred backlog from the previous request, retained for future stages only. Stage 1 above intentionally does not implement these planner, filtering, clipping, repair, width or fill requirements.

### Ownership, coordinates and scale

- Own implementation in WebGPU/WGSL, without importing Cura, Arachne, Clipper, Three.js or another slicing/geometry runtime. Reuse native mathematical concepts and the shared core GPU resources rather than claiming the concepts are novel.
- Each printer is independent and may be arbitrarily translated/rotated with its ready-made assembly. Every slice, build limit and overhang computation uses that printer's local frame, with local +Y up. Never assume world Y is the build axis.
- Start with perimeters only. Example large-format envelope: 4000x4000x4000 mm, W=2 mm nominal extrusion width/nozzle, 1 mm layers. Speed and bounded RAM/VRAM are essential.
- Use the current evaluated GPU geometry, including transforms, instances and generators. No permanent CPU triangle copy and no parallel scene graph. Ignore supplied polygon normals and triangle winding. Tolerate duplicates, small cracks, degeneracy and moderate corruption with bounded repair; an arbitrarily open shell has no uniquely determined solid interior.
- Ignoring winding makes nested closed shells ambiguous: geometry alone cannot distinguish a cavity from a redundant contained solid. A proposed explicit convention is even/odd filling inside one mesh and union across separate scene owners. Validate that convention against incoming STL and the nested-shell fixtures before adopting it; do not infer fill intent from flipped normals.
- Print only inside the printer. Clip filled section regions, then ensure the entire deposited strip stays within the build envelope; clipping triangle candidates or center lines alone is insufficient.

### Proposed computation pipeline

1. GPU bounds and a coarse hierarchical height/slab index select triangle candidates for bounded batches of layers. Avoid scanning every triangle for every layer and avoid storing a full triangle-times-layer table.
2. Triangle/plane intersections produce vector segments. Use consistent half-open vertex/coplanar-edge rules, GPU compaction and a spatial index to assemble contours. Resolve filled areas independent of source normals, then union assigned solid regions and clip to the printer.
3. Retain vector boundaries as geometric truth. Use sparse adaptive 2D distance/nearest-boundary tiles to locate local thickness, opposing boundaries, medial branches and the places where perimeters meet. Refine results against vector segments; a raster/JFA approximation alone cannot certify topology or contour tolerance.
4. Jointly distribute bead count and width across neighboring perimeter cycles; do not repeatedly offset by W and patch the final tiny gap afterward. Use the local thickness/medial graph to distribute residual space before it becomes a thin final path.
5. Build a graph of feasible continuous connections and choose short travels with bounded optimization. Verify actual swept-strip coverage, intersections, voids and double deposition. Exact global travel/path-count optimality is not promised.
6. Simplify final vector paths while checking deposited-strip boundary error and joins. Stream completed results/output in bounded batches. CPU coordinates jobs, small metadata and serialization; expensive geometry remains GPU compute.

A full-bed fine texture is unsuitable: 4000/0.04=100000 cells per side at the nominal 0.02W tolerance for W=2 mm, or 40 GB for one float32 scalar channel of one layer. A full-volume high-resolution SDF/voxelizer is also unsuitable as the primary representation. A spatial hash is an accelerator, not the complete slicing algorithm.

### Path, width and corner rules

- Minimize total travel, number of separate trajectories and output segment count. Prefer continuous perimeter spirals. Prefer clockwise traversal consistently, viewed from local +Y toward the build plane, because reversing traversal direction can expose printhead backlash as bands. Topology/necessary local return motions may require explicit exceptions.
- Prefer approximately 45-degree planar connections between successive perimeter loops. This is not continuous-Z vase mode. Disconnected islands, holes or branches can require separate paths or another feasible connection angle.
- Width normally lies in 0.6W..1.5W. A 1.5W-wide strip gets one 1.5W bead; a 1.6W-wide strip gets two 0.8W beads. Coordinate bead-count transitions along the shape so noise near a threshold does not generate short alternating branches.
- For an isolated narrow feature with total available width 0.6W..1W, still extrude 1W to avoid a fragile wall. This is an intentional local exception to surface accuracy; it does not prohibit two 0.8W beads inside a 1.6W region. Do not invent a geometric tolerance guarantee for this widening.
- Filter out an entire ordinary extrusion trajectory whose total length is below 3W. The user prefers a small void to a short micro-path. Minimize sub-1W segments and avoid short width/count-transition regions, while distinguishing a whole trajectory from segments needed to approximate a curve.
- A single-perimeter loop overlaps start and finish by 0.2W. Distribute the final residual space among the last two or more perimeters.
- Normal geometric target: 0.02W maximum boundary error and similarly good joins between neighboring strips. At sharp bends a larger deviation is acceptable when 0.02W would require excessive segment counts. The exact relaxation policy still needs definition and validation; prioritize well-joined printable lines over microscopic detail.
- For a corner sharper than 45 degrees: approach, expand sharply up to 1.5W touching both boundaries, taper toward the tip to 1W, continue at 1W until available space narrows to 0.6W. On the return, apply the requested 0.1W pressing over 1W length so the nozzle does not pull the tip off the bed, return to the expansion point and broaden as needed to avoid voids. Preserve this explicit exception to ordinary minimum length/width constraints. The physical meaning of 0.1W in the motion/extrusion representation still needs to be made precise; the user clarified its purpose as light tip hold-down during return, not ordinary gap filling.
- Constant volumetric flow is the intended future process model, with travel speed varying with bead width. Do not implement process/pressure control now; first show correct geometric trajectories. Physical corner behavior needs print samples later.

### Rendering, warnings and controls

- Expect extremely many segments. Render directly from compact GPU buffers with bounded visible-layer work and minimal draw overhead; never create an object or CPU-expanded quad array for each segment.
- Camera-facing planar rectangles with straight butt ends, no round caps. Render a strong brightness gradient across each strip: a dark edge, most of the rectangle bright and nearly uniform. Display geometry is separate from the real swept strip used for coverage validation.
- The editable Overhang angle controls both the geometry-warning shader and future toolpath colors immediately, without reslicing solely to change the angle. Do not hardcode 45 degrees; it is the default.
- For sliced paths, compare actual deposited strips against support from the preceding layer in printer coordinates. For a threshold below 90 degrees, allowed lateral growth is layer height times tan(threshold); at 45 degrees it equals layer height. The bed supports the first layer. This is distinct from the immediate pre-slice face-angle preview.
- Add a normal Attributes Manager Slice button at the top of printer attributes when a real slicing operation exists. The user also spelled it splice; use the ordinary English Slice label. Display extremely short slicing progress immediately to the left of that button, never verbose logs. This is the user's explicit future exception to the general Attributes-no-progress rule; it is not authorization to add progress to other controls.
- On the first successful slicing, initialize Finish layer to the actual last layer. Subsequent successful slicing preserves the user's chosen finish layer; define clamping if it exceeds the newly generated range. Failed/cancelled jobs do not consume first-success initialization. Preserve the small gap following Start layer / Finish layer / Layer position.

### Adversarial corpus and acceptance

Keep the deterministic recipe and checks under this plugin's tests directory. The generated scene belongs in the shared tests/scenes directory and includes: a tapered rounded stub ("ogryzok"), acute/concave stars, strips around 0.6/1/1.5/1.6W, nested shells/volumes, disconnected islands, acute tips, tiny paths, holes, sloping undersides, duplicates, flipped winding and moderate cracks/missing faces. Retain named objects for identifying failures. tests/scenes/test.stl is the user's real-world incoming print-data example; never modify or replace it, and include it as a reference in the corpus manifest.

Future tests must check strip coverage/voids, adjacency error, bead width/count transitions, short-path filtering, clockwise preference, spiral connections, arbitrary printer frames, normal independence, build clipping, overhang-angle updates, stale-job rejection, first/subsequent Finish layer behavior, total wall time, peak memory and segment-render CPU/GPU times. These full-planner acceptance checks apply only when that future stage is requested.
