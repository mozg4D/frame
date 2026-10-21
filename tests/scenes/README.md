# Test scenes

- `unique-patches.hash`: deterministic seed 6139, a 48×48 grid of different nonplanar curved cells. 2304 cells, 2401 authored vertices, 4704 spline segments; 337398 surface triangles / 169605 vertices at the stored approximation. Every cell has different positions/tangents. It exercises the general Float64 worker builder, not a repeated-cell cache or the regular translational GPU fast path. Source recipe: `generate-unique.mjs`.
- `resolver-feedback.json`: the sixteen-vertex, twenty-eight-segment cage supplied in the 21 October 2026 share link, plus fourteen oriented reference cells obtained from `origin/main` r248 (`238944a`). Its obsolete twelve-cell table is deliberately retained in the input to verify that segment geometry determines the surface.
- The tiny OBJ and six-vertex polygon weld scenes are generated directly in `suite.js`, avoiding binary fixture duplication.
- Existing user scenes are in this directory: `frame-spline-regular.hash`, `test.stl`, `stress-mesh-100m.hash`. Large fixtures are opt-in with `npm run test:all`.

`stress-mesh-100m.hash` is the local 100,548,288-triangle saved 64-object stress matrix. If absent, tests build it from `tst.stl` or `test.stl` with production import cleanup, 1000x geometry scaling and 64 independent records. Recipe: `generate-heavy.mjs` / `npm run test:fixture`. Existing user fixtures are preserved. `test.stl` itself is one small-scale source object; normal import no longer multiplies coordinates or creates copies. Legacy embedded-cage HASH fixtures intentionally remain in their original bytes and test automatic source-child normalization.

boolean-patch-regression.hash: the 269-vertex / 534-triangle Boolean mesh supplied in the user's share link on 18.10.2026. Expected: exact position digest and signed volume after To Spline Patch; 534 authored cells without resolver cycle-budget overflow.

- `morph-fingers.hash` (also `morph-hands.hash` for the previous path): two horizontal fingers with rounded rectangular sections (one polygon, one spline patch), plus an elbow with visible biceps deformation. Curl/Flex use native authored pose curves and preserve section area/neutral-axis arc length. Generator: `generate-release.mjs --hands`.
- `release-1000-10m.hash`: 1000 objects, 9,993,256 triangles, 32 supported types; 919 different explicit dense meshes plus generators, stock models, curves, lights, cameras, hierarchy, materials, per-face masks, UV and Morph. Generator: `generate-release.mjs --stress`; source seed/manifest/validation are in ignored results/.

The unchanged release fixture now rebuilds to 9,993,290 triangles: the spline finger uses the original adaptive surface builder and has 284 triangles instead of its saved 250. Every other object's triangle count is unchanged.
- `material-selects.gltf` / `shared-mesh.gltf`: deterministic embedded buffers for normalized UVs, two material primitives on one object, repeated mesh nodes and node hierarchy. Metres in glTF become millimetres.
- `DamagedHelmet/`: unchanged Khronos sample asset for the native glTF importer. Model/rebuild attribution and license information are preserved in its README; test data only, not a runtime library.

Heavy scenes are intentionally excluded from Git. Existing local `test.stl` and `stress-mesh-100m.hash` files are preserved; the 1000-object scene is reproducible with `generate-release.mjs --stress`.


- `material-gallery.hash` (generated locally, excluded from Git): 12 imported Khronos sample models, 18 materials, 40 source images, 567,305 triangles, arranged over a 4x3 area with an active gallery camera. Includes base color, normal, AO, emissive, packed MR and alpha test models. Rebuild: `node tests/scenes/generate-material-gallery.mjs`; the temporary merged GLB is removed after native HASH download. `--prepare` only writes the intermediate import for diagnostics.
- `material-models/`: original GLB fixtures from [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models). Adjacent per-model Markdown files preserve the upstream model attribution/license text. These are test fixtures, not application dependencies. Models: Avocado, BoomBox, DamagedHelmet, Duck, Lantern, WaterBottle, BarramundiFish, AntiqueCamera, BoxTextured, MetalRoughSpheres, AlphaBlendModeTest, NormalTangentMirrorTest.
