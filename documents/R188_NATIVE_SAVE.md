# r188 native Save responsiveness

Native Save now removes the callback-per-index snapshot rebuild for packed Uint32 geometry, captures independent buffers in 1 MiB copy steps with an 8 ms yield budget, and moves ordinary native serialization and record encoding into bounded workers. The output retains r187's exact bytes and values, ordinary native scene/fragment structure, minimal 26-byte TYPE/XOR-key/stored-length header, and independent lossless preparation/gzip choices. Save, library and Share use the same format. There is no JSON scene container, quantization, Draco or symmetry compression. Authored F64 and existing F32 IEEE words remain unchanged.

## Matched actual browser Save

The same synthetic 10,000,000 distinct indexed triangles / 5,045,100 vertices / 100 unique relief objects were opened and rendered in fresh Chrome 154.0.8037.58 sessions. Each timed operation invokes the real writeHandle path and writes/closes a real Chrome origin-private filesystem file. Dialog selection and initial directory/handle provisioning are excluded; snapshot, serialization, compression, createWritable, write and close are included. Idle camera and the same viewport are used. Fetch/opening and later correctness verification are outside the Save interval. There are two fresh r187 and two final r188 runs, rather than a small-scene extrapolation. This is a synthetic fixture, not a production user model or closed printable solid, and establishes no 10M Slice claim.

| Measurement | r187 | r188 |
|---|---:|---:|
| Mean complete Save | 26.410 s | 9.451 s |
| Longest observed RAF gap | 1416.7 ms | 17.0 ms |
| RAF p95 during Save | 50.0 ms | 16.8 ms |
| Mean observed Save-only peak private commit | 2.474 GB | 2.438 GB |
| Stored file | 61,270,297 B | 61,270,297 B |

Complete Save latency falls 64.22%. The final candidate's capture/copy takes 119.0 ms, and worker raw serialization/return takes 92.1 ms. Capture remains on the page and yields between bounded copies; this result does not assume a worker eliminates snapshot cost. Both final Save runs have no observed page long tasks. RAF/timer gaps include boundary-crossing work; long-task phase filtering alone is not used to assess stalls.

Private commit is sampled from the owned Chrome browser/renderer/GPU/utility processes. The table filters samples to the Save interval and uses each run's observed peak; it is not an allocation-exact memory bound. Later decode/render verification and full-process overhead are kept separately in the receipts. Baseline runs take 26.391 / 26.428 s; final candidate runs take 9.428 / 9.473 s.

Stored SHA-256 is identical in all four runs: b53dff73a91412a9fe4ce2e3e3decc0c49a7bba82571745878794c7f69fd16d4. Decoded/re-encoded native source SHA-256 is 5118803a21f696c7fc510eefaaa3fa05f3eedd10fbbcddce3f539447ede1a3f4 (241,097,124 B). The saved output is actually reopened and rendered: all 100 meshes / 10M triangles reproduce every attribute, index, group and bound exactly. Ordinary mesh buffers remain attached to the renderer throughout Save. The input fixture remains 61,133,524 B.

## Scheduling, ownership and failure controls

Save acquires the existing shared compute budget alongside surface, slicer, Boolean, native load, CAD import, recognition and render-scene CPU work. Serialization uses one slot, releases it, then record encoding uses at most four slots and never exceeds the shared available budget (15 on the measured 16-logical-thread machine). Idle retained workers do not consume active compute slots. A two-logical-thread browser control permits exactly one active worker and verifies queued Boolean cancellation before worker startup.

Record batches are at most 8 MiB, with at most four ordinary batch copies in flight (32 MiB). A record larger than 8 MiB uses one lane. Existing format quotas remain: 2 GiB snapshot/file, 512 MiB decoded record, 4 MiB source / 8 MiB prepared stream and bounded dictionaries. The encoder retains one raw file plus bounded batch work and the stored result; memory still scales with the scene. Raw serialization joins header/payload views once rather than keeping an additional copied raw-record set. These bounds limit additional work; they do not promise that near-quota scenes fit every device.

Repeated fullBlob requests share one job. Repeated file writes and Save UI commands are guarded. Interaction or API mutation during capture cancels before opening the writable; a new Save can capture the changed scene. Once capture is complete, editing can continue because workers receive only independent copies. Changes during encoding/IO leave the current scene dirty; only the captured state can be marked saved. API edits with undo:false, undo/redo, scene replacement, caller-owned buffers, running/queued cancellation, worker startup failure, IO abort, retry, and worker/slot/URL/status cleanup are checked. Save's Cancel button cancels preparation and workers before file commit. Existing write/close failures abort the writable. Tiny snapshots use the inline codec path; warm four-millimetre cube saves remain approximately 1–2 ms (404 B), with a small status/capture overhead rather than worker startup.

Authored controls cover exact signed zero, F64 transform/pivot/cage/handle/Morph values, animation and textures. Save/fullBlob/Share bytes agree; all 15 ordinary native catalogue fragments retain exact decoded values. An authored binary metadata record's re-encoding differs in r187 as well as r188; the unchanged decoder/preparation and baseline control are recorded rather than presenting that preexisting canonicalization as a new format change.

## Release verification and scope

The aggregate gate covers native codec/ownership/invalid options, Save lifecycle and consistency, shared worker scheduling, actual Slice UI progress/cancel/error, vertical/inclined certified spirals, 22 navigation rays, and actual count-7 full-scene Slice/save/reimport with r187's exact layer hash and travel. The normal 60-second PWA update preserves an unsaved r187 window and its late library load; a fresh r188 window verifies critical caches, offline Slice/native reload/library and a large offline Save that creates and terminates the native Save workers. Old runtime assets stay available.

Position 22 remains the original incoming-bank restart awaiting the user's semantic clarification. Slicer and printer module bytes are unchanged. No arithmetic downcast or broader loading/Slice work is included. Snapshot packing of other authoring structures and unusually large non-packed attributes can still have costs; this bounded improvement is supported by the measured native fixture rather than a general stall-free claim.

Local evidence is in qa/save-r188: measurements.json, four browser-save receipts, controls.json, baseline-record-proof.json, codec-controls.json, budget-controls.json, aggregate.json, release-browser.json, pwa-release.json and visual-check.json. Release validation seals the publication and evidence; exact-head Pages CI and committed-byte live inventory are checked after pushing main.
