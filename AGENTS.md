# Frame

## Development

- Core runtime is `index.html`; `core/` holds shared document modules. Plugins own runtime under `plugins/<id>/`. Use native WebGPU/WGSL; no Three.js, WebGL, CDN runtime or parallel scene/editor.
- Reuse existing kernels, transactions and GPU resources. Prioritize large-scene latency and bounded memory. No compatibility layers/migrations without a user requirement.
- Change UI only when requested. Code/UI/docs/fixtures are English. Draw icons at native dimensions without CSS/viewBox scaling.
- Core documentation belongs here, shared plugin contracts in `plugins/AGENTS.md`, plugin specifics in each plugin's sole `AGENTS.md`. Keep these current; no release diaries, historical results or duplicated contracts.
- Maintain `window.frameAI`/MCP with features. Missing automation/diagnostics found during a task belong in that implementation. New commands require schemas, validation before mutation and focused regression coverage outside runtime.
- Preserve unrelated work and user fixtures. After validation, commit task changes and push `origin/main` unless asked to keep local. Never force-push; verify remote commit. Application releases also require Pages/deployed-byte verification.

## Geometry and history

- Canonical polygon positions/indices/topology/normals/selection live on GPU. RAM holds authoring, spline controls/samples and bounded history. Temporary import/export/algorithm/diagnostic readbacks must not become a permanent polygon mirror.
- Buffer and paged-texture meshes share logical topology. One logical vertex owns one position; creases split shading aliases, not geometry. Preserve logical IDs, per-corner UVs and material-face lineage through edits, copies, reflected transforms and Undo.
- Frames are Float64 column-major affine matrices: `world = parentWorld * local`. Preserve shear, avoid lossy TRS. Apply deltas only to selected roots; reparenting preserves world frames. Object motion updates frames, not rest vertices. Component delta is `inverse(world) * delta * world`.
- Pivot is separate from geometry/world frame; freeze a derived pivot before transforming. Instance/Cloner evaluate relative to source pivot; Symmetry reflects source frames about its own origin. Share source GPU geometry with per-occurrence transforms.
- Native spline cages/evaluators own generated surfaces and stable cell/control lineage. Direct planar Extrude is for qualified non-fillet planar profiles; remaining cases use Spline Patch. Do not substitute a second surface builder or lose endpoint ownership when splitting segments.
- Publish complete async results only after owner/revision/device checks; release stale owned resources. Coalesce pointer work, apply the final event on release and defer expensive maintenance during input. Never destroy borrowed resources.
- One chronological Undo covers authoring, frames, appearance and GPU edits. RAM budget is 256 MiB including pending offload/reservations/Redo; UI snapshots <=64 MiB; metadata transforms <=100 actions. No disk history. No-op/cancelled unchanged gestures create no history.

## Views and animation

- Top looks -Y (+X right, +Z up); Right looks -Z (+X right, +Y up); Front looks +X (+Z right, +Y up). Projection, inverse rays, picking and overlays must agree.
- Views share device/geometry but retain independent cameras/shading/cached color/depth. Render on demand. Solid and Lines (Wire/Isoparms/Off) are independent; shading API accepts solid/wireframe/solid-wire/isoparms/solid-isoparms/off.
- Clipping uses visible evaluated meshes, spline copies and plugin bounds. Perspective guides cover XZ [-1000,1000] and positive 1000 mm axes; including guides must not advance near through scene geometry. Raster/line projection and picking share planes; path-traced rays remain independent.
- Retain the native combined Move/Rotate/Scale gizmo and shared flat artwork. Navigation passes through overlays; focused controls own keyboard input. Use physical KeyboardEvent.code. Quantization/snapping are mutually exclusive; grid phase uses Float64 and bounded viewport-local uploads. Do not hide geometric detail via edge LOD.
- Timeline/video use fixed 60 fps. Completed frames wait for animation/Morph/spline evaluation, enabled simulations and GPU output; no physical-time skipping. Morph uses native XYZ trajectories/regions, stable control IDs and GPU rest geometry; discard temporary fitting graphs and retain component selection on unchanged topology.

## Persistence and files

- HASH is canonical addressed authoring: scene.records, owner/property XOR identities, typed binary data. Header: uint16 type + 16-byte ID + uint64 length, little-endian. Preserve Float32 geometry bits/indices and Float64 affine frames. Save source cages/parameters, not generated surfaces, normals/bounds/selection/history/jobs.
- Native parameters JSON stores animation/Morph/library/authorData; cages/materials/geometry remain binary. Add records only for authored features with defined identity/precision/limits/round-trip tests.
- Open preflights before replacement, then uploads one mesh at a time. Save streams readbacks <=4 MiB. Limits: 512 MiB decoded/record, 100000 owners, 1000000 records. Validate finite data/references/cycles; parent membership cannot depend on object order.
- Merge/copy/clipboard reuse native decoders/remapping and one transaction. Preserve source-time geometry/appearance and typed references. Cross-tab clipboard needs the source tab and same origin/app path.
- Scene formats: HASH/STL/OBJ/glTF/GLB/PLY/VTK/3MF/SVG/STEP/DXF. Geometry exports use visible evaluated occurrences; HASH retains authoring. STL maps Z-up to Y-up on import and reverses on export; OBJ is mm, glTF metres without axis swap. Unsupported required extensions reject before replacement. DXF text/ACIS/proxy data is diagnosed, not fabricated. Preserve asset license/attribution files.
- Plain Save writes HASH/reuses only a HASH binding; explicit format invokes Save As. scene.file reports binding/receipts. scene.file.request(open/save/saveAs) uses browser permission; without activation it queues the matching existing toolbar action. Synthetic click does not grant activation. Cancellation before import preserves binding; replacement clears it.
- Absolute-path scene.open/save/saveAs require an attached exact-grant local host. Grants come from tools/mcp.mjs --allow-file, never scene arguments. Chunked transfers save via flushed same-directory temporary file/atomic rename. Reconnect after navigation; inspect before retrying uncertain post-rename outcomes. Host setup: `tools/README.md`.
- Service worker installs core shell; plugins cache on use. Recent descriptors do not grant filesystem permission. Share embeds HASH in URL (16 MiB packed/512 MiB unpacked); use files for large scenes.
- Scene Doc is native content with editor/history/lifecycle; F1 Help is application help. Preserve shared file admission, popup synchronization and sealing barriers.

## AI, author data and programs

- frameAI provides ready/listTools/call/rpc. Discover schemas instead of keeping command lists/counts in docs. Native hashes are stable, UI IDs session-local; units are mm/degrees/CSS pixels.
- Native mutations serialize and settle accepted editor/evaluator work. Mutations/export/share reject BUSY during manual gestures. Read-only observation flushes accepted live input without ending gestures or creating history. Diagnostics are bounded; volume alone does not certify a solid.
- tools/mcp.mjs is stdio JSON-RPC; stdout is protocol only. Default browser is isolated; exact CDP URL explicitly selects an existing tab. Prefer direct frameAI in the intended tab. No eval endpoint/background HTTP RPC server.
- authorData lives in root/owner parameters: {version:1,revision,records,retired?}. Identity is (owner,id), never name. Source/schema/binding/opaque payloads are inert unless explicitly opted into execution. Remap only declared object/field/record refs, never source text/hash-like strings. Preserve unresolved refs and retired IDs across history.
- Envelope caps: 512 records, 256 refs/record, 4 MiB JSON, depth 24, 4096 retired IDs. Validate plain JSON, safe finite numbers, Unicode and capacity before mutation. Copy captures transitive root-record dependencies; Paste/Merge allocates fresh root IDs.
- authorData.get/inspect/replace and fields.list/read/write use native epochs/revisions. CAS writes preflight all 1..128 distinct targets before one Undo transaction. No-op adds no history. Name/visible/explicitly declared unanimated parameters are writable; animated values are observations. Post-settlement completed:true means committed: reread before retry.
- Executable descriptors are opaque format frame.scene-control, version 1, data {source,context,start,imports?,bindings?,params?}; source/imports/bindings index typed refs. Context main or worker:<name>; start defaults manual, ready opts into autostart. Source records alone stay inert.
- programs.describe/status/start/stop/restart/invoke/job/terminateContext own lifecycle. Poll queued receipts. ESM activate(ctx) owns per-activation state/exports/cleanup; ctx.import loads referenced source unchanged. Managed calls execute outside Frame FIFO. Frame/MCP is JSON; native framePrograms.invokeDirect/postMessage supports structured clone/transfers.
- Dependency/binding edits restart desired programs; disabled suspends, visibility does not. Replacement retires instances/Workers. Stop blocks later managed admission and cleans registered resources without undoing admitted effects. Main JS/direct frameCore access is not sandboxed or forcibly interruptible. HASH saves sources/descriptors, not heaps/timers/jobs.
- Scene Control still lacks complete control-panel UI, subscriptions and timeline/export lifecycle; managed execution does not imply those capabilities.

## Verification

- Run npm test after changes and fix task regressions. Geometry/rendering/performance changes also require npm run test:stress. npm run test:all loads large user fixtures and needs ample VRAM; never rename/delete those inputs.
- New/fixed operations need focused regressions and completed-operation latency budgets. Rendering changes need CPU/GPU frame measurements and relevant 100M-triangle checks.
- Tests own isolated server/browser/scene. Visible Chromium is default; explicit --headless is available. Use Playwright input; native pointer-lock checks run headless. No software GPU fallback; skipped/missing hardware is not a pass.
- Catalogue checks use plugin tests/index.mjs. CPU passes do not qualify native UI/HASH/GPU or physics. tests/results/progress.json tracks stage; reports bind exact source hashes/errors/timings. Never apply old results to new bytes.
- tests/current-source-baseline.json binds file paths/hashes/scopes. Update changed documentation identities without relabelling historical runtime evidence.

## Documentation editor packaging

`documentation.html` contains its editor, synchronization and local Undo/Redo in one inline module. CPU regressions execute those shipped helpers through `tests/documentation-source.mjs`; browser regressions open the actual page. Keep the page in the offline shell. The main page still imports `core/documentation-window.mjs` and its shared `core/documentation-geometry.mjs` dependency; remove these only when their host code moves into `index.html`.
