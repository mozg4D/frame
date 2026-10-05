# Numeric precision evidence

Float64 is retained for authored cage/handle/transform/animation values and for demonstrated sensitive geometric decisions. This does not mean every operation needs Float64. Existing Float32 polygon positions, normals, UVs and renderer buffers remain Float32; serialization preserves their current bits without another precision reduction.

## Storage

Of 354 coordinates and handles in the saved test scenes, 50 are not exactly representable in Float32. The largest observed storage rounding change was 0.0000030517578011313162 mm. Exact authoring preservation is the requirement here, rather than an inferred manufacturing tolerance. The existing catalogue sources contain p16 coordinates; the native migration preserves their currently decoded Float32 positions. Casting these positions to Float64 cannot recover the unknown prequantization values.

## Arithmetic

Tests used explicit WebAssembly f32/f64 and f32x4/f64x2 instructions compiled with WABT 1.0.39, with JS Number arithmetic as the Float64 baseline. Float32Array storage alone does not change JS Number arithmetic to Float32. No fast-math, relaxed SIMD or FMA was used.

|Operation|Evidence and retained use|
|---|---|
|Display affine transforms|On the repeated saved-coordinate workload, actual Float32 maximum output error was 0.000012654705074055528 mm with no non-finite or sign changes. Existing GPU/display Float32 use remains. This bounded display result is not an authoring, large-parent-transform or topology accuracy guarantee.|
|Orientation and topology|All-Float32-exact inputs A=(0,0), B=(8192,8191), C=(8193,8192) produce determinant 1 in Float64 and 0 in actual Float32. Keep Float64/exact decisions.|
|Section/intersection interpolation|Near-degenerate controls include four non-finite Float32 results; the repeated workload's maximum Float32 difference was 0.25 mm. Keep current Float64 geometric construction.|
|Point-to-segment distance|Maximum squared-distance output difference on the repeated workload was 0.000030696186854584084. Zero/threshold classification changed on some rows. Float32 can serve approximate display estimates with an explicit error margin; production inset/neighbor/containment decisions retain current Float64/exact handling.|
|Approximation sampling|Rounding source handles near the 10-degree boundary changes three samples to two. Keep authored source values and current decision precision.|
|Parent/local transforms|At a 1,000,000 mm parent offset, Float32 transform/inverse loses local 0.001 and 0.003 mm detail; at 100,000,000 mm it loses 0.125 mm. Keep current authoring/Slice transforms. Float64 still has representational error near degeneracy.|

No new arithmetic kernel is downcast in this release. A future bulk Float32 implementation needs operation-specific error bounds, decision separation and full application measurements; the current evidence does not establish safe Float32 topology or a full Slice speedup.

## Measured speed

Chrome on Ryzen 7 3700X, 262,144 records per call, nine rotated rounds, eight repeats per observation and two warm rounds. Values are median milliseconds per arithmetic call; input packing, allocations, conversions and transfers are separate.

|Kernel|JS Number / F64 storage|JS Number / F32 storage|Wasm F64|Wasm F32|F64 SIMD|F32 SIMD|
|---|---:|---:|---:|---:|---:|---:|
|Affine|0.875|1.100|0.262|0.237|0.237|0.113|
|Orientation|1.762|2.300|0.488|0.338|0.400|0.138|
|Section|1.800|2.425|0.375|0.313|0.275|0.112|
|Distance|2.250|2.712|1.400|1.613|1.800|0.800|

Float32 ingress conversion, copy-in and copy-out took 4.300 ms; the deliberately allocating Float64 copy path took 5.600 ms. Compilation and instantiation took 0.400 and 0.100 ms. Transferable 6/12 MiB buffers returned at the browser timer resolution, which is not evidence of zero actual transfer cost. These isolated kernels exclude spatial indexes, objects, Clipper, exact fallbacks, scheduling and rendering. In particular, scalar Float32 distance was slower than scalar Float64 in this observation.

Official implementation/specification references: [WABT](https://github.com/WebAssembly/wabt), [WebAssembly instructions](https://webassembly.github.io/spec/core/syntax/instructions.html). Detailed measurements, scopes and source hashes are archived in the bounded r186 precision/native evidence report.
