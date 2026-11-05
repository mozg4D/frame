# Volume kernel notices

The WebAssembly volume kernel contains portions of [Geogram](https://github.com/BrunoLevy/geogram), [Manifold](https://github.com/elalish/manifold), and [meshoptimizer](https://github.com/zeux/meshoptimizer). Source revisions and licenses are listed in [dependencies.json](../tools/volume/dependencies.json). The original license texts and Geogram third-party notices are in [licenses](licenses/).

The Geogram patches specialize deterministic intersection and nearest-face predicates for Frame's Float32 geometry. The Manifold patch exposes the numerical precision used for Float32 embedding. The meshoptimizer build changes selected simplifier computations to double precision. These modifications are part of the build under [tools/volume](../tools/volume/).

The authored kernel source and its browser loader are embedded in `index.html`. Run `tools/build-volume.ps1` with Emscripten 4.0.23, CMake, Ninja, Git and Node.js to rebuild. Build dependencies are pinned and fetched only at build time. The runtime loads the hashed WASM asset from this directory.
