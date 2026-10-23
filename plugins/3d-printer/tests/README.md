# Printer fixtures and checks

`node tests/plugin-infrastructure.mjs` runs plugin-local checks in full Chromium headless with hardware WebGPU. Standard and DPR-2 stress suites discover the same checks automatically.

`node plugins/3d-printer/tests/generate-zoo.mjs` creates `tests/scenes/slicer-zoo.hash` and refreshes `slicer-zoo.json`. It contains 27 named cases: rounded taper, acute star, eleven width thresholds around W=2 mm, nested shells/solids, needle and micro-islands, reversed/mixed winding, a missing triangle, duplicate faces, an unwelded 0.04 mm crack and five overhang angles around 45 degrees. The local user-supplied `tests/scenes/test.stl` is included as an incoming-production reference when present. `--without-reference` generates only the compact synthetic cases. No slicing code is involved.

The generated HASH and large original STL remain local/ignored. The recipe and small manifest are versioned. Never alter the original STL to make tests pass. The manifest records its SHA-256 and whether it was present.

Future slicer invariants and the full handoff specification are in ../AGENTS.md. Until a slicer exists these are scene/viewport/parameter checks, not claims about printable toolpaths.
