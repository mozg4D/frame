# Native Structural surface work: CPU-prepared kernel prototype

Uninstalled continuation, 2026-11-09. This adds a bounded dispatch recipe and WGSL source for surface-to-cell candidate detection against the current native captured geometry. There is no GPU runner, allocation, compilation, command submission or numerical result in this packet. GPU qualification awaits the coordinator's slot. No geometry/material, scene JSON or numerical data is added to HASH or persistence.

## What this stage contributes

The earlier capture handle now feeds `prepareNativeSurfaceWork(capture)`. Each current native occurrence retains its borrowed packed Float32 XYZ/Uint32 index buffers or paged integer texture views and source-to-Structural affine matrix. No normalized CPU triangle copy or unavailable old prepareVolume API is required. Work is clipped by the captured domain's cell grid; no cells outside Structural are planned. Triangle bounds are not substituted for source geometry.

The recipe covers each triangle once per selected occurrence, in sequential batches of at most 256 triangles and 262144 cell-triangle pairs. Total work is capped at 8000000 pairs, 4096 cells, 65536 triangles per occurrence and 1024 batches. It returns ordinary counters in summary, and checked internal borrows containing source resources and copied 128-byte uniform payloads. Source/frame invalidation permanently revokes new borrows. Retiring a recipe drops its references and never destroys native resources. Future execution must recheck currentness after every await and before each submission; borrowed batches must not outlive their capture.

Paged inputs must expose the actual native scalar descriptor: kind texture, r32uint, one channel, integer count/dimensions/layers/size, sufficient count for packed positions/indices, and consistent physical capacity. Truncated or incompatible metadata rejects before any GPU work. A WGSL delimiter regression catches the missing-parenthesis error found in review, but does not replace actual shader compilation.

`nativeSurfaceWGSL('buffer'|'texture')` builds the source-adapted surface kernel. Native storage addressing follows the current printer: three Float32 position scalars per vertex, three Uint32 indices per triangle, or paged R32 uint scalar texture loads. Per-occurrence native transforms are applied on GPU. SAT triangle/AABB helpers are retained from the earlier occupancy prototype, without arithmetic changes; see SOURCE-PROVENANCE.json. The old parity/ray volume classifier is not activated.

## Label semantics and limits

- 0: no surface candidate encountered so far; volume is unclassified. This never means certified exterior/air or zero material.
- 2: source triangle/cell surface candidate under the sampled Float32 SAT/guard policy. This is not authoring-surface certification, inside material or a valid boundary-condition mask.
- 3: invalid indices, unsupported coordinate range or nonfinite transformed source data encountered. A later positive surface candidate may replace uncertainty; no physical volume is inferred.

A future runner must zero-initialize its owned label buffer, execute batches sequentially on the borrowed shared device, preserve labels across batches and release only owned resources. Normal orientation/winding is not consulted. Repeated/overlapping triangles do not cancel a positive surface candidate. This first adapter restricts matrix coefficients to exactly representable Float32 numbers and rejects other transforms before GPU work. It does not provide arbitrary double-transform error propagation. The original CPU-only packet did not compile or numerically compare the retained generated WGSL on hardware. The dedicated test-only gate below exercises controlled native-format fixtures; its exact source-bound report is required before claiming those bounded hardware checks. Degenerate/dirty geometry and large/canceling coordinates require dedicated hardware/robustness checks; this source is not advertised as a robust finished voxelizer.

## CPU evidence

Run:

    node --test experiments/structural-surface/tests/surface.mjs

The tests check exact uniform offsets, complete bounded batch coverage, buffer/texture admission, config isolation, source invalidation, native resource ownership and the actual preceding capture-handle handoff. Independent test-only Sutherland-Hodgman clipping produces expected in-box surface slabs and verifies reversed/duplicate/outside triangle fixtures. These are oracles for future GPU comparison, not evidence that the WGSL currently returns those labels. Source assertions check storage/dispatch guards only. Completed-operation CPU timing covers recipe preparation and retirement, not GPU execution or scene rendering.

## Integration sequence

Apply after the first three Structural continuation packets and verify dependency hashes. Keep this unimported by the installed plugin. After a coordinated GPU slot: compile both storage variants, compare real labels against clipping fixtures including rotated/crossing/dirty meshes, test cancellation/device/resource ownership and record actual work/memory/timing. Only then implement a GPU job owner and a separate explicit volume-interior policy. Surface-only labels must never be passed to resolved-cell PCG as material, fixture overlap or Force region occupancy.

Effective Structural tag capture, material group unions, robust interior reconstruction, validated fixture/load intersections, scene PCG, result display and topology remain outstanding. Existing PCG hardware evidence does not qualify this kernel. Publication and full shared tests remain coordinated through the main batch.

## Controlled shared-device hardware gate

Run node experiments/structural-surface/tests/hardware.mjs headlessly in the coordinated GPU queue. It uses Frame existing GPUDevice, test-owned native-format packed buffers and r32uint array textures. Both generated/literal storage variants compile; actual bounded dispatch/readback is compared with an independent clipping oracle for crossing, affine, reversed, repeated, outside and uncertain fixtures. A scoped malformed-parenthesis negative control verifies that the compiler catches the reviewed regression. The report records source hashes, native adapter, completed-operation timings, staleness/retirement and owned-resource release.

These controlled fixtures do not qualify completeness of native scene capture, production cancellation/device loss, arbitrary dirty geometry, volume interiors, physical tags or scene PCG. Keep this experiment unloaded and all scene-solver availability unchanged. Original qualification/provenance files remain historical CPU evidence; the new hardware report belongs to tests/results/hardware.json.
