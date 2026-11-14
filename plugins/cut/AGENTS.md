# Cut

Runtime authoring only. Generate disabled; generate/sources/result/save reject CUT_AUTHORING_ONLY. No machine connection, valid sequence, G-code position or Save UI.

- Work plane local XZ [0,1000]x[0,1000] mm; lower-left pivot, head side -Y; future program X/Y maps X/Z. Native frame owns placement/size.
- Native fields: Cut/Mark, Speed >=0.001 mm/min, positive integer Passes, nonnegative Line width/Lead-in, four multiline machine blocks. Defaults 1000 mm/min, 1 pass, 0.2 mm, 1 mm. Preserve opaque Unicode blocks exactly; invent no safe M commands/interpretation.
- Avoid (cut_avoid) and No-cut (cut_no_cut) are fieldless metadata, not enforced runtime protection. Intended Avoid blocks head-reference travel; No-cut permits tool-off travel but protects full active swept width.
- frame.cut.settings localStorage version 1 retains technology defaults after native commits. Reconcile sole selected Cut, otherwise last native document-array Cut. Storage failure must not roll back scene. textFields/fieldOptions own literal fields/CAS.
- Helper axes use renderKind helper. Diagnostics stay in API; only actual generation errors may eventually color owner red.

## Unloaded geometry

- tests/linear-paths.js prepareLinearPaths accepts supplied world-mm polylines, unit orthogonal rigid X/Z basis and physically scaled area. Open Cut/Mark/simple closed Mark only; closed Cut/curves/regions/tags/leads reject. Validate complete input/planarity/rectangle/topology/precision first. Immutable intervals expand tool-on/work-line/tool-off in source/pass order; no travel joins/compensation/output.
- Caps: 128 sources, 16384 vertices, 512/closed source, 131072 events, coordinates <=1e9 mm. Working tolerance 1e-6 mm; edges <=4e-6 reject. Closed Mark clockwise from head side. Centerline bounds do not certify swept width; travelPlanned/machineReady remain false.
- tests/linear-regions.js validateLinearRegions separately checks supplied local lines against simple Avoid/No-cut polygons with holes. Avoid checks entire head-reference segment in any state; active No-cut checks radius width/2 including end/dwell disks. Tangency/uncertain contact rejects conservatively; no splitting/routing.
- Region caps: 64 regions, 128 rings, 256 vertices/ring, 4096 total vertices and 4096 motions, 2000000 pair-work units; tolerance 1e-6 mm. Shared predicates tests/linear-geometry.js. Region validity does not qualify connectivity/area/placement/leads/machine readiness. Neither module is runtime-imported.

## Required integration

First qualify native planar source/profile capture, instances/consumption/freshness and physical frames. Reuse FrameGeometryKernel Outline through a non-mutating cancellable bridge; editor Outline is not a CAM service. No private offset implementation.

Closed Cut needs half-width waste-side compensation, holes/all passes before outer release, safe tangent lead-ins (Lead-in is distance from source, not radius). Mark/open Cut stay uncompensated. Enforce actual regions/swept widths on cuts/arcs/travel, safe bridge restarts and deterministic route improvements without global-optimum claims. Then revision-fenced cancellable jobs and one sequence for preview/time/export. Define machine dialect/modal/opaque-block effects; cursor is exact saved line number. Save requires current nonempty atomic result.

Checks: node plugins/cut/tests/model.mjs; node plugins/cut/tests/linear-paths.mjs; node plugins/cut/tests/linear-regions.mjs. tests/index.mjs supplies native authoring gate. Independent analytic/random CPU oracles and latency budgets do not qualify runtime CAM.

## Integration details that must not be inferred

- Technology defaults apply only in native created hook; explicit API params/duplicate/HASH values win. Scenes with no Cut retain prior profile. Position/dimensions/results are never technology defaults. Individual changed owner updates defaults regardless of selection; multi-owner restoration uses deterministic selected/last-owner reconciliation. On storage failure retain in-session settings and report defaults.storageAvailable.
- Machine blocks are literal <=16384 UTF-16 units each; API/HASH preserves string exactly, native textarea uses browser newline normalization. Future schema changes must not erase unknown blocks. cancel with no runtime job returns cancelled:false/job:null, never fake cancelled work.
- Linear frame is rigid unit basis with <=1e-12 admitted roundoff; positive native scale belongs in physical area/source world points, not basis vectors. Reflected/skewed owner needs explicit physical head-side adapter, not inverse scaled coordinates. Projection arithmetic rejects if 16 times guarded error exceeds 1e-6 mm or planarity tolerance. Closed source omits repeated endpoint. No clipping/welding/repair/drop of failing source; all inputs preflight before output.
- Work interval length excludes travel/time; open repeated passes require tool-off return travel that is not present in output. Separate sources are not mutually classified for nesting/collision. Nonempty region inputs still reject in linear-paths even though companion validator exists; do not assume implicit protection.
- Region checker validates all rings/topology/precision/capacity before constructing results. Holes must be strictly interior/disjoint/nonnested/no touching. Avoid applies even at zero-length tool-off dwell; No-cut uses active full width/2 disk including endpoints/dwell, tangency rejects. Filled-region containment counts even without edge crossing. Per-motion diagnostic prefers first Avoid, otherwise first active No-cut. Valid region output does not prove work-area or route safety.
- Native capture must discover actual spline/Extrude profiles through instances/groups/consumption/visibility, not arbitrary tilted silhouettes or bounding boxes. No tagged exclusion may also cut. Shared Outline nonmutating bridge must preserve source freshness/cubic approximation/topology limits; existing editor mutation is not a cancellable pure planner.
- Lead-in is start distance from contour; choose entry/tangent arc jointly with kerf/neighbours/bounds. No automatic lead-out/common cut/bridge between unrelated contours or height bypass. No-cut bridges disable tool on every pass, require safe restart or explicit inability. Hole/all-pass completion precedes outer part release.
- Revision-fenced jobs capture scalar stamp plus qualified geometry, recheck every await and publish atomic nonempty output. Camera navigation/preview cursor must not invalidate physical fingerprint; don't regenerate each gizmo step. Time derives only from recognized motion/dwell; unknown macro duration stays unknown. G-code cursor counts exact saved lines including blanks/comments/blocks; scrubbing never rebuilds geometry.
