# Cut

2D flat cutting and marking CAM on the shared GPU and native spline/geometry core. Best-effort execution: never rejects a dirty scene with modal errors; clips/routes around exclusions, falls back gracefully when a safe lead-in cannot fit, tints problematic objects red in the Objects Browser and exposes structured diagnostics via API.

## Coordinates, authoring and persistence

- Work plane is local XZ `[0,1000]x[0,1000]` mm, lower-left pivot `[0,0,0]`, head side `-Y`; G-code `X`/`Y` maps to physical local `X`/`Z` mm. Positive orthogonal native scale defines physical bed size (`1000*sx` by `1000*sz` mm) without scaling `Line width`, `Lead-in` or `Speed`. Sheared frames are orthogonalized best-effort with a warning and red Cut row.
- Native fields: `Mode` (`Cut`/`Mark`), `Speed` >=0.001 mm/min (default 1000), positive integer `Passes` (default 1), nonnegative `Line width` (default 0.2 mm) and `Lead-in` (default 1 mm), plus four verbatim Unicode multiline blocks (`Start G-code`, `Finish G-code`, `Tool on G-code`, `Tool off G-code`, <=16384 code units each). Never invent `M3`/`M5`/spindle commands when blocks are empty.
- `frame.cut.settings` in `localStorage` (version 1, shared HASH value storage adapter) persists technology defaults after native commits and applies only on newly created Cut owners (explicit create params, duplicate and HASH values win). Multi-owner restoration reconciles sole selected Cut, otherwise last Cut in document order.
- Tags `cut_avoid` (`Avoid`, `inherit: 'nearest'`) and `cut_no_cut` (`No-cut`, `inherit: 'nearest'`) mark exclusion geometry (planar splines or 3D meshes). Tagged exclusions never act as cut sources and receive fallback `surfaceStyle` tinting when no explicit native Frame Material exists.

## Source capture, kerf, exclusions, routing and G-code

- Captures visible non-consumed splines (`spline`, `square`, `circle`, `polyhedron`, `text`, `helix`, `gear`, `pulley`, spline `boolean`), spline replicas (`Instance`/`Cloner`/`Symmetry`), and untagged `Extrude` profiles via `context.core` (`FrameSpline` + `frameEngine`). Uses the user's existing spline approximation directly without adding extra curve tessellation.
- Closed loops (both `Cut` and `Mark`) are always normalized **CW** viewed from head side `-Y` (`signedArea2D < 0` in `(X, Z)`) for consistent backlash loading.
- Closed `Cut` loops with `Line width > 0` compute waste-side half-width compensation (`+w/2` outer, `-w/2` hole via even-odd nesting depth) through the shared non-mutating `FrameGeometry.worker('outline', ...)` bridge. `Mark` and open `Cut` paths stay uncompensated.
- `Avoid` blocks head entry/travel; `No-cut` allows tool-off travel while protecting active swept width `Line width / 2`. Active cuts crossing bed bounds, `Avoid` or `No-cut` are clipped analytically into surviving CW open chains (merging wrap-around seams) rather than failing. Tool-off travel routes around `Avoid` polygons inside `[0, W] x [0, H]` via a 2D visibility graph + A*.
- Closed `Cut` loops with `Lead-in > 0` select a waste-side tangent arc (start distance = `Lead-in`) with clear best-effort fallbacks (45-degree arc, angled/perpendicular/short/direct entry) so generation never fails on tight geometry.
- Route optimization enforces inner-before-outer precedence (all holes, islands and interior cuts finish all `Passes` before the enclosing outer part is released), using dependency-aware nearest neighbor, precedence-preserving Or-opt + 2-opt local search, and closed-loop entry-point coordinate descent over actual `Avoid`-routed travel distances.
- Emits pure absolute metric **`G0`/`G1`** only (no `G2`/`G3`), preserving verbatim `Start`/`Finish`/`Tool on`/`Tool off` blocks. Closed unbroken loops run all `Passes` continuously after one `Lead-in`; open or bridged chains return tool-off between passes.
- Revision-fenced async `generate` jobs are cancellable (`cancel` terminates active Outline worker sessions) and invalidate on Cut-relative geometry, parameter or tag changes while surviving common rigid assembly motion, camera navigation and cursor scrubbing.

## Preview, scrubbing and operations

- Operations: `status`, `generate`, `cancel`, `sources`, `result`, `position` (transient `line` cursor), `save` (downloads `.gcode` for current nonempty completed result).
- Attributes exposes `Generate` (turns into `Stop` while running, shows time lower-bound when complete), `Save G-code` (hidden until a nonempty result exists), transient `G-code position` integer scrubber (`0..lineCount` via `attributes().numbers`, never touching Undo/HASH), and compact `Time` / `Length (mm)` / `Lines` readouts.
- GPU preview renders local X/Z axes plus all travel/lead-in/cut/mark segments and the live head crosshair/diamond marker from one static path vertex buffer per owner, updating cursor progress and head position via `frame.settings` uniform with zero buffer uploads during scrubbing.

Checks: `node plugins/cut/tests/model.mjs`, `node plugins/cut/tests/linear-paths.mjs`, `node plugins/cut/tests/linear-regions.mjs`, `node plugins/cut/tests/planner.mjs`, `node plugins/cut/tests/browser.mjs --headless`.
