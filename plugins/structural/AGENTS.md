# Structural

Authoring only; no FEM/voxelization/stress/safety-factor/deformation/optimization result.

- Shared 100 mm helper; native affine frame is sole size model. Voxel size/Material %/Displacement are stored finite settings with shared manifest validation.
- Only fieldless Fixture (structural_fixture) and Preserve (structural_preserve) tags. status reports authoringOnly/numericalAvailable:false; numerical/result endpoints reject STRUCTURAL_AUTHORING_ONLY before mutation/device/capture. Keep disabled Under construction, no synthetic displays.
- No runtime grid/job cache/worker/numerical buffers/readback. Experimental component tests do not qualify a scene solver.
- Missing core prerequisites: tag units/ranges/vector rows, multiple independently animated Force instances and inherited owner+tag provenance. Scalar/enum storage is insufficient; do not register fields discarded by core.
- Future model: per-owner clipped Hex8 grid, nearest Material, unioned material volumes, additive total force N/torque Nm about native pivots, reliable fixture/load/contact mapping. Define SI physical frames before solving transformed boxes. Use Safety factor, not Min safety factor.
- Sequence: shared tags; clipped geometry/load admission; independently verified solve; extraction/optimization. Require native history/HASH, independent oracles and bounded time/memory at each stage.

Checks: node --test plugins/structural/tests/authoring-preview.mjs; node plugins/structural/tests/authoring-browser.mjs --headless. tests/index.mjs discovers authoring gate, not physics qualification.

## Load/tag/numerical contracts for continuation

- Address physical tag sources as (native owner hash,tag UID), never bare UID: duplication can preserve UID in another owner namespace. Multiple Force instances require independent native animation paths and atomic multi-target validation; Material/Optimize Space require preset fields, Force two compact vector rows in N/Nm. Generic scalar tag bridge does not supply this yet.
- Captured provenance must implement nearest inherited Material and additive total Force once per source, not once per descendant. Force/Torque are resultant wrenches about native source pivot. Mapping must conserve total force AND moment at several resolutions; unrepresentable moment is explicit failure, never adjusted load.
- Per-Structural grid clips actual evaluated material/fixture/load/preserve/optimization volumes. No bounds-as-solid or cuboid-only substitution; unresolved dirty/open occupancy is not unique interior. Rotated/nonuniform frames require explicit mm->SI physical axes and independent overlap/union/load tests.
- Fixture overlap-to-weld is defined before each independent load case. Frictionless contact requires active nonpenetration solve, not just linear PCG. Rigid-body/nullspace/convergence errors must prevent valid-looking stress. Displacement convergence, stress/yield Safety factor, compliance/SIMP, fatigue/buckling and contact are separate claims.
- Reuse preserved research by role: experiments/structural-capture/domain-reference.js, structural-surface/sat-reference.js, structural-load/load-mapping-reference.js and resolved-case.js, structural-pcg/gpu-pcg.js and hex8-reference.js. They are uninstalled numerical references, not scene solver admission. PCG diagnostics serialize bounded reads; dispose waits for pending maps/copy cleanup and shares completion promise, rejecting late/stale readbacks.
- Solve remains explicit. Animation consists of independent load cases, not invented transient dynamics; optimization shares one topology across cases. GPU FEM/grid/density/load caches stay outside HASH. Result to Object must use native polygon publication after actual qualified result, not Patch reconstruction.
