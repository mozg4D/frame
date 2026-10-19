# Test scenes

- `unique-patches.hash`: deterministic seed 6139, a 48×48 grid of different nonplanar curved cells. 2304 cells, 2401 authored vertices, 4704 spline segments; 337398 surface triangles / 169605 vertices at the stored approximation. Every cell has different positions/tangents. It exercises the general Float64 worker builder, not a repeated-cell cache or the regular translational GPU fast path. Source recipe: `generate-unique.mjs`.
- The tiny OBJ and six-vertex polygon weld scenes are generated directly in `suite.js`, avoiding binary fixture duplication.
- Existing user scenes are in this directory: `frame-spline-regular.hash`, `test.stl`, `stress-mesh-100m.hash`. Large fixtures are opt-in with `npm run test:all`.

`stress-mesh-100m.hash` is the unchanged 100,548,288-triangle saved 64-object stress matrix, renamed from frame-before-object-mode.hash. `test.stl` itself is one small-scale source object; normal import no longer multiplies coordinates or creates copies. Legacy embedded-cage HASH fixtures intentionally remain in their original bytes and test automatic source-child normalization.

boolean-patch-regression.hash: the 269-vertex / 534-triangle Boolean mesh supplied in the user's share link on 18.10.2026. Expected: exact position digest and signed volume after To Spline Patch; 534 authored cells without resolver cycle-budget overflow.

- `morph-fingers.hash` (also `morph-hands.hash` for the previous path): one finger with 13 authored polygon faces / 26 triangles and one curved spline patch finger with 13 cells, each with three independent Phalanx pose curves. Generator: `generate-release.mjs --hands`.
- `release-1000-10m.hash`: 1000 objects, 9,993,256 triangles, 32 supported types; 919 different explicit dense meshes plus generators, stock models, curves, lights, cameras, hierarchy, materials, per-face masks, UV and Morph. Generator: `generate-release.mjs --stress`; source seed/manifest/validation are in ignored results/.
- `material-selects.gltf` / `shared-mesh.gltf`: deterministic embedded buffers for normalized UVs, two material primitives on one object, repeated mesh nodes and node hierarchy. Metres in glTF become millimetres.
- `DamagedHelmet/`: unchanged Khronos sample asset for the native glTF importer. Model/rebuild attribution and license information are preserved in its README; test data only, not a runtime library.

Heavy scenes are intentionally excluded from Git. The original local `test.stl` and `stress-mesh-100m.hash` are unchanged; the 1000-object scene is reproducible with `generate-release.mjs --stress`.
