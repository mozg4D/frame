# Numeric precision

These rules distinguish editable source data, geometric decisions, and display buffers.

## Preserve stored values

- Keep authored cage points, handles, transforms, and animation values in Float64 precision.
- Preserve existing Float32 polygon positions, normals, UVs, and renderer buffers without another precision reduction during save/load.
- Preserve the currently decoded values of quantized catalog geometry. Converting them to Float64 cannot recover information lost before decoding.

## Protect geometric decisions

- Retain the current Float64 or exact predicates for orientation, topology, section/intersection construction, containment, and distance-threshold decisions.
- Keep authored values and current decision precision when sampling curves or applying parent/local transforms.
- Use Float32 for existing GPU/display paths within their supported coordinate ranges. Display accuracy does not establish authoring or topology accuracy.
- Float64 can also lose accuracy near degeneracy. Keep exact fallbacks where required.

## Evaluate precision changes

Float32 storage does not make JavaScript Number arithmetic Float32. Test the actual proposed arithmetic, including conversion and transfer costs.

Before reducing precision, establish operation-specific error bounds and test degenerate geometry, threshold decisions, large parent offsets, small local details, source identities, and native save/load. Measure complete application flows as well as isolated kernels. A faster arithmetic microbenchmark alone is not evidence of a safe change or a faster Slice.
