# GPU authoring v10 source

Unreleased development source, separate from the active application.

This directory contains only the latest implementation: 14 native-source overrides, exact editor/shell deltas, a hash-pinned rebuild script and a portable CPU test. Existing repository assets and 23 native-source files are reused without duplication; exact reverse adapters account for the current production changes.

## Rebuild

Requirements: Python 3.10+, Node and an existing TypeScript installation. If needed, set `FRAME_TYPESCRIPT` to its `lib/typescript.js` entry.

    python development/gpu-v10/rebuild.py --repository /path/to/frame --destination /path/to/new-output
    node development/gpu-v10/tests/authoring-contracts.mjs

The script accepts the r226 application bytes from commit `5bc5e06da0a5adc896f2c24754588fd665df5edb` or the exact `r229-calibration-session` production files (including the unchanged r227 diagnostic editor). Small hash-guarded reverse adapters restore the expected editor, shell and four native sources before rebuilding v10. The production-only `gpu-mipmap.mjs` is not copied into the older v10 source closure. Unknown versions are rejected. The output directory must be new and outside the checkout. The script reconstructs 70 hash-pinned application files and 37 native-source files. It copies the current `queue.html` separately, so documentation cleanup is preserved. Root and native-source README files are not build inputs. The script neither serves nor deploys anything.

Expected editor SHA256: `93cd5fd0901cb855b6471fd4978209f42061ebc04d8ce7aca543e71d4ba4a459`.
Expected native SHA256: `24478e6cc0f0694479f6fe4b3b1d46e11b8f74c01967c1fb5ae5cac9b164213f`.

## Verification and release gates

On 2026-10-10, exact reconstruction passed for all 107 hash-pinned code/asset files. The current queue page is copied unchanged and is excluded from the historical-byte claim. Native rebundling was byte-identical; runtime syntax passed for 14 units; the portable CPU test passed 9 cases and 3,274 assertions. These checks do not establish browser or GPU acceptance.

The broader source regression has 4 passing and 5 failing suites. Measurements, UI-equivalence and marquee encounter missing isolated-harness bindings. STL-pick rejects a changed source contract; STL-equivalence has an unresolved installed-position byte-length mismatch on a synthetic binary fixture (734,472 versus 4,320,000).

A bounded synthetic audit also found save/clone using the immutable base after a pose, local CM reusing world extents, and a pending GPU gesture falling through to CPU. These remain release blockers. Before activation, resolve those failures and verify pending-preparation gestures after Undo; Object/local coordinates and coordinate-manager updates; `.hash`, clone/save/export and topology/picking consistency; native Connected/marquee behavior; complete binary/ASCII import; and history/input latency. The current fast path covers World face Move/Rotate only. No 60 FPS or complete-workflow claim is made.

No private model, screenshots, browser scripts, historical snapshots, test receipts, dependency trees or duplicate generated bundles are included.
