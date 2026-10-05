# r193 Morph crowd native Save

## Reproduction and classification

On unchanged r192 (dae954cc515ebdc6a3b68f8ab2ac824f1306b76c), actual createMorphCrowd output rejects Save, fullBlob and Share with `Unsupported binary value`. The rejection occurs before opening a writable file. Native authored snapshots and actual rendered geometry remain unchanged. This is a serialization failure; the reproduction does not show content loss or a new pose-evaluation failure.

The creator copied the prototype Morph tag and assigned `fixture: undefined` to its instance tags. Native binary object serialization rejects undefined values. The field describes built-in prototype fixtures and was already intentionally excluded from crowd instances.

## Correction

The creator now deletes the copied fixture property instead of assigning undefined. The prototype descriptor remains exact; reference geometry, keys, values, metadata and instance relationships remain unchanged. A valid fixture descriptor authored on an instance after creation still roundtrips. Unrelated unsupported authored undefined fields continue to reject, with the field retained in memory.

Only frameMorphCrowd changes. The rest of the editor module is byte-identical to r192, including its combined Morph/PLA evaluation and undo correction and the r188 native Save capture/worker pipeline. Native record types, XOR keys, compression, F32 mesh and necessary F64 authoring precision are unchanged. Slicer, printer and service worker code are unchanged. There are no Library uploads.

## Verification

- Eight actual crowd combinations cover static/animated prototype Morph, both material/Morph tag orders and both Morph/PLA channel insertion orders. Four use linear interpolation and four use actual soft modes with explicit handles. Each has three instances, one independently posed instance, exact typed F64 metadata and signed zero. Real filesystem Save/open, fresh Share and file pages, three repeated load/save cycles, frames 0, 1, 5, 11, 12 and 20, and independent instance edit/undo/redo pass.
- Built-in lever and human prototypes each produce two independently posed instances. Prototype descriptors and a valid authored instance descriptor survive three reloads and fresh Share exactly. An unsupported polygon prototype rejects without changing the scene.
- The creator's default 1,000-instance crowd saves and reloads twice with exact native records and all 1,001 rendered source/instance objects. Save workers terminate and the compute budget returns to zero.
- The aggregate gate retains the r192 combined spline/polygon, isolated Morph/PLA, current manual pose, pose/key/value undo, worker load, Save lifecycle/cancel/failure, UI, navigation and certified spiral cases. All 363 count-7 saved-scene public Slice packets remain exact after Save/reimport.
- A normal 60-second PWA update preserves an unsaved r192 page and late assets. A fresh r193 page loads and saves with native workers, reloads native scenes, loads a cached catalogue asset and slices offline. Actual crowd Share, filesystem Save/reload, frame scrubbing and edit/undo/redo also pass offline.

Native checks compare every record address/type and primitive numeric bytes, with exact structured values and typed-array bytes. Render checks independently compare actual attributes, indices, groups and bounds. The retained bevel cases allow only their documented inherited approximation-default expansion; no geometry/key difference is waived.

## Inventory and scope

The earlier 69-file r192 live check was a verification subset, covering all 57 declared active assets. The r191 113-file inventory was broader. The subset omitted 46 prior files (30 legacy models, 10 retained modules and six documents), and both inventories omitted three additional tracked runtime modules. Nothing was deleted in r192. The reconciled r192 check fetches all 118 enumerated files, including all 101 tracked modules/models/textures. The r193 inventory adds its editor and this document: 120 enumerated files, including all 102 tracked runtime files and every declared asset/import-map resource. This is not a claim that all repository documents and license files were in the selected live inventory.

These checks qualify the listed combinations, the default crowd size and the two built-in prototypes. They do not exhaust every topology, curve mode, constraint, masked-axis arrangement or the 10,000-instance cap. The 10-million-triangle Save benchmark is not repeated; its implementation is unchanged and its lifecycle/worker controls pass. Pending Position 22 placement remains outside this fix.

Local QA and archived harness failures remain in C:/Users/mozg4/Documents/Codex/2026-10-05/task-5/qa-crowd-r193. Principal receipts: reproduction.json, crowd-combinations.json, real-prototypes.json, default-crowd.json, aggregate.json, source-invariants.json, pwa-release.json, offline-combined.json, offline-crowd.json and inventory-reconciliation.json. Exact-head CI and committed-byte live checks seal publication separately.
