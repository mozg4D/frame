# Frame plugins

Plugins are independent JavaScript modules in `plugins/`, with one directory per plugin. The core discovers metadata, displays icons in **Plugins**, creates ordinary scene objects and saves their parameters. It supplies rendering and editor integration; each plugin owns its operations and visual semantics. The 3D Printer owns its volume helper and immediate face-angle warning. The printer builds persistent X/Z GPU LDIs and reconstructs Finish-layer coverage; the previous vector-contour and perimeter pipelines are removed. The full medial/width planner and machine output are not implemented.

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

`context.attributes.register(hash => ({actions,ranges}))` supplies normal top attribute actions `{id,label,busy,progress,cancel?}` linked to registered operations, plus optional numeric-field range overrides. `cancel` optionally names a registered cancellation operation: while busy, the same enabled button shows Stop and invokes it. Without cancel, a busy action is disabled. `context.requestAttributes()` refreshes the action label, enabled/busy state and progress. Only the printer Slice action is authorized to show short progress. `context.update(hash, params)` validates existing parameter names/types and applies a small native Undo transaction; call it only after successful snapshot validation. No arbitrary saved plugin data or writable geometry leases are introduced.

Viewport descriptors may include `render({pass,camera,frame,orthographic,hash,params,device})` and `retire(hash)`. Render receives the already-open color/depth pass and shared camera/object-frame uniform buffers; it may bind plugin-owned pipelines/resources and draw compact output, without ending the pass. `retire` runs on owner deletion and session/device teardown. Revalidate derived output before drawing and release it on signature changes. The core retains ownership of borrowed uniforms/pass/device. Camera rotation includes the Top view reflection (+X right, +Z up); transpose remains its inverse. The camera modes.w value is one for reflected Top and zero otherwise, allowing custom front-face shading to preserve orientation. Declared manifest `assets:[relativePath,...]` lists additional same-origin plugin modules/workers to preload atomically into a fresh offline shell; it does not eagerly execute those modules.

## Automation and persistence

```js
await frameAI.call('plugins.list');
await frameAI.call('plugins.create', {plugin: '3d-printer'});
await frameAI.call('scene.create', {type: 'printer'});
```

`window.framePlugins` also exposes `ready`, `list()` and `create(plugin, type?)` for local integrations. Scene inspection and all ordinary object commands operate on plugin objects. HASH stores the plugin ID, object type and parameter values in native authoring metadata, together with ordinary frames, hierarchy and animation. Opening such a file requires the corresponding plugin to be installed; an unknown plugin is rejected during validation rather than silently converted into another object.

## Initial printer

The independent printer owns its native box/axis/warning rendering and persistent orthogonal GPU LDIs in one plugin.js. Slice builds and cleans depths along local X/Z for every layer; even-odd fill is per evaluated occurrence and intervals unite across occurrences. Finish layer reconstructs one white/transparent topmost coverage image from those retained intervals, without revisiting triangles or rebuilding either LDI. Two balanced axial tests average to half opacity when they disagree; an ambiguous ray is excluded, leaving its balanced orthogonal direction to supply coverage. Two ambiguous directions remain transparent. Near depth events retain their parity; only identical depth/plane duplicates collapse. Sampling pitch, bounded-resolution changes and ambiguous open-shell rays are explicit API diagnostics. Start layer and Layer position are stored for later planning and do not override Finish-only coverage. Perimeters and toolpaths are deferred. See app.md and plugins/3d-printer/AGENTS.md for bounds, ownership and the inspection API.

Run `npm run test:plugins` for registration without eager execution, creation, settings and HASH round-trip coverage, together with the related modeling interaction regressions.

Each plugin owns `AGENTS.md` documenting its behavior/invariants and `tests/index.mjs` exporting `async pluginChecks(page)`. It returns `{pass,checks,timings,error?}` using the existing real-browser/API session. `tests/plugin-infrastructure.mjs` discovers installed plugins' test entry points from `plugins/index.json`; both standard and stress runs execute them. The printer checks native icon sizing, repeated real icon clicks, layer spacing, cube top/underside/bed pixels across shading modes and parameter-animation HASH round trips. They also run persistent GPU LDI correctness and numerical checks; `npm run test:slicer` runs it alone.


Additional printer checks: npm run test:slicer:corpus validates all 27 fixtures and the unchanged incoming STL. npm run test:slicer:performance measures all-layer builds on 4000 layers, bounded GPU memory, Finish-to-frame completion and CPU/GPU frames.

Viewport descriptors may set surfaceSelection: 'last-active' to draw their surface overlay for the most recently active eligible owner only. Other owners still draw their helpers and custom preview. The core remembers the owner across ordinary selection changes and falls back when it becomes unavailable. All plugin owner frame changes invalidate native raster caches.

scene.capture(hash, keys) also returns contentSignature, a token for the same evaluated geometry/resources, visibility and requested parameters, excluding relative frames. signature still includes each evaluated source frame relative to the plugin owner, so a common assembly transform preserves the token. Pure frame-version increments do not masquerade as geometry edits. scene.transforming is a read-only boolean for native manual/numeric transforms; plugins may defer derived jobs until it clears. These values borrow no extra geometry and do not weaken stale-resource validation. The printer uses them for a single coalesced LDI refresh after relative-frame changes to an already sliced scene. Its initial generation still requires Slice; cancellation, retirement and device/source changes retain ordinary ownership rules.

Printer inspection accepts layer, axis (X/Z), ray offset/count and returns cleaned depth interval pairs, bounded to 4096 intervals. coverage:true instead reads up to 256 texels of the displayed Finish layer, with a row-major pixel offset. A mismatched layer rejects; read-only inspection does not switch the displayed layer.

Printer control revision: the three physical width/height fields are 0.1..100, Perimeters is 1..1000, Min path length is removed, and Overhang angle follows Layer position. Filled coverage is topmost in all shading modes. Helper hits remain below gizmos in the viewport stacking context; asynchronous pipeline preparation does not block first object publication.

Viewport registration resolves once its validated descriptor is installed. Shared GPU pipeline preparation continues asynchronously; the renderer skips a pending helper and requests a redraw on completion. Plugins should coalesce their own asynchronous render preparation and never block owner publication on compilation.
