# Structural

Authoring only; no FEM/voxelization/stress/safety-factor/deformation/optimization result.

- Shared 100 mm helper; native affine frame is sole size model. Voxel size/Material %/Displacement are stored finite settings with shared manifest validation.
- Only fieldless Fixture (structural_fixture) and Preserve (structural_preserve) tags. status reports authoringOnly/numericalAvailable:false; numerical/result endpoints reject STRUCTURAL_AUTHORING_ONLY before mutation/device/capture. Keep disabled Under construction, no synthetic displays.
- No runtime grid/job cache/worker/numerical buffers/readback. Experimental component tests do not qualify a scene solver.
- Missing core prerequisites: tag units/ranges/vector rows, multiple independently animated Force instances and inherited owner+tag provenance. Scalar/enum storage is insufficient; do not register fields discarded by core.
- Future model: per-owner clipped Hex8 grid, nearest Material, unioned material volumes, additive total force N/torque Nm about native pivots, reliable fixture/load/contact mapping. Define SI physical frames before solving transformed boxes. Use Safety factor, not Min safety factor.
- Sequence: shared tags; clipped geometry/load admission; independently verified solve; extraction/optimization. Require native history/HASH, independent oracles and bounded time/memory at each stage.

Checks: node --test plugins/structural/tests/authoring-preview.mjs; node plugins/structural/tests/authoring-browser.mjs --headless. tests/index.mjs discovers authoring gate, not physics qualification.
