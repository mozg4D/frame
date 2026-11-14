# Cut

Runtime authoring only. Generate disabled; generate/sources/result/save reject CUT_AUTHORING_ONLY. No machine connection, valid sequence, G-code position or Save UI.

- Work plane local XZ [0,1000]x[0,1000] mm; lower-left pivot, head side -Y; future program X/Y maps X/Z. Native frame owns placement/size.
- Native fields: Cut/Mark, Speed >=0.001 mm/min, positive integer Passes, nonnegative Line width/Lead-in, four multiline machine blocks. Defaults 1000 mm/min, 1 pass, 0.2 mm, 1 mm. Preserve opaque Unicode blocks exactly; invent no safe M commands/interpretation.
- Avoid (cut_avoid) and No-cut (cut_no_cut) are fieldless metadata, not enforced runtime protection. Intended Avoid blocks head-reference travel; No-cut permits tool-off travel but protects full active swept width.
- frame.cut.settings localStorage version 1 retains technology defaults after native commits. Reconcile sole selected Cut, otherwise last native document-array Cut. Storage failure must not roll back scene. textFields/fieldOptions own literal fields/CAS.
- Helper axes use renderKind helper. Diagnostics stay in API; only actual generation errors may eventually color owner red.

## Unloaded geometry

- linear-paths.js prepareLinearPaths accepts supplied world-mm polylines, unit orthogonal rigid X/Z basis and physically scaled area. Open Cut/Mark/simple closed Mark only; closed Cut/curves/regions/tags/leads reject. Validate complete input/planarity/rectangle/topology/precision first. Immutable intervals expand tool-on/work-line/tool-off in source/pass order; no travel joins/compensation/output.
- Caps: 128 sources, 16384 vertices, 512/closed source, 131072 events, coordinates <=1e9 mm. Working tolerance 1e-6 mm; edges <=4e-6 reject. Closed Mark clockwise from head side. Centerline bounds do not certify swept width; travelPlanned/machineReady remain false.
- linear-regions.js validateLinearRegions separately checks supplied local lines against simple Avoid/No-cut polygons with holes. Avoid checks entire head-reference segment in any state; active No-cut checks radius width/2 including end/dwell disks. Tangency/uncertain contact rejects conservatively; no splitting/routing.
- Region caps: 64 regions, 128 rings, 256 vertices/ring, 4096 total vertices and 4096 motions, 2000000 pair-work units; tolerance 1e-6 mm. Shared predicates linear-geometry.js. Region validity does not qualify connectivity/area/placement/leads/machine readiness. Neither module is runtime-imported.

## Required integration

First qualify native planar source/profile capture, instances/consumption/freshness and physical frames. Reuse FrameGeometryKernel Outline through a non-mutating cancellable bridge; editor Outline is not a CAM service. No private offset implementation.

Closed Cut needs half-width waste-side compensation, holes/all passes before outer release, safe tangent lead-ins (Lead-in is distance from source, not radius). Mark/open Cut stay uncompensated. Enforce actual regions/swept widths on cuts/arcs/travel, safe bridge restarts and deterministic route improvements without global-optimum claims. Then revision-fenced cancellable jobs and one sequence for preview/time/export. Define machine dialect/modal/opaque-block effects; cursor is exact saved line number. Save requires current nonempty atomic result.

Checks: node plugins/cut/tests/model.mjs; node plugins/cut/tests/linear-paths.mjs; node plugins/cut/tests/linear-regions.mjs. tests/index.mjs supplies native authoring gate. Independent analytic/random CPU oracles and latency budgets do not qualify runtime CAM.
