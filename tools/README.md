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
| `scene.new` | Empty native document; reset file target, materials, timeline and history |
| `scene.create`, `scene.update`, `scene.delete` | Implemented objects, parameter edits and recoverable deletion; generators accept ordered `inputs` and optional `parent`; Extrude/Lathe evaluate every child independently, including nested groups |
| `scene.select`, `selection.pick` | Owners or explicit spline/mesh Vertex IDs; CSS picking and Select Connected for all component modes |
| `scene.convert` | One To Editable step: solid → spline patch → polygon mesh; curve → editable spline |
| `spline.inspect`, `spline.replace`, `spline.tangents`, `spline.rebuild` | Authored/evaluated cage, validated replacement, Soft/Hard/Equal Tangents |
| `mesh.edit`, `selection.loop`, `selection.soft` | Native polygon topology operations, Frame edge loops and surface-distance falloff; validated worker input, normal Undo |
| `view.solo` | Freeze selected owners/descendants as a temporary visibility filter |
| `diagnostics.appearance` | Explicit UV corner samples/digest and material face-mask counts/samples |
| `mesh.create` | Explicit triangle geometry, ordinary or texture-backed GPU storage |
| `mesh.inspect`, `mesh.replace` | Explicit native vertex/face IDs and dihedrals; validated replacement through native topology history and material lineage |
| `transform.set`, `edit.history` | Normal numeric transactions and Undo/Redo |
| `view.set`, `view.project`, `view.pick` | Per-view shading/layout/modes/options/focus, camera replay (12/23/27 values), world/screen navigation target |
| `scene.open`, `scene.export`, `scene.share` | Same-origin HASH/OBJ/STL/glTF/GLB, packed scene URL or bounded base64; HASH, binary STL or native GLB (`format: hash|stl|glb`, default hash) size/digest/data; portable gzip/base64url Share URL |
| `diagnostics.mesh`, `diagnostics.frame`, `diagnostics.pixels` | Explicit finite/index/SHA checks, fresh-frame timings or up to 64 rendered RGBA pixels |

Generator `evaluation.report.diagnostics` exposes `generatedFamily`, `knownSurfaceKinds` and construction cell counts when Extrude, Lathe or Sweep supplied a transient plan. Incremental GPU updates retain these diagnostics. Make Editable intentionally drops the plan: ordinary source cages and HASH contain geometry only, and the shared resolver/classifier reconstructs their cells.

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

## Direct polygon modeling

`mesh.inspect {id,vertices?,faces?,topology?,angle?}` returns local millimetre positions and canonical triangle vertex IDs. With neither ID array it returns the complete mesh up to 10,000 vertices/faces; larger geometry requires explicit IDs. Empty arrays request no samples. Readback is bounded to 32 MiB. `topology:true` additionally audits up to 100,000 triangles using exact-position aliases: boundary/nonmanifold edges, winding disagreements, degenerate triangles, signed volume and edges at or above `angle` (default 46 degrees). This is an incidence/angle diagnostic, not an intersection certificate. No CPU geometry is retained.

`mesh.replace {id,vertices,indices,sourceFaces?,uv?}` reuses native topology upload/publication and one Undo. `sourceFaces[f]` names the old face whose material selections the new triangle inherits; -1 is unassigned. Masked owners require the complete mapping. An owner with imported UV requires explicit finite UV pairs for every new triangle corner. Matrices, pivot, hierarchy and buffer/texture storage follow the existing polygon edit path. Morph owners reject; native topology IDs can change, so use the returned object hash. All validation happens before mutation, including Float32 overflow and lineage bounds. Same-count position changes are supported.

`scene.select {ids:[id],mode:'polygon',components:[faceIDs...]}` selects canonical triangle IDs without screen picking. `material.assign {id,material,faces:[faceIDs...]}` creates an explicit native face mask independently of visibility/current mode; omitting `faces` keeps whole-owner assignment. `view.set {focusSelection:true}` uses native component focus; it is exclusive with object `focus`. `scene.inspect.materialEditor.material` gives the currently displayed material UID. These tools enable inspect -> construct -> replace -> assign -> multi-view/angle audit -> Undo/Redo checks without an ID image or a parallel scene model.

Polygon Unite retains the invoking element mode. Its selected output contains only the processed islands, leaving passthrough islands unselected. Native Undo and Redo preserve the corresponding component selections.

Extend v1 by adding a schema/handler in the `initializeFrameAI` registry in `index.html`, reusing editor operations, and adding a regression. Both MCP and tests discover the new command automatically; the adapter carries no duplicate tool implementations. Breaking changes require a new API version.

The AI developer owns API/MCP maintenance: extend missing or inconvenient controls/diagnostics while doing application work, with schemas and regressions. For the already-open embedded tab, direct `frameAI.call` is the shortest route and controls that exact scene; MCP is the transport for external MCP clients. UI input tests still verify event delivery/focus.

Share returns `https://mozg4d.github.io/frame/#scene=v1.<gzip-base64url-HASH>`. It does not upload anything. `scene.open` can decode the fragment locally, without fetching that host; startup accepts the same fragment. Limits: 16 MiB packed / 512 MiB unpacked, with lower practical URL limits possible in browsers/messengers. Before the new application is published, the hosted URL is for exchanging the bug scene; the local application/API can already read it.

Discover the current tool registry with `frameAI.listTools()`. First To Editable of a solid creates a spline_patch owner with a child editable spline; `sources` gives child hashes. Approximation belongs to that child. Source operations accept the patch hash as an alias of its sole editable source; ambiguous replacement is rejected before mutation, and multi-source inspect returns the combined cage; spline.inspect returns both owner and actual source id, and reports the owning surface build. Second conversion bakes the mesh and removes source children with Undo support. Existing embedded cages are normalized on load.

`spline.rebuild({id})` forces a fresh resolver and full build for diagnostic comparison, without changing source or Undo. `diagnostics.mesh({id,geometry:true,cells:[0,2303]})` additionally hashes interior positions of named general surface cells (maximum 64), allowing untouched GPU ranges to be checked across edits. `scene.inspect.lighting` exposes baked studio light parameters. Connected counts now refer to elements of the active mode, with visited vertex count in `vertices`.

For `.gltf` URL imports, relative resources must share the scene origin. Local Open supports multiple files so select the `.gltf` plus its `.bin` and image files together; GLB needs one file. Every glTF mesh-node stays one object with material masks and imported corner UVs. `mesh.edit` returns the resulting object/hash because recoverable topology replacement may assign a new native owner. `diagnostics.mesh` accepts `volumeOrigin:[x,y,z]` for consistent signed integration of open surfaces. Boolean reports `watertight`, `inheritedDefects`, `orientationWarnings`, and `newDefectCount`; `trusted` is the publishability contract, including inherited nonmanifold inputs.


Material/camera updates:
- `material.texture`: required `material` UID and `slot` (`baseColor|emissive|roughness|metalness|opacity|normal|ao`). Load with exactly one same-origin `url` or image `base64` (16 MiB max). Optional `channel:r|g|b|a|luminance` for scalar maps; `packed:true` assigns ORM from roughness/metalness/AO slots. `remove:true` takes no source/options. AO requires a UV owner. The returned material UID may change when editing immutable Default. Uses native editor transactions/Undo and waits for atlas readiness.
- `material.create` scalar `bump` means normal-map strength in percent; Emissive and normal strength can exceed 100. Other percentages stay 0..100, H 0..360. Images are assigned separately.
- `spline.inspect.display.visibleHandles` reports the currently exposed tangent control IDs; hidden handles do not participate in hit testing.
- `render.pixels` accepts `linear:true`: returns bounded HDR film RGB + sample count, independent of exposure/denoising. Default remains display RGBA.
- Create any number of `scene.create {type:'render'}` cameras. `scene.update {id,enabled:true}` activates one exclusively. Active camera frame/FOV drive Perspective and render; ordinary transform commands edit camera frames. `render.start` switches a single orthographic workspace to Perspective.

`scene.group`, `scene.connect` and `scene.merge` use normal native hierarchy/conversion/import transactions. `scene.inspect.selection.splines` exposes component sets for all selected cages. Discover exact schemas with `frameAI.listTools()`.


## Embedded Text spline conversion

`node tools/convert-text-font.mjs <older-index.html>` reproduces the native font asset from an earlier Frame index containing the original Droid Sans outline data. The converter runs that version's original fitting kernel for all 591 characters, retains layout arithmetic order, source SHA-256 and original font attribution, and writes only the compressed spline presets into the current index.html. Original outline definitions and their parser are absent from the current runtime. `npm run test:text-presets` checks every curve against the immutable original reference and a completed large-Text latency budget.

## Polygon Unite

`geometry.unite {ids?,selectedIslands?,fillRule?}` uses the native context-menu operation and returns `{object,report}`. IDs identify distinct editable polygon objects without an active Morph tag. With no IDs it uses the current selection. Explicit IDs default to whole objects; `selectedIslands:true` expands current component seeds to complete exact-position-connected islands and preserves unselected geometry. `nested-union` is default; `union` fills all shells; global `even-odd` toggles all shells/occurrences. Invalid arguments, damaged external open surfaces and unresolved numerical/capacity conditions reject before scene replacement. Normal Undo/Redo and HASH are reused. See `../tests/unite.md` for source semantics, precision and performance accounting.

`mesh.create` stores explicit Float32 coordinates and triangle indices without a distance weld. It intentionally preserves raw winding/duplicate geometry so diagnostics and preparation operate on the requested input. Distinct representable nearby vertices remain distinct.

## Common fields and Scene Control authoring

`fields.list({owner})`, `fields.read({owner,field})` and `fields.readBatch({reads,epoch?})` use canonical native owner hashes and stable field IDs (`name`, `visible`, `param:<exact key>`). Discover access, phase, units, range, availability and CAS tokens rather than inferring write support from object type or label. Reads do not activate lazy plugins or complete simulation.

`fields.write({writes:[{owner,field,value,epoch,revision}]})` prevalidates one to 128 unique targets and uses one native Undo transaction without changing selection. Stale tokens reject with CONFLICT; unsupported/read-only targets reject with UNSUPPORTED. No-ops create no history. Currently writable parameters are Cube size x/y/z and Atomic Temperature, Damping, Time scale, Confinement and Color. Animated parameters are explicitly read-only through this adapter. Generic scene.update and Atomic settings use the same declared bounds; native Attributes clamps numeric inputs to those bounds. See SCENE-CONTROL-DATA.md for scope and persistence.

Source/schema/binding records in authorData remain inert. Parameter authoring does not imply managed script execution, worker lifecycle, subscriptions or a separate Control panel.

Common author-data/field calls return BUSY while a native numeric edit session is open, including focus before typing. Finish with Enter, blur or Escape and reread CAS tokens before retrying. This protects the editor’s existing full-snapshot cancel behavior without forcibly committing or canceling user input.
