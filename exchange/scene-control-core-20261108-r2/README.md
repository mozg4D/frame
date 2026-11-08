# Scene Control core qualification packet

This source-only packet is not a release and does not change main or the live site. It contains inert author-data persistence, typed native references, name/visible authoring CAS, bounded read-only scalar/enum parameter discovery and batch reading, plus owner-identity reservation fixes. It does not execute stored code or provide a Control panel.

- Baseline: mozg4D/frame main commit d98aca74b4be7e4703a26bf51caa874821dcc73b.
- Runtime SHA-256: 619e12e70d11555ba69614b1650460b135a3257af70a8f221ab93f1b3ab51d0f.
- Baseline files: 525, overlay files: 28, assembled source files: 550.
- Cloud qualification: 398 CPU checks and syntax passed, including an independent final rerun. The first native candidate failed on startup before browser assertions; this corrected candidate has not yet passed a native run. Full npm test/stress remain pending.
- The application/service-worker release stamp remains the baseline stamp. Before any release, reconcile fresh main and set the final release stamp, then qualify those final bytes.

## Assemble

Download these files by pinned exchange commit, not a moving branch URL. Verify every transfer hash against PACKET.json. Use a pristine byte-exact baseline checkout/archive at the commit above. Never modify another test candidate, the user's worktree or their active browser tab.

Run with Node 22 or newer:

    node assemble-scene-control.mjs BASELINE_DIRECTORY FRESH_OUTPUT_DIRECTORY scene-control-overlay.json.gz

The assembler checks all 525 baseline Git blob identities, all overlay SHA-256 values and all written output bytes. It refuses an existing output directory or a path inside the baseline. ASSEMBLED-SCENE-CONTROL.json records the full final file identity. Use the existing authorized Playwright installation in the test workspace; do not download another browser or enable a software GPU fallback.

## Qualification sequence

Respect the shared GPU-lab queue; no overlapping workloads. First verify SHA-256 and run these CPU commands in the fresh assembled directory:

    npm run test:scene-data:cpu
    npm run test:scene-data:audit
    npm run test:syntax

After the lab window is available, the modest native gates are:

    node tests/scene-control-data-browser.mjs
    node tests/documentation-button.mjs --headless

The data harness includes native HASH Save/Open, Copy/Paste/Merge, source inertness, stale epoch guards, unavailable fields, owner disappearance/history reservations, actual dirty Doc popup transport, direct/RPC post-settlement receipts, native cross-tab clipboard, failed-install readiness fencing and recovery. Each operation has a completed-operation budget. It uses owned browser contexts and modest native scenes, not a user browser tab or software rendering.

Standard and stress are separate required release gates. Run them only in their coordinated GPU window, on the final source bytes:

    npm test -- --headless
    npm run test:stress -- --headless

Keep failed-first evidence and report exact runtime/test hashes, command outcomes, GPU adapter/errors, completed-operation timings and cleanup. Never turn a blocked/skipped/unrun native gate into a pass. Do not publish main/live from this packet alone.

## Revision 2

The first native candidate (0c083557) failed before browser assertions because the new allocation ledger read the native root before initial scene.records existed. The correction returns an empty root only before native records installation and rejects premature writes with NOT_READY. Five actual constructor/attach/install CPU fixtures and six diagnostic classification checks cover the seam. Readiness fencing is retained. Failed-first evidence is preserved locally. This revision also retains exact native startup stack/dataset/page errors in the browser report.
