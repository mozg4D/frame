# Frame r226 explicit rotation Quantize

When Quantize is enabled, axis and screen rotation now follow explicit angular increments again. Quantize OFF remains continuous. The historical pointer-distance bands use 10, 5 and 1 degree steps; the removed 0.5 degree band remains removed. Enlarged curved controls, Move/Scale quantization and Snap remain unchanged.

r225 deliberately made axis rotation continuous even with Quantize enabled. The user clarified that the enabled control should still quantize polygon rotation. r226 implements that corrected behavior in the common object/component rotation path and in screen rotation.

The exact release payload passed 64 trusted-pointer WebGPU browser cases: object and face modes, world and object/local coordinates, axis and screen handles, positive/negative motion and Quantize OFF/ON. Free 13.37 and 5.49 degree motions remain free when disabled; enabled motions use explicit increments. See [native case receipt](R226_NATIVE_QUANTIZE_CASES.json). All 57 addressed asset hashes and import-map SRI entries were checked; the editor's full forward/inverse patch is exact.

The same constraint code was also checked on the full private high-triangle model in the recovered development stage after stock Rescale x1000. Eight trusted three-move Rotate/Scale gestures preserve one scene object and exact position/normal/index Undo. That model and its geometry are excluded from this repository and release. These are correctness checks, not a heavy-scene responsiveness certification: Scale remains slow in that development path.

This release is limited to the verified Quantize correction. Persistent authoring identities, quiet derived welding/crease preparation and an island GPU transform path remain separate development work. Heavy component latency, cold selection and the broader native migration acceptance remain open. No Slice/G-code changes are included.

Editor SHA256: `2fbd0f5a8cefe96ff28eb3c2aae136292f052478b6268f2c0b515b5b78909f23`.
Native SHA256 unchanged: `634f2da7e78aae73a81d0e16fc7817cec36996040f0f2f0066a08a04ddb4603d`.
