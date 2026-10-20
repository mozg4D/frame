# Frame AI API v1.1

The application exposes `window.frameAI` inside `index.html`, without a network listener, external runtime scripts, a second scene model, or automatic geometry readback. Source of truth for tool names and JSON schemas:

```js
await frameAI.ready;
frameAI.listTools();
await frameAI.call('app.describe');
const cube = await frameAI.call('scene.create', {type:'cube', name:'AI cube'});
await frameAI.call('scene.select', {ids:[cube.hash]});
await frameAI.call('transform.set', {channel:'position',axis:0,value:250,coordinates:'world'});
await frameAI.call('scene.inspect');
await frameAI.call('edit.history', {action:'undo'});
```

Coordinates are millimetres, rotations degrees, screen coordinates CSS pixels. Prefer native object `hash`; the short UI `id` is session-local. Every call validates before mutation, is serialized, and waits for editor/GPU/build queues. Normal editor Undo/Redo is reused. Mutations, Export and Share return `BUSY` during an active interactive gesture; inspection/diagnostics remain available. Calls emit `frame-ai-call` start/complete/error events with command name and sequence, without argument copies.

| Tools | Purpose |
|---|---|
| `app.describe` | API version, supported primitives and their parameter definitions |
| `scene.inspect` | Object metadata, errors, bounds/affine frames, selection, camera, material/light state and counts; no geometry readback |
| `scene.create`, `scene.update`, `scene.delete` | Implemented objects, parameter edits and recoverable deletion; generators accept ordered `inputs` and optional `parent` |
| `scene.select`, `selection.pick` | Owners or explicit spline/mesh Vertex IDs; CSS picking and Select Connected for all component modes |
| `scene.convert` | One To Editable step: solid → spline patch → polygon mesh; curve → editable spline |
| `spline.inspect`, `spline.replace`, `spline.tangents`, `spline.rebuild` | Authored/evaluated cage, validated replacement, Soft/Hard/Equal Tangents |
| `mesh.edit`, `selection.loop`, `selection.soft` | Native polygon topology operations, Frame edge loops and surface-distance falloff; validated worker input, normal Undo |
| `view.solo` | Freeze selected owners/descendants as a temporary visibility filter |
| `diagnostics.appearance` | Explicit UV corner samples/digest and material face-mask counts/samples |
| `mesh.create` | Explicit triangle geometry, ordinary or texture-backed GPU storage |
| `transform.set`, `edit.history` | Normal numeric transactions and Undo/Redo |
| `view.set`, `view.project`, `view.pick` | Per-view shading/layout/modes/options/focus, camera replay (12/23/27 values), world/screen navigation target |
| `scene.open`, `scene.export`, `scene.share` | Same-origin HASH/OBJ/STL/glTF/GLB, packed scene URL or bounded base64; HASH, binary STL or native GLB (`format: hash|stl|glb`, default hash) size/digest/data; portable gzip/base64url Share URL |
| `diagnostics.mesh`, `diagnostics.frame`, `diagnostics.pixels` | Explicit finite/index/SHA checks, fresh-frame timings or up to 64 rendered RGBA pixels |

`scene.inspect` includes `buildError` on unsupported/invalid geometry parameters, just as the Attributes panel does. Such a scene can still be inspected, repaired with `scene.update`, or deleted. Export rejects unfinished/invalid builds. JSON-RPC unknown tools/schema violations return protocol error -32602; errors during tool execution return isError with a message/code. No arbitrary JavaScript/eval tool is exposed. Frame timing waits for fresh, monotonically increasing frame IDs, including pipeline initialization; it fails after 30 seconds without a measured frame. Explicit geometry digests are limited to 32 MiB, inline file data to 16 MiB; use regular file workflows for larger assets. User-originated UI operations are not globally locked by the API: avoid simultaneous manual edits while an AI transaction runs.

## MCP stdio adapter

After `npm ci` and `npx playwright install chromium`:

```powershell
node C:\frame\tools\mcp.mjs
```

The adapter speaks JSON-RPC/MCP **2025-06-18** over newline-delimited stdin/stdout. Only protocol messages go to stdout. It supports `initialize`, `ping`, `tools/list`, `tools/call`; no resources/prompts/HTTP RPC are advertised. Schemas and execution come from the same `frameAI` instance. Default launch opens an isolated visible Frame session on its own temporary localhost server. It closes that owned session on stdin EOF. It does not select the user's existing scene automatically.

Generic client configuration example: `mcp.example.json`. To target one existing Chromium tab explicitly:

```powershell
node C:\frame\tools\mcp.mjs --cdp http://127.0.0.1:9222 --url http://127.0.0.1:56116/index.html
```

The browser must already expose CDP. The adapter requires exactly one page with the given URL; it does not reload that page. This is optional: an AI controlling the embedded browser can call `frameAI.call` there directly. `--headless` is available for systems that support WebGPU in headless Chromium.

Transport/tool references: [MCP stdio](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).

Extend v1 by adding a schema/handler in the `initializeFrameAI` registry in `index.html`, reusing editor operations, and adding a regression. Both MCP and tests discover the new command automatically; the adapter carries no duplicate tool implementations. Breaking changes require a new API version.

The AI developer owns API/MCP maintenance: extend missing or inconvenient controls/diagnostics while doing application work, with schemas and regressions. For the already-open embedded tab, direct `frameAI.call` is the shortest route and controls that exact scene; MCP is the transport for external MCP clients. UI input tests still verify event delivery/focus.

Share returns `https://mozg4d.github.io/frame/#scene=v1.<gzip-base64url-HASH>`. It does not upload anything. `scene.open` can decode the fragment locally, without fetching that host; startup accepts the same fragment. Limits: 16 MiB packed / 512 MiB unpacked, with lower practical URL limits possible in browsers/messengers. Before the new application is published, the hosted URL is for exchanging the bug scene; the local application/API can already read it.

Version 1.1.0 has 24 tools. First To Editable of a solid creates a spline_patch owner with a child editable spline; `sources` gives child hashes. Approximation belongs to that child. Source operations accept the patch hash as an alias of its sole editable source; ambiguous replacement is rejected before mutation, and multi-source inspect returns the combined cage; spline.inspect returns both owner and actual source id, and reports the owning surface build. Second conversion bakes the mesh and removes source children with Undo support. Existing embedded cages are normalized on load.

`spline.rebuild({id})` forces a fresh resolver and full build for diagnostic comparison, without changing source or Undo. `diagnostics.mesh({id,geometry:true,cells:[0,2303]})` additionally hashes interior positions of named general surface cells (maximum 64), allowing untouched GPU ranges to be checked across edits. `scene.inspect.lighting` exposes baked studio light parameters. Connected counts now refer to elements of the active mode, with visited vertex count in `vertices`.

For `.gltf` URL imports, relative resources must share the scene origin. Local Open supports multiple files so select the `.gltf` plus its `.bin` and image files together; GLB needs one file. Every glTF mesh-node stays one object with material masks and imported corner UVs. `mesh.edit` returns the resulting object/hash because recoverable topology replacement may assign a new native owner. `diagnostics.mesh` accepts `volumeOrigin:[x,y,z]` for consistent signed integration of open surfaces. Boolean reports `watertight`, `inheritedDefects`, `orientationWarnings`, and `newDefectCount`; `trusted` is the publishability contract, including inherited nonmanifold inputs.


Material/camera updates:
- `material.texture`: required `material` UID and `slot` (`baseColor|emissive|roughness|metalness|opacity|normal|ao`). Load with exactly one same-origin `url` or image `base64` (16 MiB max). Optional `channel:r|g|b|a|luminance` for scalar maps; `packed:true` assigns ORM from roughness/metalness/AO slots. `remove:true` takes no source/options. AO requires a UV owner. The returned material UID may change when editing immutable Default. Uses native editor transactions/Undo and waits for atlas readiness.
- `material.create` scalar `bump` means normal-map strength in percent; Emissive and normal strength can exceed 100. Other percentages stay 0..100, H 0..360. Images are assigned separately.
- `spline.inspect.display.visibleHandles` reports the currently exposed tangent control IDs; hidden handles do not participate in hit testing.
- `render.pixels` accepts `linear:true`: returns bounded HDR film RGB + sample count, independent of exposure/denoising. Default remains display RGBA.
- Create any number of `scene.create {type:'render'}` cameras. `scene.update {id,enabled:true}` activates one exclusively. Active camera frame/FOV drive Perspective and render; ordinary transform commands edit camera frames. `render.start` switches a single orthographic workspace to Perspective.

`scene.group`, `scene.connect` and `scene.merge` use normal native hierarchy/conversion/import transactions. `scene.inspect.selection.splines` exposes component sets for all selected cages. Discover exact schemas with `frameAI.listTools()`.
