# Frame plugins

Plugins are independent JavaScript modules in `plugins/`, with one directory per plugin. The core discovers metadata, displays icons in **Plugins**, creates ordinary scene objects and saves their parameters. It supplies rendering and editor integration; each plugin owns its operations and visual semantics. The 3D Printer owns its volume helper and immediate face-angle warning. Slicing and machine output are not implemented.

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

`viewport.register` takes `{bounds:{min:[x,y,z],max:[x,y,z]}, lines:Float32Array, color:[r,g,b,a], selectedColor:[r,g,b,a], settings(params), shader}`. Lines contain local endpoint pairs (six floats per segment, at most 10000 segments); bounds and coordinates must be finite. `settings` returns four finite shader constants. `shader` defines `fn pluginSurface(local:vec3f, normal:vec3f, build:vec3f, settings:vec4f)->vec4f`: discard unaffected fragments, or return their warning color. `normal` is the geometric world face normal oriented toward the viewed side, calculated from position derivatives independently of stored normals or winding; `build` is the normalized world local-Y axis. The core supplies the inverse object frame, current evaluated mesh resources, all four cameras and existing raster depth. It supports paged meshes, affine transforms and replicas without geometry readback or a CPU mirror. Wireframe views use a depth-only pass before warnings so hidden surfaces stay hidden.

Registration remains attached to the loaded plugin. The bridge owns and releases its small line/uniform buffers, retires per-object resources after deletion, and recompiles against a replacement shared device. Hiding/disabling an object or an ancestor, and Solo, suppress the display. Local bounds participate in selection, pivot, focus and clipping; transparent SVG hit paths select the same ordinary owner along its helper edges. Compilation errors follow normal plugin activation diagnostics. No saved GPU resources are added to HASH: reopening reconstructs rendering from the installed plugin and native parameters/frames.

Writable GPU leases, jobs, cancellation and plugin-specific saved data beyond parameters are not yet defined.

## Automation and persistence

```js
await frameAI.call('plugins.list');
await frameAI.call('plugins.create', {plugin: '3d-printer'});
await frameAI.call('scene.create', {type: 'printer'});
```

`window.framePlugins` also exposes `ready`, `list()` and `create(plugin, type?)` for local integrations. Scene inspection and all ordinary object commands operate on plugin objects. HASH stores the plugin ID, object type and parameter values in native authoring metadata, together with ordinary frames, hierarchy and animation. Opening such a file requires the corresponding plugin to be installed; an unknown plugin is rejected during validation rather than silently converted into another object.

## Initial printer

`plugins/3d-printer/` contains the printer manifest, SVG and viewport implementation. Its nine setting names/defaults match the previous editor. The r248 box has twelve edges, local X/Z from -500 to 500 mm and Y from 0 to 1000 mm. Edges use the original teal, amber when selected, at 0.65 opacity. The WGSL port marks an exposed face red when `-dot(worldFaceNormal, buildDirection) > sin(Overhang angle) + 1e-6`, excludes the bed at local Y <= 0.001 mm and all fragments outside the transformed volume, and uses ordinary raster depth to exclude buried surfaces. It reacts immediately to geometry, angle, visibility and frame changes. This is an angle warning, not a support or bridge calculation. It has no Slice button, toolpath calculation or machine export implementation.

Run `npm run test:plugins` for registration without eager execution, creation, settings and HASH round-trip coverage, together with the related modeling interaction regressions.

Each plugin owns `AGENTS.md` documenting its behavior/invariants and `tests/index.mjs` exporting `async pluginChecks(page)`. It returns `{pass,checks,timings,error?}` using the existing real-browser/API session. `tests/plugin-infrastructure.mjs` discovers installed plugins' test entry points from `plugins/index.json`; both standard and stress runs execute them. The printer checks native icon sizing, repeated real icon clicks, layer spacing, cube top/underside/bed pixels across shading modes and parameter-animation HASH round trips. Slicing controls and output remain deferred.

## Core / plugin development requests

Read and maintain [requests.md](requests.md) before plugin work and before finishing. This is the sole API request queue in either direction. Always identify `From: plugin:<manifest-id>` or `From: core` and the specific recipient. Recipient chats implement requests autonomously without asking the user, verify the requester can use the result, update this contract and tests, then delete only the fulfilled request. Leave unresolved or unrelated requests in place.
