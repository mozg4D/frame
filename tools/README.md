# Frame AI API v1.3

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

Coordinates are millimetres, rotations degrees, screen coordinates CSS pixels. Prefer native object `hash`; the short UI `id` is session-local. Native calls validate before mutation, serialize, and wait for editor/GPU/build queues. Coordination-only calls bypass that queue and do not wait for GPU/editor work. Normal editor Undo/Redo is reused. Mutations, Export and Share return `BUSY` during an active interactive gesture; inspection/diagnostics remain available. Native calls emit `frame-ai-call` start/complete/error events with command name and sequence, without argument copies.

| Tools | Purpose |
|---|---|
| `app.describe` | API version, supported primitives and their parameter definitions |
| `scene.inspect` | Object metadata, errors, bounds/affine frames, selection, camera, material/light state and counts; no geometry readback |
| `scene.new` | Empty native document; reset file target, materials, timeline and history |
| `scene.create`, `scene.update`, `scene.delete` | Implemented objects, parameter edits and recoverable deletion; generators accept ordered `inputs` and optional `parent`; Extrude/Lathe evaluate every child independently, including nested groups |
| `scene.select`, `selection.pick` | Owners or explicit spline/mesh Vertex IDs; CSS picking and Select Connected for all component modes |
| `scene.convert` | One To Editable step: solid → spline patch → polygon mesh; curve → editable spline; Instance → independent native hierarchy |
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

`scene.inspect` includes `buildError` on unsupported/invalid geometry parameters, just as the Attributes panel does. Such a scene can still be inspected, repaired with `scene.update`, or deleted. Export rejects unfinished/invalid builds. No arbitrary JavaScript/eval tool is exposed. Frame timing waits for fresh, monotonically increasing frame IDs, including pipeline initialization; it fails after 30 seconds without a measured frame. Explicit geometry digests are limited to 32 MiB. HASH inline import/export has no 16 MiB cap; chunked export avoids large JSON replies. User-originated UI operations are not globally locked by the API: avoid simultaneous manual edits while an AI transaction runs.

## Batch, placement and measurement

`frameAI.batch(commands, {continueOnError:false})` and `frameAI.call('api.batch', {commands,continueOnError})` reserve one FIFO slot. Commands run consecutively and return ordered `{index,name,ok,result|error}` receipts plus `completed`. Direct argument schemas are checked before execution. Arguments can reference an earlier result using `{$ref:'alias.hash'}` or `{$ref:'0.hash'}`. Reference-dependent validation occurs when that command runs. Batches stop on the first error unless requested otherwise, retain completed edits and each command's Undo, and reject nested batches. They are not atomic transactions.

```js
const result = await frameAI.batch([
  {name:'scene.create', args:{type:'group',name:'Assembly'}, as:'assembly'},
  {name:'scene.create', args:{type:'cube',parent:{$ref:'assembly.hash'}}, as:'part'},
  {name:'transform.apply', args:{
    position:[200,0,0], rotation:[0,30,0], size:[80,40,20], coordinates:'object'
  }}
]);
```

`transform.apply` accepts any nonempty combination of `position`, `rotation`, and `size` vectors with one native Undo. Both `transform.apply` and `transform.set` accept optional `ids:[nativeHash,...]` to select and transform whole objects within the same FIFO command. Explicit targets leave those objects selected, switch to Object selection mode, disable Pivot Edit and default to World coordinates. Omitting `ids` retains the current object/component-selection behavior. Size is applied in the initial coordinate axes, followed by rotation and position around the pivot; world-space size therefore describes the size before the requested rotation. Object coordinates are convenient for placing a part by its final dimensions and rotation. Flat dimensions stay zero; nonflat dimensions must respect the native positive minimum.

`measure.gap({from:partA,to:partB,direction:[1,0,0]})` normalizes a world direction and returns each part's projected `min/max`, signed `gap = to.min - from.max`, `reverseGap`, and `projectionOverlap` in mm. Positive gap separates the intervals; negative gap indicates projection overlap. This does not measure nearest Euclidean surface distance or certify intersection. Meshes use GPU extrema of evaluated geometry, including occurrences and descendants; curves/plugin bounds set `conservative:true`. Selection remains unchanged.

## Multiple chats in one Frame document

Collaboration coordinates clients attached to the same live Frame page. Join with a descriptive chat name and task, inspect participants/work notes, and release your notes when finished. Notes are advisory: overlapping work is allowed and reported, and ordinary API/manual edits remain available. A group note includes its current descendants by default, including later hierarchy changes. Shared materials and linked sources outside that hierarchy need separate coordination; a note does not discover or lock dependencies. There is no cap on active participants or notes. Names/participant IDs provide attribution within the page, not authenticated identities or a connection to a chat service.

```js
const joined = await frameAI.call('collab.join', {
  name:'Chat: housing', task:'Place mounting holes'
});
const session = joined.participant.id;
const note = await frameAI.call('collab.claim', {
  session, ids:[assemblyHash], task:'Place mounting holes'
});
// note.overlaps is informational. All participants may continue editing.
await frameAI.call('collab.participants');
await frameAI.call('collab.claims', {ids:[assemblyHash]});

const request = {
  session, requestId:'housing-move-001',
  document:joined.document.id,
  name:'transform.apply', args:{ids:[partHash],position:[200,0,0]}
};
const receipt = await frameAI.call('collab.run', request);
// Check receipt.state === 'complete' or 'failed'; inspect receipt.result/error.
// After a lost response, repeat this exact request ID and arguments.
// It returns the same operation's receipt without executing a second time.
await frameAI.call('collab.request', {session,requestId:request.requestId});
await frameAI.call('collab.release', {session,claim:note.claim.id});
await frameAI.call('collab.leave', {session});
```

Use `collab.run` with `name:'api.batch'` for a dependent command sequence. Batches keep their existing per-command Undo and partial-completion semantics: a complete request receipt can contain a batch result with `ok:false`. Coordination tools belong outside batches. Always await dependent requests or put them in one batch; concurrent submissions are scheduled when admitted to the native queue. Existing direct `frameAI.call` clients remain supported and their mutation events have a null participant.

`collab.message({session,to:otherParticipantId,text})` publishes an addressed message; omit `to` to broadcast. Messages are public within this page. Poll `collab.events({session,stream,after,limit})`, keep `stream`, and advance `after` to `nextCursor`, even when no addressed messages are returned. The feed includes presence, notes, request receipts, command activity and observed native revisions. `truncated` or `reset` means reread participants, claims and relevant scene state. Command targets in the feed are bounded hints; they are not a complete geometry/dependency change set. `scene.observed` reports an observed authoring revision, not proof of who made an edit.

Presence expires after 30 minutes idle by default. `collab.update({session,task?,ttlSeconds?})`, attributed requests, and polling events/request status with `session` renew it; `ttlSeconds` accepts 1..86400. Pending requests pin presence until they finish. `collab.release` without a claim releases all your notes; Leave removes your participant and notes. Queued requests recheck presence, while already admitted effects can finish and are never implicitly rolled back.

`collab.participants` returns the current document ID and global `epoch/revision`. Optional `document` in `collab.run` rejects work prepared for another document. Optional `expected:{epoch,revision}` adds conservative scene-wide compare-and-set before handler admission; unrelated authoring edits can invalidate it. Omit this optional precondition for independent work, or use existing field/author-data CAS for their declared operations. Every attributed request also captures its admission document: another New/Open fences queued old-document work. An intentional New/Open within that request's own batch advances its fence. New/Open clears notes but retains participant IDs and receipts. Reload clears the entire coordination runtime. HASH/Undo contain no coordination state; Undo remains the shared chronological editor history.

Request IDs stay reserved until their participant leaves/expires, even after payload eviction. Keep each ID unique for a new logical operation. The last 128 small result payloads share a 4 MiB budget; individual cached payloads are at most 256 KiB. Large results are returned to the original caller once. A later receipt with `resultAvailable:false` still identifies the completed/failed request: inspect the model or retained export transfer instead of submitting the edit with a new ID. Failures do not imply rollback. The event feed retains 2048 events and explicitly reports gaps. Participant/claim lists accept offset/limit pagination; these retention/page bounds do not restrict scene edits or active chat count. All coordination operates in the existing page; separate Frame documents do not automatically synchronize.

Focused checks: `npm run test:collaboration:cpu` and `npm run test:collaboration` (isolated native browser, DPR 1).

## Named HASH files for AI clients

Instances accept `params.file` with every supported import format, using the same native importers. Assigning a nonempty File clears Object; assigning Object clears File. Sources update automatically after completed external saves, including nested files and glTF resources. `instance.files` reports loaded versions, readiness, errors and granted folder identities. A failed/missing source keeps its last complete display and colors its Instance red.

**Instance → File → Choose file** links a HASH, STL, OBJ, glTF, GLB, PLY, VTK, 3MF, SVG, STEP/STP or DXF directly. Frame remembers a browser-granted file in this profile and watches it for saves. If a model references other files, **Choose source folder** gives Frame access to its dependencies. Browsers with a standard file input keep a snapshot instead. Select the model together with its supporting files and select them again to refresh. A shared assembly uses paths relative to its project folder. For automation, use relative paths under that granted project folder, same-origin URLs, or authorized local-host paths. Host grants still belong to the host startup command and cannot be expanded by scene arguments. File references remain linked through HASH, Duplicate and Merge. `scene.convert({id:instanceHash})` or `scene.connect({ids:[instanceHash]})` uses Make Editable to unpack the native hierarchy, recursively localizing file dependencies while retaining editable parameters, cages, materials and placement in one Undo. Source Scene Control code remains inert while linked.


`scene.export({ids:[partHash],format:'hash',includeData:true})` exports a part with descendants and declared dependencies, preserving world placement and native authoring. Omit `ids` for the whole document. Neither selection nor clipboard changes. Inline import/export has no application file-size cap, but large base64 strings still need browser/client memory.

`scene.saveAs({name:'part.hash',ids:[partHash]})` returns a named immutable file transfer without a picker or changing the current project binding. `scene.export({transfer:true,name:'assembly.hash'})` exposes the same transfer for whole-document export. Results contain `name`, `bytes`, `sha256`, and `transfer:{id,url,chunkBytes}`. The Blob URL belongs to this document; external AI clients should read chunks and write them using their own filesystem/attachment tools. `download:true` optionally requests a browser download, subject to browser download policy. Up to eight transfers may be retained; release them explicitly after saving. An authorized `scene.saveAs({path})` continues to save and bind through the local file host.

```js
const file = await frameAI.call('scene.saveAs', {name:'part.hash',ids:[partHash]});
let offset = 0;
try {
  while (true) {
    const chunk = await frameAI.call('scene.export.read', {id:file.transfer.id,offset});
    // Receiving AI client: decode chunk.base64 and append bytes to file.name.
    offset = chunk.nextOffset;
    if (chunk.eof) break;
  }
  // Receiving client: verify total bytes and SHA-256 before attaching the file.
} finally {
  await frameAI.call('scene.export.release', {id:file.transfer.id});
}
```

Chunk reads are at most 1 MiB and need no scene evaluation. Exported files survive New/Open until released. The separate portable Share URL keeps its packed-size/browser URL limits.

## Direct polygon modeling

`mesh.inspect {id,vertices?,faces?,topology?,angle?}` returns local millimetre positions and canonical triangle vertex IDs. With neither ID array it returns the complete mesh up to 10,000 vertices/faces; larger geometry requires explicit IDs. Empty arrays request no samples. Readback is bounded to 32 MiB. `topology:true` additionally audits up to 100,000 triangles using exact-position aliases: boundary/nonmanifold edges, winding disagreements, degenerate triangles, signed volume and edges at or above `angle` (default 46 degrees). This is an incidence/angle diagnostic, not an intersection certificate. No CPU geometry is retained.

`mesh.replace {id,vertices,indices,sourceFaces?,uv?}` reuses native topology upload/publication and one Undo. `sourceFaces[f]` names the old face whose material selections the new triangle inherits; -1 is unassigned. Masked owners require the complete mapping. An owner with imported UV requires explicit finite UV pairs for every new triangle corner. Matrices, pivot, hierarchy and buffer/texture storage follow the existing polygon edit path. Morph owners reject; native topology IDs can change, so use the returned object hash. All validation happens before mutation, including Float32 overflow and lineage bounds. Same-count position changes are supported.

`scene.select {ids:[id],mode:'polygon',components:[faceIDs...]}` selects canonical triangle IDs without screen picking. `material.assign {id,material,faces:[faceIDs...]}` creates an explicit native face mask independently of visibility/current mode; omitting `faces` keeps whole-owner assignment. `view.set {focusSelection:true}` uses native component focus; it is exclusive with object `focus`. `scene.inspect.materialEditor.material` gives the currently displayed material UID. These tools enable inspect -> construct -> replace -> assign -> multi-view/angle audit -> Undo/Redo checks without an ID image or a parallel scene model.


Extend v1 by adding a schema/handler in the `initializeFrameAI` registry in `index.html`, reusing editor operations, and adding a regression. Tests discover the new command automatically. Breaking changes require a new API version.

The AI developer owns AI API maintenance: extend missing or inconvenient controls/diagnostics while doing application work, with schemas and regressions. For the already-open embedded tab, direct `frameAI.call` is the shortest route and controls that exact scene. UI input tests still verify event delivery/focus.

Share returns `https://mozg4d.github.io/frame/#scene=v1.<gzip-base64url-HASH>`. It does not upload anything. `scene.open` can decode the fragment locally, without fetching that host; startup accepts the same fragment. Limits: 16 MiB packed / 512 MiB unpacked, with lower practical URL limits possible in browsers/messengers. Before the new application is published, the hosted URL is for exchanging the bug scene; the local application/API can already read it.

Discover the current tool registry with `frameAI.listTools()`. First To Editable of a solid creates a spline_patch owner with a child editable spline; `sources` gives child hashes. Approximation belongs to that child. Source operations accept the patch hash as an alias of its sole editable source; ambiguous replacement is rejected before mutation, and multi-source inspect returns the combined cage; spline.inspect returns both owner and actual source id, and reports the owning surface build. Second conversion bakes the mesh and removes source children with Undo support. Existing embedded cages are normalized on load.

`spline.rebuild({id})` forces a fresh resolver and full build for diagnostic comparison, without changing source or Undo. `diagnostics.mesh({id,geometry:true,cells:[0,2303]})` additionally hashes interior positions of named general surface cells (maximum 64), allowing untouched GPU ranges to be checked across edits. `scene.inspect.lighting` exposes baked studio light parameters. Connected counts now refer to elements of the active mode, with visited vertex count in `vertices`.

For `.gltf` URL imports, relative resources must share the scene origin. Local Open supports multiple files so select the `.gltf` plus its `.bin` and image files together; GLB needs one file. Every glTF mesh-node stays one object with material masks and imported corner UVs. `mesh.edit` returns the resulting object/hash because recoverable topology replacement may assign a new native owner. `diagnostics.mesh` accepts `volumeOrigin:[x,y,z]` for consistent signed integration of open surfaces. Boolean reports `watertight`, `inheritedDefects`, `orientationWarnings`, and `newDefectCount`; `trusted` is the publishability contract, including inherited nonmanifold inputs.


Material/camera updates:
- `material.texture`: required `material` UID and `slot` (`baseColor|emissive|roughness|metalness|opacity|normal|ao`). Load with exactly one same-origin `url`, image `base64` (16 MiB max), or existing `asset` UID discovered in `scene.inspect.materials`. `asset` creates a shared texture instance without decoding/uploading another payload, preserving target channel, independent alpha and normal convention/strength unless an explicit channel or packed mode is supplied. A previously empty Normal slot initializes zero strength to 100. Optional `channel:r|g|b|a|luminance` for scalar maps; `packed:true` assigns ORM from roughness/metalness/AO slots. `remove:true` takes no source/options. AO requires a UV owner. The returned material UID may change when editing immutable Default. Uses native editor transactions/Undo and waits for atlas readiness.
- `material.create` scalar `bump` means normal-map strength in percent; Emissive and normal strength can exceed 100. Other percentages stay 0..100, H 0..360. Images are assigned separately.
- `spline.inspect.display.visibleHandles` reports the currently exposed tangent control IDs; hidden handles do not participate in hit testing.
- `render.pixels` accepts `linear:true`: returns bounded HDR film RGB + sample count, independent of exposure/denoising. Default remains display RGBA.
- Create any number of `scene.create {type:'render'}` cameras. `scene.update {id,enabled:true}` activates one exclusively. Active camera frame/FOV drive Perspective and render; ordinary transform commands edit camera frames. `render.start` switches a single orthographic workspace to Perspective.

`scene.group`, `scene.connect` and `scene.merge` use normal native hierarchy/conversion/import transactions. `scene.inspect.selection.splines` exposes component sets for all selected cages. Discover exact schemas with `frameAI.listTools()`.


## Embedded Text spline conversion

`node tools/convert-text-font.mjs <older-index.html>` reproduces the native font asset from an earlier Frame index containing the original Droid Sans outline data. The converter runs that version's original fitting kernel for all 591 characters, retains layout arithmetic order, source SHA-256 and original font attribution, and writes only the compressed spline presets into the current index.html. Original outline definitions and their parser are absent from the current runtime. `npm run test:text-presets` checks every curve against the immutable original reference and a completed large-Text latency budget.

`mesh.create` stores explicit Float32 coordinates and triangle indices without a distance weld. It intentionally preserves raw winding/duplicate geometry so diagnostics and preparation operate on the requested input. Distinct representable nearby vertices remain distinct.

## Common fields and Scene Control authoring

`fields.list({owner})`, `fields.read({owner,field})` and `fields.readBatch({reads,epoch?})` use canonical native owner hashes and stable field IDs (`name`, `visible`, `param:<exact key>`). Discover access, phase, units, range, availability and CAS tokens rather than inferring write support from object type or label. Reads do not activate lazy plugins or complete simulation.

`fields.write({writes:[{owner,field,value,epoch,revision}]})` prevalidates one to 128 unique targets and uses one native Undo transaction without changing selection. Stale tokens reject with CONFLICT; unsupported/read-only targets reject with UNSUPPORTED. No-ops create no history. Currently writable parameters are Cube size x/y/z and Atomic Temperature, Damping, Time scale, Confinement and Color. Animated parameters are explicitly read-only through this adapter. Generic scene.update and Atomic settings use the same declared bounds; native Attributes clamps numeric inputs to those bounds. See ../AGENTS.md for scope and persistence.

Source/schema/binding records alone remain inert. A frame.scene-control descriptor selects JavaScript source, main or worker:<name>, and manual or ready startup. Execution is arbitrary native JavaScript with no sandbox or tool allowlist; main code can access DOM, globals and frameCore, and may also create its own Workers. Lifecycle helpers are optional.

Descriptor `bindings` maps aliases to indices in its typed `refs`: direct object refs (`{kind:'object',owner:hash}`), direct field refs, or field-binding records. `ctx.bindings` receives these inert addresses in main and Worker contexts. Use an object binding's `owner` with native object operations; no name lookup or live-object proxy is created. Missing targets and `unresolved:true` remain explicit in the address and `authorData.inspect` diagnostics; inspect them before acting. Native operations still resolve their targets normally and reject missing owners. Duplicate/clipboard/Merge remap the typed refs without rewriting source text.

For the always-available Scene Control popup, activate(ctx) can call ctx.control.register(({window,document,root,host}) => { /* build ordinary DOM; optionally return cleanup */ }). The registration retires with the activation; native frameControl.register is also available. The popup restores its own geometry, remounts after Reload and shows a short Codex instruction when no panel is registered. Sources and descriptors persist inside HASH; no external script file or script editor is needed. Inspect programs.describe and frameAI.listTools() for the current host/API. tools/create-crystal-scene.mjs produces scenes/crystals.hash as a native example.

Common author-data/field calls return BUSY while a native numeric edit session is open, including focus before typing. Finish with Enter, blur or Escape and reread CAS tokens before retrying. This protects the editor’s existing full-snapshot cancel behavior without forcibly committing or canceling user input.


### Native spline occurrences and material tags

Generator `scene.create.inputs` and later child reparenting accept native spline Instances and nested groups without copying the authored profile. The source must resolve to native spline geometry. Source pivots, occurrence transforms and source edits remain live through HASH and Undo/Redo. Cyclic Instance/generator dependencies are rejected before mutation. `scene.inspect.sources` lists immediate native spline, Instance and group inputs.

`material.assign {id, material, faces?}` can tag an empty Extrude or other native generator; `faces` still addresses existing triangles only. `material.remove {id, tag?}` deletes one material tag by its discovered UID, or all material tags on that owner when omitted, through native Undo. It does not remove the material from the document or affect tags on other owners.



## Working on a shared assembly

Keep the assembly open in Frame, in a browser or the installed app. Give the coordinating chat the assembly location and assign each editable part to one person or chat. For a printer, one editor can own `printer.hash`, another `head.hash` and another `gantry.hash`. The assembly uses **Instance → File** with relative paths. Everyone needs access to the same saved files. On a new browser profile, **Choose project folder** grants access to the parts from the open assembly. A named browser tab alone does not grant filesystem access.

Start with `app.describe` and `scene.inspect`. Frame also registers native modeling and file tools when the browser exposes WebMCP. WebMCP uses underscores, for example `app_describe` and `scene_file_wait`. The page API uses dotted names. Use `scene.saveAs({path,createOnly:true})` through an authorized host when creating a new part at a shared location. Each editor then uses ordinary Save.

1. Read `scene.file().sync` for the current cursor and versions. An active assistant can call `scene.file.wait({after:cursor,timeoutMs:60000})`. A save to the assembly or a linked part returns a change with its own cursor. Continue from that cursor to drain simultaneous saves.
2. Use `scene.file.changes({cursor,offset,limit})` to page through changed objects, names, positions and record fields. A missed event or a truncated older summary calls for a fresh scene inspection. The open page keeps 32 events and up to 128 detail rows per older event. Closing the page ends the stream. Frame does not start chat turns or assign tasks.
3. A clean assembly follows external saves and restores its view and selected objects. If two editors change the same file, Frame keeps the local draft and shows **Save a copy** and **Reload from disk**. Read the conflict in `scene.file.changes()`. Reload through `scene.file.reload({baseVersion,version:diskVersion})` after reviewing both versions. Another intervening save requires a fresh review.

The host checks the open version and reserves a path while writing. Native browser handles use an exclusive writer and recheck the source before publishing. Independent sync services can replace files outside either writer's control. Across computers, share the project directory and keep one writer per part. Frame watches available saves while its page runs and when it regains focus. Use `scene.file.sync({verify:true})` for a full content check.

## Native PWA file consent

For ordinary PWA users, no local helper, CDP or secret pairing code is necessary. Call scene.file.request({action:'saveAs',name:'project.hash'}). When browser activation is available, it immediately invokes the normal Chrome file picker; Frame adds no modal, text panel or buttons. Otherwise the API returns a pending request with activationRequired and the existing btnSave target (btnOpen for Open). A trusted browser click on that existing control can supply activation. Synthetic click does not create activation, but can use activation already supplied by the automation channel. Poll scene.file().request for completion; scene.file.cancel cancels a pending request.

Use action:'open' to choose and replace the current scene with a HASH project, retaining its native file handle. Call it only when replacement is intended. Cancellation or permission failure before import preserves the current document and target; failed replacement import clears the old Save binding. Use action:'save' to request browser write permission for an existing native handle if necessary. Later scene.save() and toolbar Save reuse a granted handle without another picker, including projects larger than16MiB. The browser owns the permission checks; the application does not impose an extra event.isTrusted gate.

For browser-native handles, scene.file reports bound:true, hostBound:false and path:null: browsers intentionally do not expose absolute filesystem paths. host:false does not indicate a problem for this route. Absolute-path operations for external automation use the separately authorized helper below. No account-specific path or user identity is built into either route.

## Authorized local HASH files

Run the local file host on the computer containing the projects. Grant each exact input/output filename explicitly (the parent directory must exist):

```powershell
node C:\frame\tools\file-host.mjs --allow-file C:\projects\model.hash --allow-file C:\projects\model-copy.hash
```

Connect the intended Frame document with `scene.host.connect` using the host URL and token as described below, then use the ordinary AI API commands:

```js
await frameAI.call('scene.open', {path:'C:\\projects\\model.hash'});
await frameAI.call('scene.save');
await frameAI.call('scene.saveAs', {path:'C:\\projects\\model-copy.hash'});
await frameAI.call('scene.file'); // path, filename, binding, byte count and SHA-256 receipt
```

Command arguments cannot grant new paths. Save streams through bounded chunks without the inline 16 MiB limit and does not show a picker; the current file binding is shared with native Save. Failed replacement import clears the old binding rather than risking a later save to the wrong file. New clears it too. Import reads still need enough memory for the native browser File.

The host uses same-directory temporary files and atomic rename, rejects symlink targets, overlapping writes and detected external changes during a save, and cleans up aborted transfers. This is not a sandbox against concurrent privileged filesystem changes. Grants expire when the host closes. Reloading or navigating the connected document requires explicitly reconnecting that document; saved recents never grant access themselves. An uncertain transport result after rename requires inspecting the target before retrying. Native browser file handles retain their own browser permission rules.

CPU checks: `node tests/file-bridge.mjs` and `node tests/file-bridge-boundary.mjs`. Native isolated checks: `node tests/file-bridge-browser.mjs --headless`. A Windows symlink test reports unavailable if the OS account lacks that privilege; it is not counted as passed.

## Normal PWA filesystem host (no browser restart)

Publishing the web API does not install or start a filesystem host. A normal installed PWA uses this explicit local transport for absolute-path operations:

    node tools/file-host.mjs --allow-file "C:\projects\printer.hash" --allow-file "C:\projects\printer-copy.hash"

Run it on the same computer as the files. Parent directories must already exist. Each filename is an exact grant; opening or saving another path cannot broaden that grant. The host binds only 127.0.0.1 on a random port and defaults to the trusted origin https://mozg4d.github.io. An explicit --origin accepts another exact HTTPS development origin, or a localhost HTTP test origin. No browser security flags, CDP, extension installation, scene replacement, or browser restart are required.

The local JSON output includes the host URL and an ephemeral authorization token. Keep that output private; do not put it in URLs, source control, screenshots, shared reports or chat. In the intended Frame document, call scene.host.connect with that URL and token. The browser may request local-network access; the user must allow it through the browser's normal permission flow. Frame does not bypass that permission. Never connect an unrelated or untrusted page.

For an already-open 16:45 runtime, the same local JSON includes legacyConnectScript. The authorized owner of that existing document can execute this exact adapter through its development/automation interface without reloading the page. It uses the existing __frameFileHost hook and does not touch scene geometry, history, camera or current target. It cannot operate a tab already claimed by another automation session. The working chat must attach it there; do not start a different scene and call that the user's connection.

After connection, scene.saveAs({path}) writes a native HASH project and binds the target. scene.save() reuses it without a picker or inline 16 MiB transfer; scene.open({path}) uses the same host. These operations do not grant paths. New scene.file diagnostics separate host (an attached adapter) from hostBound (a host-backed current file), and expose hostURL without a token. Attached does not guarantee that the process is still running. In 16:45, host reports the existing file binding instead and remains false until the first host-backed Open/Save As. The successful attachment result and typeof window.__frameFileHost are the connection checks for that older runtime.

scene.host.disconnect revokes this document's session and clears the adapter without changing the scene or target. Reconnect explicitly after a reload/navigation or host restart. The host reclaims idle document sessions after 20 minutes; before the next Open or Save the still-attached document automatically renews its session under the same private credential and exact path grants. No extra dialog or manual pairing is needed after an editing pause. In-progress HTTP operations do not expire. A confirmed pre-mutation403 may retry only a new transfer once; chunks and final rename are never retried implicitly. A host restart changes its credential and still requires explicit new pairing. Stop the local process to revoke all grants. Tokens are not persisted in the PWA. One serialized filesystem bridge and same-path write reservation are shared by the host; transfer IDs and temporary-file ownership remain isolated per connected document. A disconnected document cannot publish a transfer that was still being opened; different origins, a wrong HTTP Host, unauthenticated calls, the bootstrap token used for file operations, and non-granted paths are rejected. The server retains the existing atomic temporary-write/rename, conflict detection and receipt behavior. A lost response to final rename remains uncertain: inspect the target before retrying.

Verification: tests/file-host-concurrency.mjs checks cross-document same-path exclusion and transfer ownership through finish, abort, expiry, disconnect and pending-open races. tests/file-host-idle.mjs exercises real accelerated expiry, interrupted writes, host restart, disconnect races and uncertain final-rename responses. tests/file-host-long-idle.mjs separately checks the default20-minute timeout without accelerating it. tests/file-host.mjs checks actual HTTP boundaries and >16 MiB transfers. tests/file-host-browser.mjs serves exact candidate bytes at an isolated HTTPS-origin fixture and uses real browser-to-loopback requests with browser-enforced local-network permission. Headless Chrome can run the granted case with `--grant-local-network` in the isolated profile. It exercises connection, native Open/Save As/Save, denied paths, disconnect/reconnect and no file picker. This test does not attach to or certify the user's current working PWA.
