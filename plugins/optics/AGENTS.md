# Optics foundation

Follow ../../AGENTS.md and ../AGENTS.md. Runtime is native authoring only and explicitly unfinished. Keep every object, reference, transform, field, tag, history and HASH record in Frame. Never import experiments/optics into the runtime or call its interface primitives a scene solver. No fabricated images, ray paths, zero-valued measurements or optimizer success.

Read README.md and PLAN.md. Run node --test plugins/optics/tests/authoring.test.mjs experiments/optics/reference.test.mjs, then the focused hardware browser gate. Standard/stress discovery uses tests/index.mjs. Keep tests headless on this LAB to avoid user windows, OBS and printing. GPU usage must be coordinated with other workers. GPU skips are not passes.

Optical/Blocker are authoring tags only. Optical has no qualified material or coating database. Viewport colors are not optical properties. Plane normal is local +Z, with X/Y dimensions from native transforms. No separate scene, binding registry, editor, camera, gizmo, renderer/device or background loop.
