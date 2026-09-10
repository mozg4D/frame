# Spline surface checks

Run from C:\frame:

```
node tests/geometry.cjs
node tests/deformation.cjs
node tests/worker-startup.cjs
node tests/cached-surface.cjs
node tests/metric.cjs
node tests/adaptive-diagonals.cjs
node tests/cell-chunks.cjs
node tests/local-invalidation.cjs
node tests/cage-restoration.cjs
node tests/surface-sampling.cjs
```

`browser-cages.js` defines `testSplineCages()`. Execute in an isolated app tab
through the development console/CDP; it resets that tab's scene. It covers
cylinder/tube straight handles, deformed caps, multiple/nested shells, deep
folds, undo/redo, unchanged-cell caching and rapid edits at 1 degree.

`metric.cjs` checks physical density on an egg-shaped triangular patch, and
3-, 4-, 5- and 6-sided patches at 10 and 1 degrees. Boundary points are immutable;
scale and translation must not materially change density. In three equal-height
bands, meridian/interior triangle density ratios are 1.27, 1.44, 0.97 (previous
algorithm: 2.22, 2.99, 3.34). This does not assert exact rotational symmetry of
the interpolated surface or its discrete triangulation.

`cached-surface.cjs` compares cached cell assembly to the full assembly of the
same kernel: raw triangles, per-corner normals, and BVH leaf containment.
`worker-startup.cjs` executes the actual classic Blob worker without DOM,
network, fetch or imports; verifies an annulus of area 84; and exercises four
folded cells whose deferred diagonal repairs preserve positions and boundaries,
never rebuild the front, and release retained quality data.

## Responsiveness measurements (16 hardware threads, 15 workers)

Current local-cell renderer, warm browser, egg from a sphere:

- Five ordinary vertex moves at 10 degrees: 8.3–16.4 ms per surface build.
- Real 55-point mouse drag at requested 1 degree: recent preview builds 37–40 ms
  (one observed 80.5 ms); final full-quality build 85.6 ms. Four cells rebuilt,
  four reused, four geometry buffers uploaded; unchanged neighbors received only
  seam-normal patches. Main-thread final installation 0.1 ms, excluding GPU time.
- The drag rendered 58 frames, averaging 1.34 ms of CPU rendering per frame,
  maximum 2.5 ms. These are observations on this machine, not frame-time guarantees.
- Preview relaxes only the interior metric of affected cells to at least 4 degrees.
  All shared boundaries keep the requested 1-degree sampling. Full requested
  precision returns on release or after 120 ms without an edit.
- The frame counter stayed at 59 over a 1.2-second idle interval. Share notification
  appeared after successful clipboard write and faded to opacity 0 after two seconds.
- Strongly folded rapid-edit test at 1 degree: about 290 ms for the final full mesh
  (132140 triangles). This is a stress case, not an interactive preview timing.

The report exposes `qualityStage`, `requestedAngle`, `displayAngle`, cell reuse,
worker count, and build/assembly/upload timing. `waitForIdle()` waits for primary
surface evaluation. Optional diagonal refinement may finish later; it does not
block the first valid surface. `waitForGenerator()` performs additional expensive
mesh diagnostics and should not be included in interaction timings.

## Implementation constraints

- An 8x8 grid samples physical first/second fundamental forms per changed cell;
  the front only interpolates the resulting positive-definite metric. Computation
  uses local coordinates to avoid finite-difference cancellation after translation.
  Singular/nonfinite metric tables fall back to the boundary metric.
- Surface construction is generic; no primitive-specific meshing rules.
- Unchanged cells, normals, internal wire edges and BVHs remain cached in workers.
  Direct MessageChannels avoid returning cached cells through the UI thread.
- Folded cells and cells that exhaust the interactive diagonal budget retain data for deferred quality work. Keeping every smooth
  cell for refinement was measured and rejected because of its allocation cost.
- Deferred work starts once after 180 ms, changes diagonals only, has lower queue
  priority, and cannot install a result for an obsolete cage revision. No-change
  refinement requests no frame. Disposal releases pending timers and retained data.
- Closure is combinatorial; valid geometric folds/intersections are not rejected.
  Boundary welding uses cage IDs, not positional proximity.

Direct file-URL browser verification was unavailable under browser automation URL
policy. HTTP UI checks and the self-contained worker-program checks passed.

## Incremental triangulation and rendering

Adaptive diagonal correction uses an edge queue. After the initial sweep only
changed triangles and their immediate neighbors re-enter the queue. Strictly
lower total local crease energy prevents oscillation; convex UV orientation and
fixed boundary positions preserve the patch domain. Limits are 32 waves, 18 tests
per triangle (minimum 512), and four swaps per triangle (minimum 128). A local
minimum is not a proof of globally optimal triangulation; geometric folds remain legal.

`adaptive-diagonals.cjs` checks 2304 flips across 20 warped grids, multi-wave
convergence, a fresh-scan fixed point, unchanged coordinates and explicit budgets.
`cell-chunks.cjs` compares actual incremental positions, indices, seam normals
and wires with full reference assembly, including strong deformation and a no-op.
`worker-startup.cjs` additionally checks real worker ticket transport: a changed
cell version must produce one new geometry buffer.
`local-invalidation.cjs` seeds 1024 already-resolved cells. Editing one vertex
invalidates four cells; dependency metadata scan took about 3 ms. This does not
benchmark the initial resolver or a 1024-cell viewport.

Rendering keeps geometry, wire and BVH per cell. Aggregate geometry is lazy and
used by operations requiring a single mesh, such as conversion/export. Ordinary
surface edits do not concatenate the whole mesh. Metadata/cage scans and seam
validation still scale with cage size; separate cell draw calls remain a viewport
scaling consideration. No full-scene constant animation loop was introduced.

The physical metric is queried without computing boundary projections for rejected
front candidates. Projection data is generated once for each accepted vertex
because the current surface interpolator still uses that data to evaluate position.

## Borders, sparse cages, and Three.js r186 (2026-09-10)

The app import map and addons now use three@0.186.0, verified against the npm
registry's latest tag. Text font assets use the same release. The default viewport
still has MSAA disabled; this change measures AA rather than silently enabling it.

- Context menu: Toggle border for selected editable spline segments. Mixed
  selections become borders together; an all-border selection clears them.
- Borders cut the cell adjacency graph. Each original shell independently retains
  its uniquely largest resulting region. Equal regions are ambiguous and ignored;
  unrelated/nested shells are not removed. Save/load, undo/redo, segment splitting
  and duplication preserve manual border flags.
- Spline Patch attribute: auto border (default on, including old scenes without
  this property). On skips nonregular cells; off permits irregular geometry within
  the supported topology. Unsupported/degenerate local cells are omitted without
  turning the entire object red. More than five logical sides remain holes.
- Regular quad contours restore ordered opposite-side correspondences. Triangles
  restore a collapsed grid when a unique pair of equally divided adjacent sides
  identifies the apex; the base may have any division count. Multiple possible
  apex choices are not guessed. Five-corner regions have no restoration template.
- Direction transport and angular interpolation reuse Surface Builder's rotation
  helpers; handle magnitudes scale with the new endpoint spacing. Unique existing
  external tangent arms constrain boundary joins. Derived rows/columns share nodes,
  and the curved-guide test verifies G1 along their joins. Existing geometry is
  immutable; restored edges are purple and computed borders remain derived data.
- Reconstruction stores and reuses its logical layout, with bounded search and a
  4096-cell guard per restored region. Highly ambiguous or over-budget regions
  remain holes. This is conservative inference, not arbitrary hole filling.
- Selected edges are green, hover is lighter green. Visibility uses three interior
  curve probes and a hit-point test through cached BVHs. Interior probes avoid the
  false positives produced by a hidden cube edge with one silhouette endpoint.
  Visibility updates on rendered view changes; the renderer remains event driven.
- Spline and mesh-wire line shaders use a small depth bias to avoid coplanar
  flicker. This is separate from geometric triangulation correction.
- Share notification reads “Link copied”, holds for 1.1 s and fades over 0.18 s.

`browser-borders.js` verifies smaller-region selection, undo/redo, native file
roundtrip, default Auto border persistence, hidden-edge hits, visible restored
edges, and on/off behavior for an irregular contour. `browser-cages.js` tests
large legal folds with Auto border explicitly disabled.

Surface sampling repair runs only on cells flagged as folded/degenerate, testing
long skinny interior edges against the actual patch. It is capped at two waves,
256 added vertices and 768 candidate tests per cell; shared boundary points are
never split. Diagonal selection also considers geometric chord error. On the
supplied sphere fixture folded to y=-49.9, the 1-degree maximum normalized chord
error changed from 0.0973 to 0.0501 (156196 to 156408 triangles in that diagnostic).
This is not a proof that every fold or intersection renders artifact-free.

Comparable warm browser final-mesh timings on five identical sphere edits at 1°:
previous version 165–274 ms, current 155–263 ms. These overlap and show substantial
machine/timing variation; no speedup is claimed. Ordinary 10° edits measured
8.6–13.6 ms. Both versions rebuild/upload four cells and reuse four.

`frameAI.benchmarkAntialias(samples)` uses temporary independent renderers and
measures warmed frames with gl.finish (CPU plus GPU completion), not just command
submission. At 1024×720, actual 4× MSAA versus no MSAA measured medians between
0.6–0.9 ms without AA and 0.8–0.9 ms with AA across short runs. The final dense run
rendered 114088 triangles / 170893 lines / 48 draw calls and measured ~0.8 ms for
both modes (p90 ~0.9 ms). Differences of 0–0.3 ms are noisy and hardware-specific;
these observations do not justify a universal percentage cost. No benchmark
animation runs during normal idle use. The idle frame count stayed at 221 during
an additional 1.5-second check, including the notification fade.

Direct file:// browser automation remains unavailable under the browser tool's
URL policy; the actual self-contained classic worker startup is tested separately.
The final regression also verifies a Tri fan with two unsplit equal rails and five
base segments. Independent candidate components are solved separately so proving
uniqueness does not multiply search work across unrelated/nested shells.

## Compound sides and curved-strip correction (2026-09-10)

This section supersedes earlier pentagon/Tri restoration and AA defaults above.
The application now accepts Tri and Quad cells (smooth planar contours and planar
holes remain supported). A Tri can have any number of original cubic segments
per logical side; these remain exact piecewise cubics, not straight polylines.
It does not create a virtual pole or internal cage. Intermediate side vertices
must not have incoming cage branches. Quad restoration requires equal opposite
segment counts. Candidate compatibility is checked BEFORE closed-shell selection;
opposite curve correspondence supplies a geometric tie-break at topology changes.
This is a deterministic geometric convention, not a proof of unique recovery for
arbitrary input. Existing simple cells survive geometric deformations.

New checks:

```
node tests/cylinder-topology.cjs
```

`browser-compound.js` verifies both opposite and adjacent pairs of deleted cylinder
rails at 1 degree: six closed cells, two restored purple guides, undo/redo. It also
splits sphere boundaries and verifies eight closed compound Tri cells through the
real worker/canonicalization path, and creates text with the bundled font.
`cage-restoration.cjs` now includes a curved 2/7/12-segment Tri and rejects regular
pentagons/hexagons. The legacy kernel polygon metric test still exercises 5/6 sides
internally; these are not supported application fill types.

The anisotropic front now zips opposite sampled boundaries for translational
strips instead of closing them into cross-curvature fans. This uses only curves
and the local metric, never the source primitive type. The 1-degree cylinder has
1452 triangles in total; every wall triangle spans less than 2.1 degrees around
the curved direction. Before this correction, long diagonals produced visible
shading bands even though vertices individually lay on the correct surface.

Curvature uses the existing 81 coarse probes. Only high variation/folds activate
local subdivision, capped at 80 additional probes and two levels per cell.
Ordinary sphere and egg test cases use ZERO extra probes and keep identical mesh
counts. Preview builds disable this refinement. Final highly folded cells receive
additional metric detail and bounded interior edge sampling (256 points / 768
tests); original boundary samples are immutable. Idle rendering remains event-driven.

Sequential warm Node comparisons of eight sphere cells (not mouse-to-display
latency): at 1 degree, smooth sphere 629 -> 608 ms, egg 564 -> 546 ms, severe fold
1126 -> 1687 ms. The folded mesh grows from about 156k to 177k triangles. At 10
degrees results varied by a few milliseconds between runs. These are hardware-
and load-dependent measurements, not a guaranteed speedup. Final fold quality
costs more; preview excludes the adaptive map. On the severe-fold quality fixture,
maximum normalized edge-midpoint deviation decreased from roughly 0.055 to 0.046
at 1 degree; at 10 degrees edges above 0.15 decreased from eight to two. Arbitrary
self-intersections and every possible fold are not claimed artifact-free.

Droid Sans JSON and its upstream Apache NOTICE are embedded in index.html. Text
creation no longer fetches a font and works with the existing file:// workflow.
Share displays 'Link copied to clipboard' for 1100 ms plus the 180 ms fade.
Native WebGL antialiasing is now enabled, with no postprocessing pass or idle loop.
Browser QA verified the cylinder shading visually, the English toast, nonempty
text, and the full existing tube/nested-shell/border regressions.

Final AA measurement: 1024x720, 114088 triangles, 46 draw calls; 16 warmed
frames gave 0.9 ms median / 1.2 ms p90 with and without native 4x MSAA.
The app frame counter stayed at 25 across the final idle check.

## Point insertion and Ctrl editing (2026-09-10, subsequent fix)

In spline component editing, selecting a vertex and Ctrl-clicking another vertex
of the same spline adds a straight segment. Existing connections and self-links
are not duplicated. Undo/redo includes the edge and selection state. Ctrl-click on
an edge inserts a vertex; Ctrl-drag no longer duplicates the segment. Ctrl no
longer inverts spline element selection or decouples tangent handles. Shift keeps
additive selection. Global shortcuts and object-tree interactions are unchanged.

Insertion bugs corrected:
- Unequal opposite Quad segment counts disable regular cage reconstruction but
  do not remove the existing Quad surface: the sides remain compound curves.
- Resolver costs discount subdivision vertices of degree two, while retaining
  authored branching corners. Splitting an edge should not favor a different
  shell merely by increasing its raw segment count.
- Smooth planar annuli survive boundary subdivision (the previous side-count
  filter incorrectly discarded a tube cap after inserting a single point).
- Exactly subdivided Bezier pieces recover their original polynomial and
  parameter intervals before building the patch. Edited pieces do not merge.
- Ordered curved strips retain additional vertices on straight connector edges;
  those boundary points no longer force a return to fan triangulation.

`subdivision-shape.cjs` checks exact repeated unequal splits and refuses merging
edited curves. `browser-point-insertion.js` checks cube, sphere, cylinder and tube
at 10 and 1 degrees, repeated splits, straight-edge splits, closed seams, volumes,
connection duplication guards and undo/redo. Maximum relative volume changes at
10 degrees: 0 / 0.000252 / 0.000380 / 0.000488; at 1 degree:
0 / 0.000000268 / 0.00000231 / 0.00000308. Meshing samples may change, so identical
triangle indices are not required. Browser screenshots of the edited cylinder
and egg were inspected in solid+wire mode. A real Ctrl-click via pointer input
added the expected v2-v4 segment, rather than toggling selection.

The exact scene behind the user's last close-up was not supplied; these checks
address reproducible insertion failures and do not prove that every severe-fold
artifact shown in an arbitrary scene has been eliminated.

## Ctrl-drag restored (user correction)

The preceding Ctrl-only-insertion restriction is superseded for drag gestures.
Ctrl-click still connects vertices/inserts points. Ctrl-drag on a segment again
creates a moved copy, including gizmo-driven duplication. Ctrl-drag on a tangent
again changes only that handle; ordinary drag retains coupled tangent behavior.
Real pointer verification: a four-edge/four-vertex profile became five edges/six
vertices in two sequences after Ctrl-drag (a copied edge, not an inserted point).

## Soft inserted point and polygon front

Supersedes the former Tri/Quad-only application policy: ordinary nonplanar
polygon cells now reach the shared surface kernel (up to its 12-side limit).
The existing bounded wider resolver search and compound-side handling remain.
A boundary with only one sampled side no longer bypasses the physical curvature
metric through a fan. The strip shortcut now requires control-point evidence
of a translated strip; a small metric in one direction alone is insufficient.
The existing 81-probe metric with bounded local refinement remains unchanged.

`node tests/soft-point-front.cjs` checks a single curved side at 10 and 1 degrees,
a plain cube cage with an inserted displaced point before/after soft handles
(six retained cells), and nonplanar 5/6/7/12-sided cells. All Node regression
scripts passed. These are kernel/resolver checks; the exact screenshot scene
and interactive viewport were not replayed in this change.

## Perimeter queue and closure validation (2026-09-10)

The front now processes a FIFO of perimeter edges, then their newly created
interior edges. A failed seed does not immediately authorize a large ear after
two lookahead edges. Recovery is attempted only after eligible seeds are exhausted.
A long, original boundary edge may seed an interior triangle even when its metric
length exceeds the generated-edge bound. Original boundary samples stay immutable.
Closure costs also query the curvature map at the centroid and both proposed edge
midpoints. Negative seed/ear checks are cached while their defining vertices stay
unchanged; only changed neighbors are queued again. All of this is generic cage
geometry, with no source-primitive rules. The adaptive 81-probe map and bounded
local refinement are retained.

The expanded soft-point-front test runs hard and soft displaced inserted points
at both 10 and 1 degrees and validates assembled seams. At 1 degree, the soft case
has 8800 triangles and 2 triangles longer than 60 units with aspect ratio over 8,
versus 4308 triangles and 11 such triangles before this change. Hard: 1430 triangles,
0 long slivers. This geometric threshold is a regression measure, not a claim
that every triangle meets a global error guarantee. All 13 Node scripts passed.

Warm sequential six-cell builds at 1 degree measured approximately 25 ms hard /
150 ms soft, versus 6 / 57 ms for the under-sampled previous meshes. This remains
a real cost increase; it is not a viewport latency measurement. Local mesh renders
were inspected. Browser policy blocked opening file:///C:/frame/index.html, so
interactive viewport testing was not completed. A uniform concentric-ring
prototype was discarded because it greatly over-refined the hard polygon.

## Approximation input and 1/2-degree regression

The spline attribute field now reads the current parameter record on every get/set.
Parameter undo/redo restores records in place and updates editable spline sampling;
Escape uses the same restoration path. History also refreshes displayed attributes.
The AI approximation command re-resolves parameters when replayed. A completed
obsolete surface build may populate the serialized cache but cannot publish its
mesh, cage or angle report over a newer requested revision.

A separate geometry regression also reproduced 1-degree coarsening on a displaced
hard polygon, independently of the UI. After a high-cost recovery ear, final meshing
now checks overlong interior edges in the sparse metric. A surface midpoint check
filters metric overestimates; confirmed chord deviations trigger conforming splits
on both incident triangles. Boundary samples remain unchanged. This is bounded to
12 passes / 12000 added vertices per cell, disabled for preview, and reports its
counts/limit through frontReport. It is not a universal error-bound guarantee.

`approximation-input.cjs` executes the actual field/scrub callbacks, parameter
history and async publication function with isolated dependencies: repeated edits,
record replacement, undo/redo, Escape, and a delayed old worker result. No browser
or reselection is used. `soft-point-front.cjs` also compares 10/2/1 degrees. At 1/2:
hard 4772/3864 triangles; soft 8820/2174. All 14 Node scripts pass. The exact user
viewport scene was not replayed.

## Local snake front and deferred quality (2026-09-10)

Historical stage: the perimeter-derived physical floor described below was
subsequently removed. See the fixed-probe update at the end of this file.

This supersedes the previous production advancing-front recovery/refinement path.

- Curved cells with 2–12 sides use a local front with explicit directed-edge
  nodes. Meeting rows share a mesh vertex and split/join their front loops.
  Candidate connections check both endpoint wedges, UV orientation and local
  intersections. A numeric spatial index avoids full perimeter scans in normal
  advancement. The rare stalled-row closure pass consumes valid remaining ears.
- The existing sparse physical curvature map bootstraps the first row and probes
  ahead. Normals from accepted triangles and the previous row adjust directional
  density without additional surface evaluations. The predictor interpolates the
  map once ahead of the candidate. This is approximate angle control, not a
  certified angular error bound or a globally minimum triangulation.
- Boundary samples are immutable. The minimum physical step is the shortest
  perimeter-polyline segment. Density is capped in physical tangent coordinates;
  new points are rejected when their incident/local neighbor distances fall
  below that minimum. The cap takes priority over angle. No production midpoint
  subdivision/repair inserts more vertices after initial meshing. Translated
  strips keep their ordered boundary zipper.
- Interactive worker builds skip global UV/surface validation and diagonal
  optimization. Render-normal/BVH construction retains its existing inexpensive
  consistency guards. The mesh is installed before the existing 180 ms deferred
  quality job. Synchronous kernel calls still return checked/refined results.
- Deferred quality validates, then swaps only interior diagonals of convex UV
  quadrilaterals using normal/chord-fit energy. The first sweep visits interior
  edges; subsequent sweeps visit affected faces and their neighbors. Strict
  energy decrease avoids oscillation. Defaults remain 32 waves, 18*T tests and
  4*T swaps; the report includes each wave and whether work hit a limit.
  Vertex coordinates/count, boundary IDs and triangle count stay fixed.
- A successful QA pass with zero swaps returns metadata only and reuses the
  existing render buffers. Revision checks continue to prevent stale publication.
  Self-intersections of the supplied surface are not repaired or rejected.

`node tests/snake-front.cjs` checks 66 irregular 2–12-sided cases, including
unchanged boundary coordinates, the physical step floor, no global QA before
initial output, conforming topology, and index-only deferred refinement.
`worker-startup.cjs` exercises the actual embedded worker including no-swap
metadata updates. All 18 CJS regression scripts pass.

The user-angle fixture has h_min = 59.479385. Its curved cells now have 3–5
triangles at the tested angles: the old demand for hundreds/thousands of interior
vertices contradicted the newly required minimum step. Its test now verifies the
fixed perimeter, minimum step and coverage. A smaller requested angle need not
increase density once that physical cap dominates.

Repeatable throughput harness (15 persistent Node worker_threads, four warmups
per worker, 180 fresh 1-degree egg cells, Ryzen 7 3700X / 8 physical cores):

```
node tests/benchmark-snake.js --initial
node tests/benchmark-snake.js
```

Initial mesh plus render normals/BVH: ~0.90 M triangles/s, versus ~0.37 M/s from
the pre-change working copy with the same harness (2.235 M versus 2.183 M output
triangles). Full mesh + deferred QA/swaps + render normals/BVH: ~0.25 M/s.
These are single local benchmark runs, not browser latency or a 15-physical-core
measurement. They exclude cross-cell assembly, worker buffer transport and GPU
upload, and do not establish the requested 5 M triangles/s. Deferred QA currently
dominates full-cycle cost. The benchmark reports actual elapsed throughput;
cached/reused triangles are not counted as new geometry.

Offline solid/wire renders of a curved triangular patch and a seven-sided cell
were inspected before/after diagonal refinement. Browser URL policy blocked
file:///C:/frame/index.html, so interactive browser rendering was not verified.

## Fixed position probes and independent interior spacing (2026-09-10)

This supersedes the perimeter minimum-step requirement above. Straight boundary
segments can enclose a curved patch; their lengths no longer cap interior density
or restrict diagonal swaps. Boundary coordinates and sample IDs remain immutable.

The curvature map evaluates exactly 64 surface positions per cell, or 66 on a
triangular barycentric lattice. Quads use an 8x8 inset lattice with directional
three-point derivative stencils; other domains use cached quadratic least-squares
stencils. Position derivatives give normals, and the same stencils give normal
derivatives. The metric contains both directional terms and their mixed product,
scaled by the requested angle squared. A small UV identity term only bounds the
step in flat directions; it does not impose a physical minimum step.

Stencil and interpolation weights are cached per side count within each worker.
An interpolated 17x17 metric table feeds the front without additional surface
evaluations. Each accepted interior vertex evaluates its position once; triangle
normals still adjust subsequent front predictions. The metric has no recursive
probes. The existing translated-strip shortcut, cell workers, first-display path
and deferred QA/diagonal waves remain in place.

All 19 CJS regression scripts pass. `fixed-probe-metric.cjs` independently checks
the evaluation budget, flat and cylindrical surfaces, rotated/mixed curvature,
and curved interiors with straight boundaries. `snake-front.cjs` checks fixed
borders and conforming meshes for 66 cases. The obsolete minimum-edge assertions
were removed. The soft-point test now samples long edges against the actual patch
instead of rejecting elongated triangles solely by aspect ratio: nearly flat
directions and immutable boundaries legitimately produce long triangles. Its
maximum sampled deviation divided by edge length is 0.00448 at one degree.
This is a geometric regression threshold, not a proof of angle_max compliance.

Same 15-worker benchmark as above, 180 fresh one-degree egg cells after warmup:

| Measurement | Before this update | Fixed probes |
| --- | ---: | ---: |
| Output triangles | 2,235,420 | 1,743,660 |
| Initial mesh + render/BVH | 2.40 s / 0.930 M triangles/s | 1.68–2.33 s / 0.748–1.040 M triangles/s |
| Full mesh + QA/swaps + render/BVH | 9.38 s / 0.238 M triangles/s | 7.76 s / 0.225 M triangles/s |

These local runs show approximately 22% fewer output triangles, but do not
establish higher full-cycle triangle throughput. Deferred QA/swaps dominate the
remaining cost. The CPU is a Ryzen 7 3700X with 8 physical cores, not 15 physical
cores; cross-cell assembly, transport and GPU upload are excluded. The requested
5 M final triangles/s remains unmet. Offline solid/wire views of triangular and
seven-sided cells were inspected; browser rendering was not verified.

The method assumes moderate curvature. A fixed probe budget can miss narrow
features between samples, so angle_max remains approximate; more cage cells are
needed to represent difficult regions reliably.

## Tail zipper without post-build swaps (2026-09-10)

This supersedes the deferred-swap and triangle-normal-feedback behavior above.
The front keeps a cursor on an opposing live edge, walks adjacent edges locally,
and compares that edge's two endpoint candidates. A lost/distant cursor is
reacquired through the existing spatial index. Connectivity/orientation checks
still query nearby edges: two candidates does not mean two total geometric tests.
Eligible convex quads are triangulated once at emission using the smaller normal
disagreement. There is no later diagonal optimization. Global deferred QA remains
read-only and returns metadata without another geometry upload.

The curvature metric uses sqrt(3) times the requested angle as an approximate
conversion from vertex-normal spacing to adjacent-face spacing for ideal regular
triangles. This is not a strict face-angle guarantee on anisotropic patches.
Boundary approximation is unchanged. Triangle-normal feedback has been removed.

The user's depressed-sphere URL at 1 degree produces 29,692 triangles in the
browser versus 97,024 before this change, with zero swaps and valid mesh incidence.
Its initial build report is 165 ms versus the earlier 264 ms single local run;
these timings are not controlled end-to-end latency measurements. Elongated
triangles near the depressed pole remain visible; visual quality is not solved.
`tail-zipper.cjs` preserves the exact six vertices/twelve cubic segments as a
fixture and checks one-time quad splitting plus unchanged indices after QA.
Its direct kernel traversal differs from worker loop canonicalization and produces
29,744 triangles. The older user-angle test's arbitrary >100-vertex floor was
replaced by positive interior sampling and strictly decreasing density as angle
increases. Worker tests now require zero geometry changes during deferred QA.

A local full mesh + QA + render/BVH run on the 15-worker egg benchmark produced
548,820 triangles in 0.847 s (~0.648 M triangles/s). This remains below the
5 M triangles/s target; the benchmark excludes assembly, transport and GPU upload.

## Alternating rows from one edge (2026-09-10)

Triangular and quadrilateral cells now start with the complete sampled first edge,
then generate and stitch successive interior rows in alternating directions.
Only two adjacent previous-row candidates compete at each join; no spatial index
or perimeter-wide search is used on this path. Side samples passed during a row
are included in that strip without insertion or movement. Shared boundary tips
are retained until their collinear samples have been triangulated. Row insets
respect the previous row so long unsplit side segments cannot make rows cross.
The last strip consumes the opposite edge or triangular apex. Digons and domains
with more than four sides retain the previous local-front implementation.

The existing directional map determines longitudinal spacing and transverse row
spacing (including its mixed term). No extra surface probes or post-build swaps
are introduced. Quad boundary UV now retains the original Bezier parameter:
the quad evaluator uses that parameter, while the previous generic arc-length
remapping could assign a different surface position to the same boundary UV.
Authored/sample positions themselves are unchanged.

All 21 CJS scripts pass. `edge-rows.cjs` verifies reversal, zero spatial queries,
boundary/evaluator agreement and unchanged deferred indices. The depressed-sphere
fixture checks the row path as well. In the browser, the user's 1-degree scene
contains 30,780 triangles and zero swaps; the first cell uses 40 rows and 4,972
candidate tests instead of the prior 51,864 spatial/candidate tests. These counters
describe different work and are not directly a speedup factor. The initial build
report was 129 ms in one local browser run. Visual inspection still shows local
elongation/density transitions; this does not prove strict angle_max compliance.

The full 15-worker egg benchmark produced 567,180 triangles in 0.606 s, about
0.94 M triangles/s versus the preceding ~0.65 M/s run. The same assembly/transport/
GPU exclusions and 8-physical-core CPU caveats apply. The 5 M/s target remains unmet.

## Linear boundary estimates and point stepping (2026-09-11)

Triangle/quad rows now all proceed in the same direction. Their curvature map
uses 66 triangular / 64 quadrilateral position probes including the boundary.
Cached linear differences replace quadratic fits. Boundary normals are linearly
extrapolated from interior probe normals before estimating normal derivatives;
no boundary mesh vertices or additional surface evaluations are introduced.
The old sqrt(3) angular relaxation is removed: requested angle is used directly.
This supersedes the earlier approximately 30k-triangle density target.

Temporary timeline controls: Play evaluates/inserts one next interior point;
Next key drains the remaining rows/cells. The resumable iterator is also the
production row builder. Point markers are hidden on completion. Play after
completion restarts the inspection. Curved cells other than triangles/quads
report that stepping is unsupported; ordinary construction remains available.
The original generated mesh is hidden during inspection and restored on changes.

All 22 CJS scripts pass, including exact step/full mesh agreement, one surface
point evaluation per step, forward rows, fixed boundaries, and analytic cylinder
curvature checks at the boundary. Browser stepping/full build completed the user's
8-cell scene with 101,066 triangles. The standalone fixture gives 101,100 because
its input preparation differs. Neither count proves optimality or strict angle
compliance. Full mesh/QA/render/BVH benchmark: 1,415,700 triangles / 0.990 s,
1.43 M triangles/s, 15 workers on Ryzen 3700X (8 physical cores). Assembly,
transport and GPU upload remain excluded. The 5 M/s target remains unmet.

## Reuse accepted points and emit immediately (2026-09-11)

Play now inserts one point and immediately emits its joining triangles. Next key
has its ordinary timeline meaning again; the debug text overlay is removed.
The same streaming stitcher drives stepped and ordinary builds. Perimeter
vertices remain immutable and post-build swaps remain disabled.

Triangle/quad rows reuse two local tail positions plus the current row chord to
estimate a normal at the strip centre. Differences between normal samples at
known UV centres recover both UV derivatives through a 2x2 solve. Well-conditioned
estimates blend equally with the initial 64/66-probe metric; trace ratios outside
0.25..4 are rejected as unreliable. Accepted points are never reevaluated.
The next U step and next row spacing use the updated metric. The transverse rate
uses C directly, removing the unsupported C-B*B/A displacement assumption.

This remains experimental: a common row height still averages transverse demand,
and sparse secant normals are approximate. The depressed-sphere fixture now has
219,480 triangles, up from 101,100: this is not a density or performance victory.
All 22 CJS scripts pass. The step test instruments the actual evaluator, checks
one call per insertion, immediate face emission, unchanged perimeter, and exact
agreement between stepped and ordinary construction. These tests establish
mechanical correctness, not optimal density or strict AngleMax compliance.

## Signed curvature and spatial tail matching (2026-09-11)

The probe map now interpolates signed normal derivatives before forming the UV
metric. Triangle/quad lookup uses the containing probe triangle/quad instead of
a second smoothed metric grid. Significant derivative cancellation triggers a
cached nine-position local Hessian/normal-derivative check. This intentionally
relaxes the former no-extra-probe assumption; counters include verification calls.
Accepted reliable row observations replace the seed instead of blending 50% of
it forever. Ill-conditioned/inconsistent secant observations fall back to the map.
Tail matching uses squared 3D distance, preventing curvature-flat directions from
making distant row points appear artificially close.

The independent cancellation regression compares against finite differences of
unit normals at two intervals: estimated |Nv| 0.03727 versus 0.03728 measured,
previously 0.680. All 23 CJS tests pass, including the existing geometric long-edge
error bound. Depressed-sphere fixture: 188,786 triangles (previously 219,480).
Full 15-worker benchmark: 2,661,300 triangles / 2.316 s (~1.15 M/s), with previous
assembly/transport/GPU exclusions. A shared transverse row height still averages
local demand; optimal density and strict AngleMax compliance remain unproven.
Play still emits a point and joining faces immediately; no overlay text or swaps.
