# Frame

A 3D modeling workspace in your browser: build with splines and polygons, assemble scenes, and inspect print layers.

**[Launch Frame](https://mozg4d.github.io/frame/)** · [Task queue](https://mozg4d.github.io/frame/queue.html)

![Frame workspace showing a workshop campus, landscaping, vehicles, and the Objects Browser](docs/frame-screenshot.jpg)

*An actual Frame scene with 1,000 objects and approximately five million triangles.*

- Edit spline cages and polygon meshes; use parametric primitives, surface generators, and Boolean operations.
- Organize object hierarchies, shared instances, materials, and animation.
- Save native `.hash` scenes and exchange geometry through glTF/GLB, OBJ, STL, PLY, SVG, and DXF.
- Slice a fixed-width inward perimeter and inspect layers with solid or Lines–Dots previews.
- Work with desktop or touch controls; install the PWA and reopen cached application resources offline.

## Native viewport

The normal entry uses WebGPU with a shared device for display, selection, printer preview and camera output. Fresh capability checks run on startup and recovery; unsupported configurations show an error and Retry. No compatibility fallback is provided. See [r220 validation and limits](documents/R220_NATIVE_VIEWPORT.md) and [native sources](native-source/). The [r221 printer frame correction](documents/R221_PRINTER_OCCLUSION.md) keeps the frame visible over farther surfaces and hidden behind nearer ones. The [r222 editing and selection correction](documents/R222_EDITING_AND_SELECTION.md) adds detached Ctrl/Meta face copies and exact Solid corner visibility, with measured improvements and remaining heavy-scene latency. The [r223 Connected and soft cancellation correction](documents/R223_CONNECTED_AND_SOFT_CANCEL.md) reduces Connected preparation and restores frozen soft weights on cancel. Heavy partial drag and cold Solid latency remain open. The [r224 exact Solid worker preparation](documents/R224_EXACT_SOLID_WORKER.md) reduces repeated exact-worker preparation and contact work while preserving foreground visibility; heavy drag and remaining selection latency stay open.

## License

Frame’s original code and project materials are proprietary. © 2026 FRAME copyright holders. All rights reserved; see the [Frame license](licenses/FRAME.txt) for permitted uses. The official hosted application is free to use.

Third-party components remain under their own licenses and copyright notices; see [licenses/](licenses/). For embedding or integration, contact [mozg4d@gmail.com](mailto:mozg4d@gmail.com).
