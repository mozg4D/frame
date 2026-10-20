# Frame automated tests

Run after completing application tasks, from `C:\frame`:

```powershell
npm ci
npx playwright install chromium
npm test
```

Setup is needed once after checkout/dependency changes. Node 22+ is required. `npm test` starts a temporary localhost server and an isolated Chromium context with real WebGPU. It never opens/saves over the working scene. Default is headed Chromium because headless WebGPU is unavailable on some Windows drivers. `--headless` is optional and fails explicitly if there is no GPU adapter; `FRAME_BROWSER` can select another Chromium executable, `FRAME_DPR=2` runs at DPR 2.

```powershell
npm run test:syntax         # Parse both executable scripts in index.html
npm test                   # Standard checks + 2304 unique spline cells
npm run test:stress         # Same checks, longer GPU timing sample
npm run test:all            # Also load large user fixtures from tests/scenes/
```

`test:all` can require over 9 GiB of VRAM and much more RAM; close other heavy scenes first. It includes the 100,548,288-triangle HASH and the single-object original-scale STL import. Each large fixture gets a separate browser context, then is focused in a single perspective Solid view for fresh render timings. This prevents keeping both 100M-triangle scenes resident simultaneously. Those files are user fixtures, not prerequisites for standard tests. Missing optional files are reported as skipped.

Open [the browser runner](http://127.0.0.1:56116/tests/index.html) to run the shared API suite inside an embedded tab. Click **Run tests**. The application is in a separate iframe. This runs API/geometry checks; CLI additionally runs real Playwright mouse/keyboard and MCP process checks.

Results: `tests/results/latest.json` plus timestamped history. The report includes the actual `index.html` SHA-256, each assertion, browser/GPU errors, scene load time and CPU/GPU frame timings. Exit code 0 means all mandatory checks passed; any assertion, JavaScript/WebGPU error or missing adapter makes the command fail. A timing sample is evidence for that machine/view, not a portable FPS threshold.

The standard suite covers schema/errors/no-mutation validation; serialized calls; all 15 implemented library types; hierarchy, object transforms without geometry rewrites, metadata/geometry Undo/Redo; two-stage To Editable; generator inputs; spline tangents/selection/weld; buffer and texture-backed mesh weld/digests/connected; lighting, views, shading, HASH and OBJ round trips; finite valid geometry on a cage with 2304 different curved cells. Real UI checks cover library buttons, context menus/focus/Escape, wheel over the gizmo, keyboard layout, Delete from the tree and double-click connected in all three modes. MCP checks exercise stdio initialization/discovery/call/read/error.

To extend:

1. Add a case using `api.call(...)` to `suite.js`; it also runs in the embedded runner. Use invariant/behavior checks, not implementation mirrors.
2. Put real pointer/keyboard/drop regressions in `ui.mjs`, `view-live.mjs` or another focused UI module.
3. Put small deterministic assets in `scenes/` and record their origin/expected geometry in `scenes/README.md`.
4. Keep expected results meaningful and stable. Do not silently lower tolerances or remove a failing assertion to get green.

The runner imports the actual production `index.html`; it does not inject private engine functions, replace shaders or patch application source.

Regenerate the unique-cell fixture through the public API with `node tests/scenes/generate-unique.mjs`. Its seed and geometry are deterministic; native object IDs and saved camera records can change, so the entire HASH byte digest is not a fixture invariant.

`view-suite.js` adds per-view shading/HASH persistence, angle approximation, packed Share URLs, near-plane color regression, unfilled component mode transitions and a one-physical-pixel wire check. `view-live.mjs` checks middle/right navigation and double-click through the gizmo, mesh Ctrl+A, surface publication before pointer release, exact Undo, real clipboard Share and fragment startup. `heavy-live.mjs` repeats live edits on 2304 distinct cells, verifies final geometry, Undo and Cancel with a worker potentially in flight, and records actual latency plus frame timings. Timing is reported separately from drawing speed.

New regressions: `next-interaction.mjs` checks Edge highlight pixels, component-footprint Connected picking and quick/slow double clicks; `fixture-transform.mjs` measures the first three object drags in the 100M-triangle HASH during test:all. Heavy live edits verify exactly four incident cells, including a return to the original point, unchanged-cell GPU hashes and equality with the full `spline.rebuild` oracle. STL tests assert one object, unchanged dimensions and no automatic enlargement of small geometry.

`features-suite.js` covers all three polygon/cubic Boolean operations, independent volume checks, GPU disjoint assembly, empty/nested results, material provenance/HASH/baking, Outline + Undo + downstream Extrude, spatial Outline, imported-surface recognition with exact GPU Undo, independent helper/light switches, path tracer object pixels, shared-device ownership, realtime camera refresh and BVH reuse. `simd.mjs` checks exact STL/SIMD bits, table growth, terminal NaN/Inf and Float64/Float32 affine equivalence. All five lazy source blocks are syntax-checked in addition to the two executable scripts.

WASM kernels are embedded, with portable JS fallback. To rebuild with a wasm-capable clang: set `CLANG` if needed and run `node tools/build-simd.mjs`. No generated WASM sidecar is needed at runtime. Native `opac` is the historical transparency percentage (0 means opaque).

`feedback.mjs` checks Boolean creation/reparenting/disable/gizmo and exact operand preservation, polygon wire in Solid+Isoparms, empty-seed Ctrl+A, selected-only tangents, signed Outline in Attributes with real diagonal pointer gestures, draw-mode exit, and cage approximation for Extrude/Lathe/Sweep. The browser's native double-click event defines Connected; the obsolete extra 300 ms cutoff is gone.

`engineering.mjs` imports 12 analytic engineering STL fixtures, checks reconstruction/bounds/volume and exact Undo, then runs all three Surface operations on two welded closed meshes (130,048 input triangles), validates every result edge has two incident faces, and exercises disjoint WebGPU assembly on 975,360 triangles without geometry readback. The fixture sphere poles are welded before testing so the input itself is closed. Volume Boolean was removed.

With sampling strictly driven by the cage, `unique-patches.hash` rebuilds to 244,657 triangles (the previous extra refinement produced 337,398). Current standard and DPR 2 stress results and exact production SHA are recorded in results/latest.json.

revisions.mjs covers copies/clipboard/isoparms, new-object gizmo/order, hidden edges, click-vs-drag, shared Instance/Cloner/Symmetry resources and HASH, path/surface distribution, Target, PSR/mesh/spline point animation, Morph reference and nonlinear pose curves, Bevel with exact Undo, pen tangents, and the supplied Boolean-to-patch fixture. Native resources are only inspected for ownership/pixel evidence; operations use frameAI/editor UI.

`release.mjs` adds native glTF/GLB + UV/material mask/HASH tests (downloaded DamagedHelmet plus small deterministic fixtures), Car/Tree/Human variants, Solo hierarchy, polygon tools with UV/mask Undo, real Add Point menu and Edge/Polygon Shift-drag, 13-face / 13-cell Morph fingers, and all three Booleans on the original 1.57M-triangle test.stl. `diagnostics.mesh.volumeOrigin` is necessary when comparing non-closed surfaces. The unsupported-type contract test now uses an actual unknown type because Car is supported.

Generate the new scenes with `node tests/scenes/generate-release.mjs --hands` or `--stress`. `release-1000-10m.hash` contains exactly 1000 objects / 9,993,256 triangles and all 32 supported object types, not an instancing-only stand-in. A separate load/timing report lives in `results/stress-release-validation.json`; no user fixture was replaced.


`followup.mjs` adds native gizmo distances/quantization rings/snap guides, the 24 px middle-click tolerance, pen controls/free tangents, material library click routing/object materials, bounded viewport pixel readback and roughness reflections, binary STL world-space round trip, original Morph mode/time controls, and the 1000-object Solo CPU check. `release.mjs` verifies all three operations after a real 1000x Rescale and manual Boolean parenting. Heavy local fixtures are ignored by Git; supply `test.stl` locally and generate `release-1000-10m.hash` with the recipe above to run these specific checks. No GPU-adapter skip counts as a pass.

When a Git-excluded heavy fixture is absent, the report lists that specific fixture under `skipped`; assertions are not fabricated. WebGPU startup remains mandatory. Local full release validation includes both the original STL cases and the generated 1000-object Solo case.

`modeling-feedback.mjs` exercises patch source Vertex/Edge/Polygon picking, Shift union and Ctrl XOR for clicks and rectangles, spline Connected, temporary component pivots, mirrored/independent tangents, point extension, segment copy/extrude, pen closure hover, camera-normal navigation fallback, partial Outline and real diagonal viewport dragging. It also checks free pen handles and their moving display lines. `lighting-feedback.mjs` probes the actual production environment cubemap on its existing GPUDevice: flat-top radiance, edge decay, bake reuse and Infinite Light intensity/width/rotation. These checks run in both standard and stress profiles.

`replica-feedback.mjs` adds native-only live generator edits, all six Instance/Symmetry/Cloner orderings, shared geometry/selection/material resources, instanced drawing, copy/delete UI, caret/arrow events and a dense Boolean seam regression. `npm run test:witch` is an opt-in run against the unchanged local `tests/scenes/ведьма.obj`: subtract/union/intersect with a cube, source digests, 1000 full-resolution occurrences and actual WebGPU timings. Its report is `tests/results/witch-final.json` with the exact HTML SHA-256.


`pivot-feedback.mjs` covers physical L in two layouts, repeated numeric arrows, SVG text plate bounds, doubled rotation bands, Object Browser tag priority, source/Instance pivots, local clone random transforms, exact batched GPU extents, stable surface distribution, Cloner-to-group conversion with Undo/Redo and copy-on-write edits, and distinct static/moving instance buffers. `npm run test:cloner-witch` loads the original local witch and measures Count changes (100 → 200 → 1000 → 50), verifies one surface preparation/readback, stable placement prefixes and source PSR/pivot semantics; report: `tests/results/object-cloner-witch.json`.
