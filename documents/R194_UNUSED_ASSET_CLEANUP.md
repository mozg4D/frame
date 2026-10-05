# r194 unused tracked asset cleanup

The cleanup removes 44 confirmed obsolete packaged files: 30 models (the 15 former JSON/gzip and 15 former HASH/gzip representations) and 14 historical modules. Their committed total is 18,353,238 bytes. Git history retains every deleted file; local untracked QA is untouched. No documentation, screenshots or required license notices are deleted.

## Evidence and retained resources

The current r193/r194 runtime and the retained r192 editor have no filename, path or content-hash references to these files. The active import map, asset declarations, catalogue, model loader, dynamically constructed model keys, worker loading, PWA shell and lazy cache paths are checked. The catalogue's 15 legal model keys exactly match the 15 declared ordinary native .hash assets. Model loading resolves `frameAssets.bytes('model:'+key)` through this manifest, with no fallback to the removed packaged encodings. Native Save/load compatibility code remains unchanged.

All 57 declared active assets retain their exact r193 path, SHA-256 and byte count. The nine current modules, 15 current model fragments, 33 textures and prior r192 editor remain: 58 tracked runtime files. The prior editor supports existing cached/active previous pages. The r193 editor is also the current r194 editor; no production JavaScript, slicer, printer, native codec, Save pipeline or service-worker bytes change.

The earlier r192 69-file live result was a subset covering every declared active asset; its larger reconciliation and the r193 120-file result included historical runtime assets. After cleanup, verification enumerates every remaining non-hidden tracked file, including documentation, licenses and screenshot, rather than silently shrinking that subset. The expected final set is 90 published files, with all 58 tracked runtime files and all 57 declared active assets. The repository also tracks .gitattributes as Git metadata outside this published-file gate.

## Verification and limits

The reduced staging server uses only its reduced tree; it cannot fall back to deleted repository files. Actual library constructors exercise the sedan, both details of bush/spruce/oak/poplar, and standing/sitting/walking male/female humans. Exact native Save/reload and public mesh topology are checked. Every model request resolves a retained .hash. A normal 60-second r193-to-r194 PWA update retains the unsaved old page and its late library loading, then opens a fresh r194 page. All 39 critical assets and 15 catalogue assets are verified in cache. A fresh offline page constructs all 15 models and reloads the saved library scene repeatedly.

The separate r193 correction remains qualified by its crowd, combined animation, native Save/Share, worker, Slice and offline regressions. This cleanup does not expand that functional scope. Arbitrarily old pre-native-migration browser sessions that have not cached their obsolete resources are outside the current/previous-release gate. Removing historical assets does not erase user scenes or the native importer. There are no Library uploads.

Local receipts and exact deletion hashes remain in C:/Users/mozg4/Documents/Codex/2026-10-05/task-5/qa-cleanup-r194. audit.json records the complete deletion list and dynamic-loader proof; catalogue-pwa.json records the reduced-tree library/update/offline gate. Committed-byte inventory, exact-head Pages CI, actual live library/crowd loading and removal checks seal publication separately.
