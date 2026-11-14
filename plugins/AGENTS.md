# Shared plugin contract

## Discovery and authoring

- Catalogue: plugins/index.json; manifest: <id>/plugin.json; export activate(context). IDs match directories, object types are unique; assets stay same-origin inside plugins. Activation runs once before use and creates no owner itself.
- Cold startup/native operations make no plugin requests. Plugins tab discovers metadata/icons without executing unused modules; HASH loads required modules only. Unknown tag ownership may require catalogue metadata. Explicit plugin discovery opens Plugins initially. Offline availability requires prior use in the current shell cache.
- Manifest fields: finite number, boolean, choices (first default), string reference. Literal strings use textFields. fieldOptions declares units/bounds/integer/access once for Attributes/API/fields; context.parameters.schema(type) supplies operation schemas. Shared field writes require explicit read-write access; animated/reference fields remain unavailable there.
- Tags accept finite numeric/boolean defaults and homogeneous enum choices (64 fields, 64 choices, keys <=128 chars). Strings/references, tag fieldOptions/ranges and vector/multiple-force semantics are unsupported. tag.set/read/list, native UIDs/animation/Undo/HASH own authoring; scalar storage alone is not physics.
- Native document/hierarchy/frames/selection/materials/transactions/history remain authoritative. Borrow context.device; release only owned resources. The root architecture rules apply: no second scene/editor/device or permanent CPU mirror.
- Never await serialized context.api.call inside activation/operation handlers. Create in one native transaction then await context.editor.selectOwner when needed. Post-commit selection errors are not rollback or permission to repeat creation.

## Geometry and async work

- context.gpu(hash) borrows canonical buffer/paged-texture resources. Never map/write/destroy them; reacquire after revisions.
- context.scene.capture(hash,parameterKeys) supplies evaluated GPU occurrences and owner-local matrices/signature. Hidden/history/consumed geometry is excluded, independently of frustum. Physical-time sampling/vertex velocities are not supplied.
- Recheck context.scene.signature before subsequent submissions/publication. Scene/device/resource/relative-frame/visibility/captured-param changes invalidate. Jobs own cancellation, atomic output and retirement; HASH stores authoring only.
- context.fields.authoringStamp() synchronously returns frozen {epoch,revision} or NOT_READY/BUSY without joining FIFO. Capture scalar inputs/stamp in one JS turn; fresh-check after every await and before use. Navigation can temporarily be BUSY without changing physical inputs. Stamp is not a geometry/eligibility certificate; retain source checks.
- context.document.setRecord(hash,key,type,values) stores immutable typed authoring at 32-hex identities. Replace values, do not mutate arrays. Native copy/HASH remaps declared refs; undeclared extensions may be omitted with diagnostics, not promised lossless.

## Native extension points

- Owning core code is `FramePlugins`, `FramePluginRecords` and `FramePluginTags` in index.html. Read shared dispatch and matching native serialization/validation before adding hooks; manifest declarations do not automatically imply supported editor/capture semantics.
- `context.document` operates on actual native nodes/records/frames/materials plus transactions/checkpoints; `context.math` is native affine math. Hooks in context.editor supply parameter validation, created defaults, documentChanged invalidation, copy/reparent/restore, component GPU pick/snap/bounds/transforms and animation/flush. Validate parameters before mutation; derived controls may forbidAnimation. Do not silently patch owner selection after unrelated newer selection wins.
- `disable:false` omits green control for noncomputational rows; `enabledAffectsVisibility:false` separates calculation from red visibility. Status/display must honor those declared policies, not equate hidden with disabled.
- `scene.capture` bounds are conservative local broad phase, not geometry. sourceAccuracy comes from shared evaluator: exact document polygons versus proved/coarse/unknown generated/deformed envelopes. It participates in signatures. `scene.prepareAccuracy()` rebuilds missing current generated attestations before capture, without changing authoring. Never treat unknown as zero error or retain borrowed snapshot as public status.
- Native tag identity is owner+UID; duplicate may keep same UID on another owner. Validate all target tags/merged params before one Undo. Fieldless tags, declared scalar tags and unavailable opaque payloads have different semantics; reading a tag must not activate unused runtime. Generated canonical UIDs must be valid native 32-hex IDs, including animation binding fallback.
- `editor.surfaceStyle(hash)` is a fallback only when no effective native user material exists; never creates saved material. `surfaceFilter(hash)` returns stable derived fragment predicate/buffers, optionally tied to an owner whose visibility/ancestors/Solo suppress it. Native shading keeps actual inherited materials/face masks/UV. Returned buffers stay plugin-owned/alive; bridge owns derived pipeline/bind caches. Wire/cage/editing still addresses source geometry.
- Dynamic Attributes may declare hiddenFields, labels, ranges, groups/actions and numeric step hints. Labels rename presentation, never stable field keys. Manifest units/ranges take precedence; refresh must preserve active edits. Arbitrary technical logs and fake measurements do not belong in Attributes.
- Empty helper lines permit render-only descriptors. Lazy activation completion after scene Open requests redraw even without native triangles. Compilation failure is activation error with retry, not a reason to publish partially created derived data.

## Rendering and operations

- context.viewport.register owns local helper lines/bounds/pivot, settings/surface-warning shader and render/retire hooks on the shared bridge. Render borrows open pass/camera/frame/device; never end/destroy them. requestDraw schedules rendering; requestAttributes refreshes actions/plugin overlay.
- renderKind: solid (default, Solid on), overlay (Solid or Lines), helper (also both off). Stage independently orders callbacks. Visibility/enabled policy/ancestors/Solo still apply. Line-only warnings use evaluated depth; both off suppresses warnings.
- Per-type helpers use viewport.helpers. Custom geometry needs matching shared bounds/picking support before claiming viewport selection.
- Optional context.viewport.cameraWGSL defines frameCameraRelative(rotation): subtract 3.2 from translation Z, eye-Z becomes zero. Insert after WGSL directives; projection/inverse reconstruction both use returned translation. Borrowed camera remains 144 bytes/36 floats; Float32 camera-origin error remains.
- context.operations.register owns schemas/readOnly/run; plugins.command validates before dispatch. Long jobs return handles promptly. context.update uses native Undo. Attributes actions use native controls; only Printer Slice may show short progress. Diagnostics belong in API.
- context.editor integrates component selection/transforms/copy/animation/flush. flush({output:true,frame}) must finish exact physical interval/GPU work before offline output. Shared 60 fps timeline owns playback.

Each plugin owns one AGENTS.md and tests/index.mjs exporting async pluginChecks(page) -> {pass,checks,timings,error?}; keep fixtures/helpers local. Catalogue standard/stress discovers checks. Root owns global verification/publication rules; plugin documents own only specific limits/commands.

## Change checks

Native integration requires create/select/transform/Undo/copy/clipboard/merge/HASH tests as applicable, plus shader/native pixels when draw paths change. In particular, check host field declaration vs native preservation, source revision changes after every await, source-only and paged/instanced geometry, hidden ancestors/Solo, device teardown and cancellation. `tests/plugin-infrastructure.mjs`, `tests/plugin-tag-fields.mjs`, `tests/plugin-warning-modes.mjs`, `tests/authoring-stamp.mjs`, `tests/plugin-overlay-refresh.mjs` and `tests/plugin-loading.mjs` are shared entry points; do not duplicate plugin-specific contracts here.
