# Portable slicer regression suite

Run `node slicer-source/tests/run-all.cjs` from the repository root. Node 20+ is required by the source reconstruction adapter; native EventTarget support is used by the independent lifecycle test.

The suite retains all 86 checked cases from the final progress/transport review, plus four independent native-EventTarget/shared-budget lifecycle routes. Tests only read sources and print JSON. They do not create receipts, launch browsers, open a customer model, publish, or perform a heavy geometry campaign.

`../rebuild.cjs.loadSources()` supplies the verified r239 integration baseline and current production sources. Four small parent-directory builders generate intermediate candidates in memory. No complete runtime candidate/oracle is copied into tests. The first-stage negative uses one small prior-reporter fixture and verifies the resulting worker against its historical SHA-256.

`test-eventtarget-budget.cjs` loads the actual repository editor using `editor-source/build-manifest.json`, checks its byte count and SHA-256, and extracts the unchanged shared-budget implementation. This verifies task-local queue cancellation, preservation of unrelated work, caller-signal ownership, cancellation before worker creation, and safe late dispatch through native EventTarget.

The final parent Worker listeners are anonymous and are not explicitly removed. Their terminated Worker targets lose the production owner reference; repeated late events are safely ignored by the terminal guard. These tests do not certify garbage-collection timing, heap/RSS limits, naturally occurring decode failures, or real-model geometric coverage.

The `r235` suite name is historical: the guarded baseline worker/printer bytes are identical in published r239. The comparison harness uses exact numeric/provenance witnesses and bounded synthetic fixtures. It cannot start real-model comparisons without a caller explicitly providing an execution adapter and the required acceptance window.
