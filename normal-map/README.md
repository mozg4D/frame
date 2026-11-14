# Standalone normal-map converter

Native WebGPU/WGSL, independent of Frame. No app imports, scene, neural model,
WebGL, CDN or runtime dependencies. Node + Playwright are only the batch host.
The original color textures are read without modification.

From this directory:

```powershell
npm install
npx playwright install chromium
node convert.mjs
node verify.mjs
```

When the parent checkout already has Playwright and its Chromium installed,
`node convert.mjs` works immediately. A hardware WebGPU adapter is required;
software adapters are rejected. `NORMAL_MAP_BROWSER` can select a Chromium executable.

Default input: `../textures`. Default output: `maps/*.normal.png`, preserving
the complete source basename and original dimensions (512 × 512 for this set).
Normal maps are lossless RGB8 data in opaque PNG containers, tangent space,
OpenGL +Y. Sample them as **linear data**, never as sRGB color.

```powershell
node convert.mjs --input C:\other\textures --output C:\other\normals
node convert.mjs --format directx --output maps-directx
node convert.mjs --strength 0.7 --output maps-subtle
```

Every run also makes `maps/preview.html` and neutral/textured light previews.
Open that HTML directly to compare all materials. Preview assets are local,
regenerable review files and are excluded from Git. `maps/manifest.json`
records per-material settings, input and converter SHA-256 hashes, dimensions,
GPU timestamp intervals, normal statistics, and a complete-batch source hash
recheck. Its generation timings include idle-clock and scheduling effects;
use `verify.mjs` for repeated-conversion measurements without PNG encoding.

## Method

`normal.wgsl` contains the whole conversion algorithm. A tiny 128 × 128 CPU
exposure analysis provides robust percentiles; all height/normal construction
runs on the GPU. Three steps cover ordinary materials:

1. Perceptual height estimate, material-specific range and a small bilateral
   filter. Compressed-source noise is softened while grooves remain visible.
2. Six-level Float16 low-pass pyramid. Difference-of-Gaussian bands separate
   fine, medium and broad detail and reject very broad baked illumination.
3. Gradient combination and normalized tangent-space RGB8 output. OpenGL and
   DirectX differ only in green sign. Repeat addressing is the default.

Diamond plate first combines bright/dark departures from its background and
closes their silhouette. Pebbles instead use dark crevices as boundaries.
A bounded jump flood estimates boundary distance, then a rounded bevel
replaces the original baked shading. These optional modes add work only to
those two materials. The bevel radius is limited to 32 source pixels.

`presets.mjs` contains explicit material hints for all 32 built-in textures.
It keeps polished marble nearly flat, avoids exaggerated wood grain, isolates
brick mortar by chroma, and strengthens the broad sand ripples. Unknown names
use generic defaults; they should be reviewed and tuned.

The exported `createConverter(device)` function accepts an existing GPUDevice
and compiles its pipelines once. Await `convert(ImageBitmap, options)`; it
returns RGBA bytes, dimensions, applied settings and timing. `png(result)`
encodes them. Reuse the converter sequentially. Each conversion destroys its
temporary GPU resources after readback; no texture or pixel cache accumulates.
Typical materials use one compute pass and seven dispatches. Height scratch
textures cover only the pyramid; the structured modes add two full-size
Float16 work textures. Memory scales with one image, not batch length.

## Quality and verification

`verify.mjs` runs hardware checks for flat, tiny, odd and rectangular images;
analytic sinusoidal surface normals and their sign; green-channel inversion;
removal of an affine illumination ramp; outward normals of a recovered emboss;
invalid parameters; GPU validation; and repeated 512px conversions. Its report
is saved to `work/verification.json`; the checked run is also recorded in
`qualification.json`. The shader and all test inputs are independent of Frame.

The included maps were reviewed both as normals and under neutral directional
lighting. Metric checks establish valid vectors and expected mathematical
behavior, not recovery of unknown real geometry. The reviewed material
choices favor plausible relief over turning every color variation into height.

These are estimates from single color images. Paint, grain, stains and shadows
cannot always be separated from geometry. Pebble outlines and plate bevels
are approximate; original baked lighting also remains in the color texture.
Physical relief depth cannot be inferred without texture scale. Repeat sampling
makes filtering consistent across an edge; it does not repair a non-tileable
source or make its opposite edges identical. Transparent inputs are treated as
color surfaces and produce opaque normals; alpha-cutout edges need their own
material mask. No additional detail is invented by upscaling.

Normal encoding reference: [glTF material normal texture](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#material-normaltexture).
Shader reference: [WGSL specification](https://www.w3.org/TR/WGSL/).
