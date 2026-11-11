# Magneto: unfinished native authoring preview

This isolated candidate is not a release or a magnetic solver. It uses the current Frame plugin APIs for finite transformable planes, Mode buttons, signed animatable Current Density (A/mm²), and one of eight intended visualization choices. Solve Frame/Animation are disabled. All numerical endpoints reject before mutation or work. No field, force, torque, physical state, curves or calibrated material exists.

The Magneto native tag requires the shared parameter-tag bridge. Its sole field is Material, with intended names Electrical Steel M19/M27, Pure Iron, and NdFeB N35/N42/N52. These are authoring metadata only: physicsAvailable:false for every name. No permeability, remanence or other numerical constants are supplied. Reset Magnetization is absent because no persistent state exists. A non-destructive native surfaceStyle fallback gives steel/iron/magnet-family appearance only when no effective Frame Material exists. Explicit and inherited Frame materials remain authoritative and untouched.

The plane is a 100 by 100 mm local XY rectangle with +Z normal; ordinary transforms define placement and extent. Frame owns hierarchy, selection, gizmos, native animation, Undo, copy and HASH. The plugin supplies no parallel scene/UI, numerical renderer or GPU resources. Changing visualization choices stores intent only and never renders a synthetic field. Force/Torque rows and curves remain absent until real results and the shared selected-target integration exist.

## Integration

Apply only plugins/magneto/** and append magneto/plugin.json to plugins/index.json after the shared parameter-tag core bridge is integrated and tested. Do not overwrite the batch with this copied index.html or unrelated plugins. See MAGNETO-BASE.json at the root for frozen source provenance. The separate generic bridge worker owns core edits and its tests; reconcile its patch independently.

The CPU reference is preserved outside this candidate at frame-magneto-state-lab-20261109. It is not imported. Native preprocessing, verified manufacturer presets, closed-conductor cuts, divergence-free current basis, GPU near/far solving, physical remanence, adaptive visualization and chronological animation/curve integration all remain unfinished.

## Qualification

CPU descriptor tests verify fields, row layout, owner isolation, signed values, disabled/rejected physical actions, finite helper geometry and absence of a second runtime. Focused browser coverage is prepared separately. Focused hidden hardware Chromium checks passed at DPR 1 and 2, 71 checks each, with identical before/after sources and clean shared-device errors. See QUALIFICATION.md for exact evidence and corrected test-oracle failures. Full npm test/stress and large-scene qualification remain pending. This preview is not engineering validation.


## Native icon artwork

The native 32 by 32 pixel icon retains its geometry and uses solid fills #a57dbe and #cfc0d7, eight RGB levels darker than the preceding artwork. No opacity, SVG or CSS scaling is used. The shared source and raster checks are `tests/plugin-icon-alignment.mjs` and `tests/compact-icon-artwork.mjs`; native authoring behavior is unchanged.
