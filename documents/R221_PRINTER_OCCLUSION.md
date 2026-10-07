# r221 printer frame depth correction

The printer volume frame now stays visible over farther opaque polygons and remains hidden by nearer polygons. Native rendering draws the opaque phase before the transparent phase, preserving renderOrder and depth sort within each phase. There is no printer depth bias or geometry/clipping rewrite.

Editor is unchanged from r220:752b52949252a277116b907e9d55325ea171da91b1cc3943220d47324b0dfd29. Native runtime is401302bytes/28modules, SHA25650cf866dca7c5fbec7f3b7b0a32b3054d39933f30c56cf6f2bd6b0b0857c30b1. Exact canonical source is under native-source/. The only runtime source edit is the phase comparator in gpu-display.mjs; shaders, ABI, camera/depth and authoring state are unchanged.

Fresh lab verification:132actual GPU cases pass at2-byte tolerance across ortho/perspective, origins0/1e8, DPR1/1.25/2, canonical/reflected domains,1x/4x and four-pane clear controls. CPU/recording tests pass87cases4033assertions separately. All57cached addressed assets match bytes/SHA256; read-only offline restart and online recovery pass. RTX3060/Chrome154 is the tested device/browser; no universal adapter claim. Original r220 pixel failures remain retained in engineering evidence.

This coherent correction is separate from the ongoing Ctrl-face copy, Solid corner visibility, Connected/Perspective input and heavy polygon drag work. Private prototypes and multi-second heavy interaction timings are excluded from this release; those remaining editing issues are not claimed resolved. See R220_NATIVE_VIEWPORT.md for retained native capability/precision/adapter limits.
