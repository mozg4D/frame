# Optics implementation plan and concept review

## Source and decisions

The original concept is an initial research prototype, not a proven optimizer. Keep direct geometric Solve separate from angular-path/surface search. Optimization objective E_opt is not physical optical energy; measured power requires a separate conserved ledger. Never optimize source power, drop difficult rays, or interpret independently adjusted normals/paths as manufactured geometry.

Use sparse shared surfaces and wavefront ray queues only after choosing the representation by small reproducible comparisons. Do not commit the entire design to LDI, SDF, dense voxels or full-volume FDTD. Reuse native scene/GPU ownership; avoid permanent CPU mirrors. Frame Docs and Scene Control remain the requirement/experiment interfaces, not duplicate Optics systems.

## A0: authoring and interface laws (this change)

Native task/plane roles, explicit typed links, finite/infinite Subject distinction, mapping choice, source power/wavelength, Sensor resolution, Target goal mode, minimum geometry constraints, tags, unfinished status, tests. CPU reflection/refraction/Fresnel/TIR and power accounting are isolated reference functions only. No scene solver is claimed.

The separate unloaded `validation/power-ledger.js` continuation adds bounded per-source terminal accounting and explicit unresolved power, with focused CPU tests. It validates compact numbers supplied by a caller, not physical transport or task membership. Runtime remains authoring only. Before connecting a tracer, agree source/receiver attribution and resolve the physical capture gate below; do not treat a balanced ledger as successful Solve.

## A1: complete native data and physical capture

1. Generic per-owner helper-line descriptor for core edge picking, dynamic geometry and shared bounds. Cover overlap/occlusion, four views, hidden/disabled parents, Solo, native transform/Undo and headless pointer tests.
2. Material catalog with documented provenance, wavelength ranges, absorption and explicit polarization assumptions; coating R/T/A model distinct from volume medium. Never expose unsupported catalog items to optimization.
3. Per-surface coating assignment through shared Frame fields; task-specific membership/reference contract for fixed geometry. Preserve ordinary material, native geometry and HASH. Fieldless Blocker absorbs actual surface hits, never its bounding box. Missing optical properties make a solve unavailable, not air/glass guessed from appearance.
4. Capture authoritative geometry/resources, transforms and enabled participation without depending on visibility. Current generic capture visibility policy needs deliberate review. Validate closed transparent volumes, open mirror surfaces, ambiguities and out-of-box fixed geometry. Measure shared resource limits before dispatch.

## A2: independently verified direct Solve

Nonsequential closest-surface intersections, explicit media, reflected/transmitted branch accounting, source sampling and receiver accumulation. Track useful, unwanted, absorbed, escaped and unresolved power; interaction limits must preserve the unresolved ledger. Check mirror, dielectric boundary, TIR, simple lens, holes, double-sided Blocker, return paths, dispersion and repeated boundary crossings. Use independent analytic oracles and independent seeded ray sets. Increase sample counts to demonstrate convergence. Cancel/stale/device-loss and invalid geometry must never publish old or partial-success results. Geometric spots are not diffraction PSFs.

## B: fixed-topology angular-path hypothesis

Several paths must share a physically integrable surface. Compare derivatives with finite differences on smooth cases; distinguish visibility/TIR discontinuities. Include zero useful-hit initialization. A fall in internal E_opt only counts when independently retracing real geometry improves physical metrics. Failed hypotheses are recorded, never replaced by an unannounced stock lens.

## C-E: growing scope, after the preceding gates

Finite LED area and broad illumination strip; Imaging across field/depth/spectrum with fixed hardware and explicit coordinate mapping. Then at least one verified topology change adding/removing a patch, hole or reflection. Later multiple sources/targets, coverings, tolerances and manufacturing constraints. Telescope is a research benchmark, not the acceptance shortcut for a universal solver.

## Integration and performance gates

API schemas reject before mutation; native selection/transform/Undo/HASH/duplicate/clipboard/merge and missing references are separate checks. Generic field declarations own units/ranges/animation. Experimental outputs never enter HASH by default. Record source hashes, hardware, seeds, actual wall times, bounded memory, negative controls and unrun stages. Rendering requires real shared WebGPU checks; no software fallback. Standard/stress run only in an isolated headless context. No window manipulation, user scene, OBS or print interaction.
