# Frame

A browser-based 3D workspace for spline and polygon modeling, scene assembly, and print-layer inspection.

**[Open Frame](https://mozg4d.github.io/frame/)** · [Task queue](https://mozg4d.github.io/frame/queue.html)

![Frame workspace](docs/frame-screenshot.jpg)

## Current application

The hosted application is **r227**. It provides parametric primitives, surface generators, Boolean operations, shared instances, materials, and animation. Native `.hash` files preserve editable scenes; geometry exchange supports glTF/GLB, OBJ, STL, PLY, SVG, and DXF.

The viewport requires a supported WebGPU configuration. Startup checks capabilities and offers Retry if initialization fails. Mip-calibration failures expose a copyable diagnostic report; r227 does not claim to fix the mobile startup failure. Cached application resources can be reopened offline through the PWA.

The slicer generates perimeter paths with guarded adaptive handling and Solid or Lines–Dots layer previews. Broader adaptive coverage and the practical print workflow remain unfinished. Heavy component editing and cold selection still need performance work.

## Repository

- `index.html`, `modules/`, `frame-sw.js`, and `manifest.webmanifest`: the current application and PWA.
- `models/` and `textures/`: application assets.
- [native-source/](native-source/): editable native viewport sources and their deterministic bundler.
- [development/gpu-v10/](development/gpu-v10/): unfinished GPU authoring work and reconstruction instructions.
- [development/slicer-lab/](development/slicer-lab/): unfinished slicer work and its development tools.
- [docs/NUMERIC_PRECISION.md](docs/NUMERIC_PRECISION.md): numeric storage and geometry rules.
- [queue.html](queue.html): open work and future ideas.
- [licenses/](licenses/): project and third-party licenses.

Development sources are separate from the current application's loaded modules. See each development directory's README for its status and checks.

## License

Frame's original code and project materials are proprietary. © 2026 FRAME copyright holders. All rights reserved; see [licenses/FRAME.txt](licenses/FRAME.txt). The official hosted application is free to use. Third-party components retain their own licenses. For embedding or integration, contact [mozg4d@gmail.com](mailto:mozg4d@gmail.com).
