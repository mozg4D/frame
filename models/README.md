# Frame stock models

Source: mozg4D/frame, commit 238944aab5a7b4aa0836297645b23005c3a2dde5 (r248), models/ and FRAME_LIBRARY_CATALOG in modules/editor.14694d2e39a34bf370f7.js.

The original HASH assets are retained as source data. GLB files contain the same positions, triangle indices and material-slot ranges, converted for the native Frame decoder. They use existing millimetre coordinates internally (the library loader passes units=1). No Three.js code is included. Car paint presets and stock parameters are native editor authoring data.
