# Printer viewport integration

The viewport opts into `context.viewport.cameraWGSL` and its affine `frameCameraRelative` helper, documented in ../../plugins.md. The public camera uniform remains unchanged. Only local projection arithmetic changes; topmost preview policy, geometry, slicing/perimeter computation and persistence remain unchanged. The helper preserves tiny relative depth gaps but retains Float32 camera-base error. Native validation remains required. Existing architecture and operation contracts are in ../../plugins.md and AGENTS.md.
