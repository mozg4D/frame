# Printer fixtures and checks

Use `--headless` for quiet Chromium runs on native WebGPU. Standard and DPR-2 stress suites discover plugin-local checks through `tests/index.mjs`.

`node plugins/3d-printer/tests/generate-zoo.mjs` creates the local ignored `tests/scenes/slicer-zoo.hash` and refreshes its small manifest. The 27 named cases cover rounded taper, acute stars, width thresholds, nested shells, needles, islands, winding, missing/duplicate faces, a crack and overhang angles. The unchanged user-supplied `tests/scenes/test.stl` is the incoming reference; never alter it to make checks pass.

The current runtime builds persistent orthogonal GPU LDIs and reconstructs Finish-layer coverage. Section contours, physical-width perimeter planning and machine output remain deferred; see `../AGENTS.md`.

- `npm run test:slicer -- --headless` checks all-layer depth intervals, Finish UI/pixels/Undo, transparent holes, nested parity, union across occurrences, duplicate/reversed faces, buffer/paged sources, frames, cancellation, clipping and HASH ownership.
- `node tests/plugin-infrastructure.mjs --headless` also runs the independent polygon-crossing oracle, ambiguous-ray inspection/recovery, native Slice/Stop, transparent/topmost filled pixels, Delete/Undo/Redo, assembly transforms and warning selection.
- `npm run test:slicer:corpus -- --headless` checks ordered finite clipped intervals for all 27 fixtures and the unchanged STL at 100 mm longest dimension and native scale x1000. The x1000 case compares both axes against a test-only double-precision STL/plane oracle on layers 152, 300 and 500; the maximum symmetric-difference length per sampled ray is bounded by 0.04 mm. Build wall time is measured separately from diagnostic readback.
- `npm run test:slicer:performance -- --headless` measures cold/warm 4000-layer builds, bounded owned GPU storage, metadata-only runtime readback, Finish-to-frame latency and native CPU/GPU frame times. The 128 MiB budget belongs to this benchmark, not every possible model.

These checks validate sampled coverage and its numerical/ownership behavior; they do not certify physical bead placement, exact subpixel topology or swept-strip coverage.

`node plugins/3d-printer/tests/revision.mjs --headless` also verifies requested numeric bounds, attribute order, absent Min path length, and a native gizmo drag overlapping the printer perimeter.
