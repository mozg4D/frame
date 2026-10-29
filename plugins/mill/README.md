# Mill

Mill is an independent Frame plugin. The current stage implements native CNC authoring, Stock/Protected semantics and bounded three-axis GPU solid snapshots. Toolpath planning, virtual milling, machining time and G-code remain unfinished; see TODO.md. Slice currently builds geometry only and reports geometry-ready with machiningReady:false through the AI API.

## Native scene model

CNC is an ordinary plugin object with a local box X/Y [-50,50] mm and Z [-100,0] mm before native scaling. Its default pivot is the upper near-left corner (-50,-50,0). Native Position/Rotation/Size, parenting, enabled/visible state, Undo/Redo and HASH apply normally. No parent/child type restrictions are added. CNC can be attached under a part or assembly; it does not consume or relocate that geometry.

Physical machining coordinates follow each CNC's local axes, with orthogonal native scale applied to dimensions. Diameter, Step Down, Tolerance and other physical parameters are not multiplied by that scale. Arbitrary world rotation/translation and positive nonuniform scale are supported. Skew, singular frames and reflected machine bases are red and ignored. A child CNC whose directed tool axis differs from its root is also red/ignored for this three-axis job. Native editing remains available in every case.

The nearest CNC ancestor defines the operation tree, including through ordinary groups or geometry. The topmost CNC is a job root; operations follow actual Scene Tree depth-first preorder. The green point disables only that operation's computation, while red visibility controls normal display. The helper stays visible when the green point is off.

Stock and Protected are normal native tags registered in the plugin manifest. Their menu entries become available after Mill activation. Assign/remove them through ordinary object context menus, Browser tag editing or tag.set. Tags on groups/ancestors apply to evaluated descendant geometry. Protected volumes can be anywhere in the scene. A non-CNC child of CNC has no implicit protected role.

Stock supplies initial material. Protected supplies a forbidden region; it does not create stock. An occurrence carrying both roles participates in both sets. Ordinary evaluated geometry carrying neither role is target geometry. Current snapshots separately classify all three roles in each CNC box; the remaining planner must use those sets to derive safe material removal and sequential stock.

Fallback Stock appearance is translucent neutral green/gray. Protected fallback is translucent red above ordinary surfaces and below selection/gizmo helpers. Explicit or inherited user material tags take precedence, including polygon assignments. These styles use canonical GPU geometry in a core-owned pass, create no second mesh/material scene and are not persisted.

## Attributes and local defaults

CNC has Tool (Flat/Ball/V), Diameter, V-only Angle, Step Down, Step Over, Ramp Angle, Feed, Plunge, Spindle, Safe Dist and Tolerance. Angle defaults to 90 degrees. Negative RPM is allowed. Inputs are validated through native UI/API parameter transactions before mutation.

The root additionally exposes Start G-code, Tool Change G-code and Progress. The two G-code fields are native multiline text; they are authored only at this stage, never executed in the browser. Tool-change text defaults to M5 followed by M0. Progress is currently fixed at zero because there is no virtual milling result. The Slice row shows --:--:-- until a real machining estimate exists. No diagnostics panel is appended.

Physical/text defaults use the stable localStorage key frame.mill.defaults.v1. Values are validated and used for new CNC objects; Progress/derived resources are excluded. Existing HASH projects retain their own parameter values. This is best-effort local preference persistence, not a compatibility migration system.

## GPU geometry pipeline

The plugin borrows Frame's shared GPUDevice and scene.capture occurrences. Buffer and paged texture storage use separate source bindings. Native source-to-CNC matrices are converted to physical millimetres. No CPU triangle mirror, second importer, normal readback or runtime Printer import exists.

The pipeline independently incorporates Printer's algorithms:

1. GPU bounds select the occupied domain intersecting the physical CNC envelope.
2. Triangle-centric canonical projection counts depth events on X, Y and Z ray grids. Shared-edge interpolation and half-open rules preserve parity; dispatches cover at most 64 sampled rows and coarse triangles share columns across GPU lanes.
3. A hierarchical prefix scan allocates one combined XYZ event array.
4. GPU union/find labels canonical connected shells. Emit records depth/occurrence, geometric plane slopes, shell and crossing direction.
5. A preliminary all-axis cleanup joins interleaving disconnected shells. The final pass unites joined clusters, applies even-odd between nested clusters within one occurrence and unions independent occurrences.
6. Ordered disjoint intervals are clipped to the CNC envelope and retained with one combined XYZ header buffer. Source triangles, event arrays and retained intervals stay GPU-owned.

The source, scan and cleanup kernels are embedded in Mill's own plugin.js. They share algorithms with Printer but no runtime module or resource ownership. A nonempty role reads 24 bytes of bounds plus two 16-byte allocation/cleanup counters, 56 bytes total. Empty roles read bounds only. Inspection readbacks are separately explicit and bounded.

Stored normals are ignored. As in Printer, balanced connected-shell rays use geometric signed crossings to remove self-overlaps, with parity fallback for unbalanced winding. Global reversal is immaterial; arbitrary inconsistent self-intersections are limited by the policy and sampling. An open/damaged surface has no universally recoverable interior. ambiguousRays reports unmatched crossings. Do not advertise exact reconstruction of arbitrary malformed meshes.

Tolerance currently supplies the requested sampling pitch, not a certified total machining error. Every dimension is at most 2048; total XYZ rays are at most 4194304, raw events at most 16777216 and raw hits per ray at most 1024. Device binding limits also apply. A request exceeding those limits fails and marks the job root red; pitch is never silently enlarged. Sparse/adaptive refinement and certified distance/cutter/path error budgets remain in TODO.md.

## Jobs, invalidation and ownership

Slice is root-only and returns a job immediately. State is idle, running, geometry-ready, cancelled, stale or failed. geometry-ready describes completed solid import only. Enabled valid operations build in preorder, but each still starts from source geometry; previous cuts do not yet propagate.

The signature includes evaluated geometry/resources/device, relative transforms, physical box scales, role tags, hierarchy/order, enable state and CNC attributes. Common rigid motion of a CNC/source assembly preserves local solids. Source-relative edits, role changes or settings invalidate them. Undo restores authoring, not an old GPU job.

Cancel, deletion, scene replacement, device changes and stale source checks retire all owned derived buffers. Borrowed source/camera/pass/device resources are never destroyed. Failed builds publish no partial solids. Errors belong to status; invalid frames/build failures color CNC red, with no diagnostic panels.

## AI API

Use ordinary scene.create/plugins.create, scene.update, transform.set, scene.delete, scene.select and edit.history for native authoring. tag.list discovers plugin tag kinds; tag.set takes ids, kind (stock/protected), enabled and performs one native Undo transaction. It supports geometry/groups regardless of tree placement.

Discover Mill operations with plugins.describe {plugin:"mill"}; invoke through plugins.command {id,operation,args}:

| Operation | Behavior |
| --- | --- |
| settings | Validate and set physical/text parameters, and update local defaults. |
| status | Eligibility/reason, enabled state, root/order, geometry job state, per-role sampling/memory/ambiguity and timing. machiningReady is false. |
| slice | Start the root's background three-axis geometry build. |
| cancel | Cancel the root's current build atomically. |
| inspect | Read intervals for operation hash, role, axis and paginated ray offset/count. |

inspect defaults to the addressed operation's Stock and axis Z. Count is 1..256, with at most 4096 intervals per response. It returns two physical cross-ray coordinates plus depth pairs along the selected CNC-local axis. It revalidates source identity before returning.

No generated-toolpath, G-code or virtual-stock API is claimed at this stage. Finish G-code is not generated yet.

## Verification

tests/index.mjs is discovered by the shared standard/stress suite. The focused runner is node plugins/mill/tests/run.mjs --headless. It checks native UI/tag/history/HASH, text/defaults, unrestricted parenting/preorder, scale/rotation/skew, green visibility, material precedence, analytic XYZ intervals, nested cavities, overlaps, duplicates, winding, texture storage, cancellation, limits and completed-operation/frame budgets. Reports record exact runtime/plugin hashes and real adapter/device errors.

## Validated foundation release

Focused visible hardware-WebGPU verification passes 76 checks. Standard and DPR-2 stress each pass 6289 assertions; the unchanged 100548288-triangle suite passes 43 checks, and Mill's Stock/Protected presentation benchmark passes 12 checks. No JS/console/WebGPU validation errors, device loss or replacement occurred. On NVIDIA Turing, the presentation benchmark's Stock p95 is 13.121 ms GPU / 0.600 ms CPU, and Protected p95 is 12.756 ms GPU / 0.600 ms CPU; canonical position residency is unchanged. These are local fixture measurements, not universal performance guarantees. Run the latter benchmark with npm run test:mill:performance -- --headless.

The tested/staged index SHA-256 is f2f7ed51cbd8dd0a96cf4dbc3634cdcf2d8687cad8ab25c12e12e16afe6da697; Mill plugin SHA-256 is d593df1f84a74bd3a13607de3fb8105d011400b56d0a6087786819c764702506. Local ignored evidence is tests/results/mill-acceptance.json, mill.json, mill-standard.json, mill-stress.json, performance-100m.json and mill-performance.json. Shared standard/stress source binding now discovers installed manifests/modules/icons/assets from the plugin catalogue, including Mill.
