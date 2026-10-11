# Current slicer source

The shipped printer and slicer-worker modules contain the complete source. Small hash-checked extraction deltas recover their unchanged r239 integration base. Four pure build steps apply status reporting and transport-error handling, then verify the exact r240 module bytes. Intermediate comparison variants are generated in memory; full historical workers are not duplicated.

Node.js 20+; no installation or network access:

    node slicer-source/rebuild.cjs /absolute/path/outside/frame/new-output
    node slicer-source/tests/run-all.cjs

The output directory must be new and outside the checkout. The rebuild neither edits the asset manifest nor deploys. Existing project and third-party [licenses](../licenses/) retain their terms. `source-manifest.json` covers this directory.

## Behavior

Status packets identify preparation, section intersection, path construction, worker waiting and preview preparation. The first distinct stage is reported before synchronous work begins. Counts describe committed/source-active model layers before bed clipping; they are not printable-layer counts, percentages or ETA. Status-message age and last-completed-layer age are separate. Synchronous geometry may still delay worker heartbeats.

Worker, MessagePort and worker-global error/decode events settle the current task through its existing shared worker budget. Parent Worker receivers use additive `messageerror` listeners. Completion, error and cancellation terminate task workers, close ports, revoke URLs, clear timers and cancel queued task leases. Cleanup attempts continue after an earlier cleanup exception. Late callbacks are finish-guarded. Anonymous parent listeners are not explicitly removed before termination; the task releases its Worker references.

No production timeout or independent worker pool is added. Geometry algorithms, precision, path order, provenance, typed source angles, packet size caps and clone limits are unchanged. This release does not establish slicing speed, complete model coverage, geometric quality or physical-print acceptance.

## Checks and reuse

Portable tests resolve the actual current modules and their exact baseline through `rebuild.cjs`. They use small synthetic geometry, actual task/worker source over controlled transports, exact output comparison, and lifecycle controls. Their test watchdogs are not production deadlines. Browser and private-model acceptance remain separate; no private model, browser harness, receipt or duplicated runtime bundle is included.

The same extraction deltas restore the pinned worker used by the independent slicer lab and both module inputs used by GPU v10 reconstruction. Keep this directory with the checkout for those builds.
