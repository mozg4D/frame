# Frame plugins

Plugins are independent JavaScript modules in `plugins/`, with one directory per plugin. The core discovers metadata, displays icons in **Plugins**, creates ordinary scene objects and saves their parameters. It supplies rendering and editor integration; each plugin owns its operations and visual semantics. The 3D Printer owns its volume helper and immediate face-angle warning. The printer builds persistent X/Z GPU LDIs, reconstructs Finish-layer coverage and derives that layer's perimeter polylines on the shared GPU. The full medial/width planner and machine output are not implemented.

## Installation and discovery

Serve the repository on any static HTTP/HTTPS host. No directory listing, server API, build step or package manager is needed. Add a manifest path to `plugins/index.json`:

```json
["3d-printer/plugin.json", "strength/plugin.json"]
```

A static catalogue avoids probing numbered URLs and the resulting 404 requests. On startup the core fetches this catalogue, each manifest and its SVG icon. It does **not** import plugin JavaScript. Adding a plugin object or opening a HASH scene that uses one imports its module once for that page. Visiting the Plugins tab alone does not load it. Other files remain unloaded unless the plugin imports them.

## Manifest

Example `plugins/strength/plugin.json`:

```json
{
  "id": "strength",
  "name": "Strength analysis",
  "module": "plugin.js",
  "icon": "icon.svg",
  "objects": [{
    "type": "strength_analysis",
    "name": "Strength analysis",
    "fields": {"Load": 100, "Enabled": true, "Method": ["linear", "nonlinear"]}
  }]
}
```

IDs, object types and parameter keys must remain stable while a scene uses them. Plugin IDs are lowercase letters/digits/hyphens; object types start with a letter and contain lowercase letters/digits/underscores. Object types must not collide with built-in or other installed types. An optional manifest `color` supplies the tree name color. Paths are relative to the manifest and remain on the same origin inside `plugins/`.

`fields` uses the core's attribute schema: finite numbers create numeric fields, booleans create switches, arrays create cycling choices, and strings create object-reference fields. Array element zero is the default. The core supplies selection, rename, parenting, enabled/visible state, numeric scrubbing, keyboard editing, animation, Undo and HASH storage. An icon click creates the first declared object type. `plugins.create` can select another type explicitly. Plugin parameters live in the ordinary node `params`; no second scene graph is maintained.

An object declaration can include `breakAfter:["Field name"]` to add eight CSS pixels of empty spacing after those field rows. Author plugin icons at their displayed native 32x32 dimensions; CSS transforms and viewBox scaling are not used. UI creation is serialized and included in API settling, so repeated clicks each complete an independent creation, including first-use lazy compilation.

## Module entry point

```js
export function activate(context) {
  if (context.version !== 1) throw Error('Unsupported Frame plugin API');
  // Register plugin-owned interactions/resources here.
  // No document object is created merely by loading this module.
}
```

`activate` runs once per page, immediately before first use, and may return a promise for plugin initialization. Do not wait for `context.api.call()` inside `activate`: activation can itself be awaited by a serialized core command. Make editor commands from subsequent interactions after activation has returned. Initialization errors remain available through `plugins.list`; failed initialization may be retried.

Version 1 context:

| Member | Meaning |
| --- | --- |
| `id`, `version` | Stable plugin ID and context protocol version. |
| `api` | The supported `window.frameAI` API. Discover commands with `listTools()` and invoke `call(name, args)`. Commands use native validation, serialization and Undo. |
| `device` | The viewport's shared `GPUDevice`; do not create a second rendering device. |
| `gpu(hash)` | A borrowed view of a canonical mesh's GPU resources, or `null`. Returns device, positions, indices, normals, vertex/triangle counts, storage mode and revision. |
| `requestDraw()` | Request a core redraw after plugin-owned work. |
| `viewport.register(descriptor)` | Register plugin-owned local line geometry, bounds and a surface-warning WGSL function. Returns a promise for compilation on the shared device; safe to await during activation. |

`gpu(hash)` shares resources directly; it does not read back or copy the geometry. `storage: "buffer"` exposes the existing canonical buffers; `"texture"` exposes the core's paged storage descriptor. Formats and writable editing hooks are provisional and must be agreed with the core before implementing a consumer. Check the returned `version`, reacquire resources after edits/rebuilds and discard stale asynchronous results. These are borrowed resources: never destroy, map, replace or write them. A transform may also advance their revision. The plugin owns and releases buffers/textures it creates. There is no permanent CPU triangle mirror. Use supported core commands for mutations so selection, dependants, caches and Undo remain consistent.

`viewport.register` takes `{pivot?:[x,y,z], bounds:{min:[x,y,z],max:[x,y,z]}, lines:Float32Array, color:[r,g,b,a], selectedColor:[r,g,b,a], settings(params), shader}`. Lines contain local endpoint pairs (six floats per segment, at most 10000 segments); bounds and coordinates must be finite. The optional local pivot supplies the default transform origin; explicitly authored/frozen pivots take precedence. `settings` returns four finite shader constants. `shader` defines `fn pluginSurface(local:vec3f, normal:vec3f, build:vec3f, settings:vec4f)->vec4f`: discard unaffected fragments, or return their warning color. `normal` is the geometric world face normal oriented toward the viewed side, calculated from position derivatives independently of stored normals or winding; `build` is the normalized world local-Y axis. The core supplies the inverse object frame, current evaluated mesh resources, all four cameras and existing raster depth. It supports paged meshes, affine transforms and replicas without geometry readback or a CPU mirror. Wireframe views use a depth-only pass before warnings so hidden surfaces stay hidden.

Registration remains attached to the loaded plugin. The bridge owns and releases its small line/uniform buffers, retires per-object resources after deletion, and recompiles against a replacement shared device. Hiding/disabling an object or an ancestor, and Solo, suppress the display. Local bounds participate in selection, pivot, focus and clipping; transparent SVG hit paths select the same ordinary owner along its helper edges. Compilation errors follow normal plugin activation diagnostics. No saved GPU resources are added to HASH: reopening reconstructs rendering from the installed plugin and native parameters/frames.

### Evaluated snapshots and operations

`context.scene.capture(hash, parameterKeys)` returns `{scene, device, params, signature, meshes}`. Each mesh is a read-only borrowed canonical GPU occurrence with `hash`, per-snapshot `solid`, `matrix` (mesh rest to the requested object's local frame), positions/indices, vertex/triangle counts and `storage`. Buffer storage uses GPUBuffer; texture storage exposes existing `.view` textures. Generators and replicas share their current resources; history/hidden/consumed geometry is excluded without camera-frustum filtering. No CPU geometry is produced. Do not retain a snapshot after the job or write/destroy/map its resources. Recompute `context.scene.signature(hash, parameterKeys)` before submitting subsequent work and before publication; scene/device/resource/version/relative-frame/visibility/key changes invalidate a snapshot. Publication is atomic; the plugin owns cancellation, stale rejection and all created resource retirement.

`context.operations.register([{id,description,inputSchema,readOnly,run(hash,args)}])` registers plugin-owned operations. `plugins.describe {plugin}` explicitly loads/discovers their schemas. `plugins.command {id,operation,args?}` validates the registered argument schema before invoking the selected native owner's handler in the ordinary API queue. Its conservative outer mutation annotation is independent of the discovered operation's readOnly annotation. Long operations return a job handle immediately so status/cancellation and unrelated editor actions can proceed; jobs are not included in ordinary API settling. They must not call and await the serialized API from their handler.

`context.attributes.register(hash => ({actions,ranges,groups}))` supplies normal top attribute actions `{id,label,busy,progress,cancel?}` linked to registered operations, plus optional numeric-field range overrides. `groups:[{label,actions}]` renders a heading followed by equal-sized button rows, with eight CSS pixels between groups. Actions may pass `args` and set `active`. `cancel` optionally names a registered cancellation operation: while busy, the same enabled button shows Stop and invokes it. Without cancel, a busy action is disabled. `context.requestAttributes()` refreshes the action label, enabled/busy state and progress. Only the printer Slice action is authorized to show short progress. `context.update(hash, params)` validates existing parameter names/types and applies a small native Undo transaction; call it only after successful snapshot validation.

Viewport descriptors may include `render({pass,camera,frame,orthographic,hash,params,device})` and `retire(hash)`. Render receives the already-open color/depth pass and shared camera/object-frame uniform buffers; it may bind plugin-owned pipelines/resources and draw compact output, without ending the pass. `stage:'opaque'` draws before native transparent geometry; the default is the overlay stage. Empty `lines` supports render-only plugins without compiling a surface-warning pipeline. `retire` runs on owner deletion and session/device teardown. Revalidate derived output before drawing and release it on signature changes. The core retains ownership of borrowed uniforms/pass/device. Camera rotation includes the Top view reflection (+X right, +Z up); transpose remains its inverse. The camera modes.w value is one for reflected Top and zero otherwise, allowing custom front-face shading to preserve orientation. Declared manifest `assets:[relativePath,...]` lists additional same-origin plugin modules/workers to preload atomically into a fresh offline shell; it does not eagerly execute those modules.

## Automation and persistence

Plugins with independent authoring arrays may use `context.document.setRecord(hash,key,type,values)`. Keys are 32-hex field identities; binary records are independently addressed per owner. Types use the native HASH primitive encoding (Atomic uses uint32 stable IDs/species, float64 positions/frames and Frame-ID references). Values are immutable: replace the record through setRecord rather than changing an existing array. Authoring metadata contains only the field layout. Copy, clipboard, merge and HASH remap owner/reference identities. Unknown addressed extension records are ignored. Runtime GPU state must not be stored as authoring records. Native and UI Undo share immutable resources and account retained values against the existing RAM budget.

`context.document` supplies the actual native nodes and narrow own-object create/find/record/frame/material/remove/select operations, transactions and snapshot/checkpoint restoration. It does not own a second scene. `context.math` is Frame's affine math. `context.editor.register(hooks)` integrates native component selection, bounds, GPU pick/marquee/snap, row selection, transform begin/apply/finish, restore, copy/reparent, animation restrictions and animation/flush hooks. Component transforms receive the same world delta as ordinary components; finish may await a bounded authoring readback. Frame notification hooks allow Fixed positions to follow authored frames. Mutations must use native transactions. Shared device/pass/camera buffers remain borrowed.

`flush({output:true,frame})` is awaited after animation and before a Viewport image/video frame is rendered. Simulation plugins must finish the configured physical interval and GPU work before returning. Interactive work must serialize with output work. Camera Renderer defaults to Path tracer; Viewport includes the ordinary realtime plugin passes.

```js
await frameAI.call('plugins.list');
await frameAI.call('plugins.create', {plugin: '3d-printer'});
await frameAI.call('scene.create', {type: 'printer'});
```

`window.framePlugins` also exposes `ready`, `list()` and `create(plugin, type?)` for local integrations. Scene inspection and all ordinary object commands operate on plugin objects. HASH stores the plugin ID, object type and parameter values in native authoring metadata, together with ordinary frames, hierarchy and animation. Opening such a file requires the corresponding plugin to be installed; an unknown plugin is rejected during validation rather than silently converted into another object.

## Initial printer

The independent printer owns its native box/axis/warning rendering and persistent orthogonal GPU LDIs in one plugin.js. Slice builds and cleans depths along local X/Z for every layer; even-odd fill is per evaluated occurrence and intervals unite across occurrences. Finish layer reconstructs one white/transparent topmost coverage image from those retained intervals, without revisiting triangles or rebuilding either LDI. Two balanced axial tests average to half opacity when they disagree; an ambiguous ray is excluded, leaving its balanced orthogonal direction to supply coverage. Two ambiguous directions remain transparent. Near depth events retain their parity; only identical depth/plane duplicates collapse. Sampling pitch, bounded-resolution changes and ambiguous open-shell rays are explicit API diagnostics. Start layer and Layer position are stored for later planning and do not override Finish-only coverage. Selected-layer constant-width perimeters are implemented below; joint bead-width planning and machine toolpaths remain deferred. See app.md and plugins/3d-printer/AGENTS.md for bounds, ownership and the inspection API.

Run `npm run test:plugins` for registration without eager execution, creation, settings and HASH round-trip coverage, together with the related modeling interaction regressions.

Each plugin owns `AGENTS.md` documenting its behavior/invariants and `tests/index.mjs` exporting `async pluginChecks(page)`. It returns `{pass,checks,timings,error?}` using the existing real-browser/API session. `tests/plugin-infrastructure.mjs` discovers installed plugins' test entry points from `plugins/index.json`; both standard and stress runs execute them. The printer checks native icon sizing, repeated real icon clicks, layer spacing, cube top/underside/bed pixels across shading modes and parameter-animation HASH round trips. They also run persistent GPU LDI correctness and numerical checks; `npm run test:slicer` runs it alone.


Additional printer checks: npm run test:slicer:corpus validates all 27 fixtures and the unchanged incoming STL. npm run test:slicer:performance measures all-layer builds on 4000 layers, bounded GPU memory, Finish-to-frame completion and CPU/GPU frames.

Viewport descriptors may set surfaceSelection: 'last-active' to draw their surface overlay for the most recently active eligible owner only. Other owners still draw their helpers and custom preview. The core remembers the owner across ordinary selection changes and falls back when it becomes unavailable. All plugin owner frame changes invalidate native raster caches.

scene.capture(hash, keys) also returns contentSignature, a token for the same evaluated geometry/resources, visibility and requested parameters, excluding relative frames. signature still includes each evaluated source frame relative to the plugin owner, so a common assembly transform preserves the token. Pure frame-version increments do not masquerade as geometry edits. scene.transforming is a read-only boolean for native manual/numeric transforms; plugins may defer derived jobs until it clears. These values borrow no extra geometry and do not weaken stale-resource validation. The printer uses them for a single coalesced LDI refresh after relative-frame changes to an already sliced scene. Its initial generation still requires Slice; cancellation, retirement and device/source changes retain ordinary ownership rules.

Printer inspection accepts layer, axis (X/Z), ray offset/count and returns cleaned depth interval pairs, bounded to 4096 intervals. coverage:true instead reads up to 256 texels of the displayed Finish layer, with a row-major pixel offset. A mismatched layer rejects; read-only inspection does not switch the displayed layer.

Printer control revision: the three physical width/height fields are 0.1..100, Perimeters is 1..1000, Min path length is removed, and Overhang angle follows Layer position. Filled coverage is topmost in all shading modes. Helper hits remain below gizmos in the viewport stacking context; asynchronous pipeline preparation does not block first object publication.

Viewport registration resolves once its validated descriptor is installed. Shared GPU pipeline preparation continues asynchronously; the renderer skips a pending helper and requests a redraw on completion. Plugins should coalesce their own asynchronous render preparation and never block owner publication on compilation.


Printer overlap cleanup (2026-10-26): transient GPU union/find labels canonical connected shells. Balanced shell rays use nonzero winding before the established even-odd shell/occurrence-union combination; unbalanced winding falls back to geometric parity. The shell labels and plane metadata share one transient storage binding, preserving the device's eight-storage-buffer and 16 KiB workgroup limits. Status topology is nonzero-shell-even-odd-occurrence-union. Runtime readback remains 56 bytes. tests/stl-oracle.mjs independently checks test.stl connectivity and layers including 438.


Plugin editor presentation uses the core-owned `overlay()` descriptor `{hash,columns,cells}`. Cells contain `{label,column,row,color,action,args?,active?}` and invoke registered operations. The core places transparent controls in the active viewport and removes them when the descriptor is absent. `rowColor(node)` may supply the ordinary Browser name color. No plugin Browser implementation is needed.

Attribute descriptors additionally support action `row`, `active` and `disabled`, `units:{field:unit}`, and `vectors:[{label,fields:[x,y,z],unit}]`. The core groups native editable fields without changing parameter/history/animation binding. `document.materialize(hash,rgb)` creates a normal material/tag when absent, inside the plugin's native transaction; `editMaterial(hash)` opens the existing editor.

`flush(options)` is the plugin frame-completion barrier: independent plugin promises run concurrently and every promise must resolve before authoring/export proceeds. For output, animation runs first and each solver advances its own exact requested interval before the common GPU queue is awaited. Shared viewport pipeline preparation remains asynchronous; plugin initialization must not await unrelated plugin work.

The core renders `attributes.units` beside scalar row labels in parentheses and vector `unit` beside the merged vector row label. Units never occupy numeric inputs or their control group.

Document selection in the objects area activates native Attributes. Shared overlays sit six pixels below the viewport edge and show active cells as pressed buttons. Atomic detachment puts effective appearance on native groups rather than duplicating atom material tags.

Editor hooks may implement asynchronous `navigation(x,y)` returning `{depth}` for a visible surface hit, or null. Depth is distance along the shared normalized camera ray, matching the native mesh ray picker. The host reconstructs the exact world point and compares it with native mesh/spline hits. A plugin must preserve native occlusion when producing its hit. Atomic uses this for orbit/zoom under the pointer without reading its atom state back to the CPU.

Plugin operations may provide a synchronous `interrupt(hash,args)` hook to stop their own background scheduling before the global API settles. Both command and operation input schemas are validated before this hook runs. It must not mutate authoring data or start GPU work. Its return value is supplied as the third argument to the normal asynchronous `run(hash,args,interruption)`; that handler still runs through the ordinary validated command queue and drains owned work. `plugins.describe` exposes `interruptible` and omits implementation callbacks. Atomic Pause and Toggle Play use this common path, including native attribute buttons.

## Shared simulation timeline

The document bridge exposes read-only `playing`, `frame`, and `pause()`. Plugins can provide an editor `simulationActive()` hook and perform exact frame work in `flush({simulation:true,frame})`; the common 60 fps timeline awaits all plugin flushes before the next frame. Video export calls `flush({reset:true})`, then evaluates every frame from zero and calls simulation flush for frames greater than zero, including preroll. `output` alone captures the current state. No plugin-local timer is needed. Ordinary scrub is animation evaluation only.

Object manifest `disable:false` omits the green Browser control for non-computational rows. Viewport registration `enabledAffectsVisibility:false` separates green computation state from red visibility; the default retains existing viewport behavior. Both properties are validated.


October 28: native scene Open requests a full viewport redraw after lazy plugin activation completes, including render-only descriptors with empty helper lines. Atomic Confinement adds a nonnegative radial force toward its local pivot. Timeline Loop preserves each world across authored frame wrap; animation.loop changes that same toggle. Printer topology is shell-overlap-union-nested-parity-occurrence-union: an initial all-ray GPU pass joins interleaving disconnected shells within an occurrence, then joined shells unite before nested-cluster parity. Labels reuse existing GPU scratch and runtime readback stays at 56 bytes. Sampling limits remain explicit.


## GPU perimeter polylines (2026-10-28)

The default pivot and positive colored axes share local (-500,0,-500); all three axes stay inside the 1000 mm build box. Existing explicitly authored pivots retain native ownership.

Slice retains the two all-layer LDIs and builds the selected Finish layer's connected perimeter polylines on the shared GPU. Perimeters requests centerlines at (index + 0.5) times Line width inward from every filled boundary, including holes. Offsets disappear when no material remains and split naturally at narrow necks. A terminal offset collapsing exactly to a point or line is discarded independently, preserving earlier loops; status reports collapsedLoops. The first centerline is W/2 inward, preserving room for the nominal-width bead. The current view shows white lines and cyan 3-physical-pixel square control points, with an unfilled interior. Two indirect draws consume compact GPU output; no per-segment objects or CPU-expanded vertices are created. Coverage reconstruction remains available for numerical inspection.

The GPU reconstructs a piecewise-linear boundary from exact cleaned LDI crossings. Consistent edge identities and an asymptotic saddle decider connect cells. Two neighbouring samples validate a straight side before recovering its corner. A compact occupancy pyramid prunes nearest-segment queries for one reusable local distance field, with signed exterior values in a bounded band. This is exact distance to the reconstructed segments, not a jump-flood approximation or a full-volume voxel grid. Offset crossings use safeguarded Newton refinement; resolved sharp corners intersect the adjacent side tangents. GPU pointer doubling labels closed loops. Double-farthest RDP and a bounded farthest-feasible walk compete for the smaller valid output. Both check every skipped raw vertex against its replacement chord. This suppresses detail below the requested tolerance without modifying the source mesh. A work-limit fallback retains raw vertices rather than accepting an unchecked error. No global minimum-segment proof is claimed.

The temporary native attribute Max deviation defaults to 0.02 mm and ranges from 0.0001 to 10 mm. It bounds polyline simplification relative to the reconstructed offset path. It does not certify total error against triangles or sub-sample topology: grid.pitch and resolutionLimited remain separate diagnostics. W/2 offsets, curve reconstruction and Float32 arithmetic have their own errors. A 2 mm-width test measured about 0.021 mm combined radial error at 0.02 mm simplification tolerance. Width-dependent subpixel features, arbitrarily damaged surfaces and a machine-ready swept-strip guarantee are outside this sampled stage.

Finish changes reuse the exact all-layer job and rebuild only one layer's derived field/paths. Perimeters changes reuse the field and rebuild its graph; Max deviation changes reuse both field and graph. Redraws and common assembly motion reuse all derived buffers. Relative transforms retain the existing coalesced rebuild. Every printer owns its resources and retires both LDI and path buffers on deletion/staleness; HASH saves native parameters/frames only. One layer of paths is retained, preventing an all-layer fine-grid allocation. The GPU supports at most 262144 raw path slots and 32768 vertices per loop. Overflow or an open/oversized loop suppresses the complete path draw and reports a perimeter error; it never publishes an open partial trajectory. LDI metadata remains 56 bytes per Slice; each perimeter update reads 48 additional diagnostic bytes. Geometry remains GPU-owned outside explicit bounded inspection.

plugins.command status adds result.perimeters with state/error, count, firstOffset, spacing, maxDeviation, rawSegments, segments, loops, fieldBuilds, graphBuilds, builds, metadataReadBytes and completion time. inspect {paths:true,offset,count} returns at most 256 segments with endpoint points, stable-within-build id/next links, one-based perimeter and loop identity. It reads the displayed Finish layer and rejects a different layer. raw:true reads the unsimplified graph; boundary:true reads reconstructed source segments for diagnostics. Offsets paginate GPU slots; unused raw slots are omitted. Both paths revalidate the geometry signature and path revision. These diagnostics are not persisted.

npm run test:slicer:perimeters checks analytic rotated squares/circles/concave stars, noise, holes, disconnected islands, narrow-neck splits, build clipping, native pixels, tolerance Undo, paged GPU meshes, exact twelve-segment three-square output and independent error/latency oracles. Standard/stress discover these checks. The existing 4000-layer performance suite also budgets completed path generation and Finish-to-frame changes.


## Mill and generic native tag/presentation bridges

Mill is an independent single-file fixed-axis CAM plugin. Default Slice plans sequential clearing/contours/nonplanar finishes, verifies full analytic sweeps, updates GPU stock and publishes one stream for display/Progress/time/LinuxCNC G-code. Hierarchy is native; Stock/Protected inherit globally. Unsupported frames are red/ignored; green retains helpers. Read plugins/mill/README.md and TODO.md for contracts, limits and uncertified source boundaries.

Material includes all out-of-box Stock/Protected. Operations consume actual preceding revisions/position in native preorder. Display LOD, fine tiles and conservative fields are distinct. Source triangles remain GPU-owned; only bounded fields/generated trajectories are read/stored on CPU. No Printer runtime dependency or duplicate scene exists. Successful jobs publish N/Progress=N; failures/staleness/cancellation/scene/device changes retire derived resources. HASH stores authoring, not jobs.

Generic tag definitions declare kind/name/text; native menus/tag.list/tag.set share ordinary Undo/HASH. textFields declares multiline strings. editor.parameters validates before mutation, created applies defaults and documentChanged invalidates derived state. forbidAnimation may prohibit derived controls. Dynamic numeric ranges refresh without discarding active edits; integer controls use int/stepFixed/keyStep.

editor.surfaceStyle(hash) supplies fallback {color:[r,g,b,a],topmost:boolean}, applied only without effective user materials. editor.surfaceFilter(hash) returns a stable {owner?:hash,shader,buffers:[{buffer,type}]} derived-mask descriptor. Optional owner follows its native visibility, ancestors and Solo, so hiding the owner suppresses both mask and presentation. WGSL declares fragment resources in group 3 and fn pluginSurfaceKeep(world:vec3f)->bool. Core filters before native material/default/fallback shading, preserving inherited/assigned materials, polygon masks, UVs and source geometry ownership. Buffers are plugin-owned and must remain alive while returned; core owns derived pipeline/group caches. No authored material/replacement mesh is created. Wire/cage/component editing addresses original sources. colorFor chooses helper color; rowColor chooses Browser name color.

scene.capture occurrences expose conservative bounds in the requesting object's local frame, derived from existing native bounds without triangle readback. Use them for broad phase, never as replacement geometry. Capture resources/GPU objects must not appear in public status.
