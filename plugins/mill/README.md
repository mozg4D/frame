# Mill

Mill plans a fixed-axis three-axis job on Frame's shared WebGPU device. Default Slice builds sequential roughing, contours and nonplanar finishing, verifies continuous cutter sweeps, replays material removal and publishes one immutable stream for display, Progress, time and LinuxCNC G-code. A completed job reports complete and machiningReady:true: a program in the documented model, not universal certification of arbitrary source topology or machine setup.

## Native scene and coordinates

CNC is an ordinary plugin object. Its local box is X/Y [-50,50], Z [-100,0]; its default pivot/home is the upper near-left corner (-50,-50,0). Native transforms, hierarchy, enabled/visible state, Undo/Redo and HASH apply normally. CNC can live beneath a part/assembly. Positive orthogonal scale changes physical box dimensions; cutter, feed, tolerance and clearance parameters remain physical millimetres.

Stock and Protected are ordinary inherited scene tags, independent of CNC parenting. Stock supplies material; Protected supplies forbidden geometry. A dual-tagged occurrence participates in both. Evaluated geometry with neither tag is Target. Non-CNC children of CNC have no implicit protected role. A root collects CNC descendants in actual Scene Tree preorder through intervening ordinary nodes. Green skips only that operation without hiding helpers/descendants. A disabled root still supplies coordinates and lifecycle text for enabled descendants.

Arbitrary rigid world orientation/translation and positive nonuniform orthogonal scale are supported. Skew, reflection, degeneracy and a directed child tool axis differing from the root by more than 1e-9 in unit-vector distance are red/ignored. Native editing is unrestricted. In-plane child rotations are supported; indexed/re-fixtured jobs need a different physical model.

## Tools and planning

Flat, Ball and V are analytic radial epigraphs extending upward indefinitely. V Angle is the included angle. No holder/flute/stick-out parameters exist. Step Down is a maximum pass depth, not cutter length. Signed Spindle selects M3/M4; cutting requires nonzero RPM.

GPU triangle clipping builds conservative top envelopes for initial/current Stock, Target and Protected. Thin features and degenerate projected edges survive between ray centers. Source triangles are never mirrored to CPU. Bounded field tiles/max-min pyramids may be read for planning. Appended generated sweeps update these derived fields in Float64 using the same analytic cutter functions. Evicted/new tiles reconstruct preceding history from native GPU source and sweeps. Actual XYZ interval subtraction and retained virtual stock remain GPU-owned.

Roughing distributes depth/row spacing evenly within Step Down/Step Over. Ball/V depth and row budgets account for their profiles. Configuration-space bands generate clearing and obstacle/island contours. Finishing refines surface heights and full swept chords; row spacing is additionally limited by Tolerance/scallop. Remaining reachable stock samples trigger up to three local refinement passes; unresolved samples fail publication. Accessibility-limited residual candidates remain explicit. This finite inspection does not prove every inaccessible volume.

Current contact side and signed RPM choose climb direction for one-sided cuts. Full-slot/conservative/ambiguous contact is labelled explicitly. Continuation is preferred; otherwise entries use cumulative-XY ramps, validated helices or bounded pecks, with constant-depth cleanup. Endpoints are quantized before verification. Feed is capped by Feed and the actual absolute vertical Plunge component, including rotated operation frames.

Transitions test direct Safe Dist sweeps, then find the minimum verified lift in the available upper plane. A blocked straight line can use a bounded A* XY visibility graph around conservative source bounds. Every edge checks the full continuous cutter against current material and Protected. The upper plane and destination descent are validated, never assumed safe. Controlled feed retracts use the already-cleared pose; G0 cannot inherit that exemption.

Actual root-physical tool position and material history carry across operations. Same-tool operations add no tool change/home return. Different tools retract safely, verify both tool envelopes, stop, execute a mandatory manual pause block, install the new tool and restart signed RPM. The generated final lifecycle returns to root home once, stops and ends the program.

## Stock, tolerance and limits

Canonical stock is borrowed original GPU source plus ordered analytic cuts. Shared Stock/Protected include all geometry outside every CNC box. Each operation freezes stock after preceding operations, forbids removal outside its physical box and advances the shared revision only for actual cut events. It never restarts from virgin stock.

XYZ import independently embeds Printer's geometric crossing cleanup, connected shells, interpenetrating-shell union, nested even-odd and occurrence union policy. All axes share labels. Stored normals are ignored. Raw geometry/events/depths remain GPU-owned. A nonempty import reads 56 metadata bytes, plus optional retained GPU shell labels. Subtraction uses analytic linear sweeps in 32-motion exact-allocation GPU batches, reading 16 allocation bytes per batch. An inner numerical envelope prevents rounding from removing unverified extra material.

The full-domain dense snapshot is a sampled display LOD, limited in extent to approximately 256 cells per axis independently of machining Tolerance. Coarsening is explicitly labelled. Fine lazy 32-cubed XYZ tiles use Tolerance/(8 sqrt(3)), inherit canonical shell labels, reconstruct source plus selected cuts and use a bounded 64 MiB/128-tile LRU. Their sampleCellDiagonal is not a certified source-error bound.

Planning cell diagonal is at most Tolerance/8, further refined for small/sharp tools. Path allowance is Tolerance/8; adaptive height variation and shape scallop each use Tolerance/8, finishing rows at most Tolerance/2, and controller quantum at most Tolerance/64. Source/sweep Float32 envelopes have explicit guards and fail NUMERIC_LIMIT when exceeded. These algorithmic budgets are not a certificate for malformed interiors, missed sub-sample topology or every finished surface. accuracy.sourceAccuracyCertified remains false. Machining precision is never silently weakened to fit capacity.

Actual source surfaces retain native assigned/inherited materials, polygon masks and UVs. A generated-motion BVH filters removed fragments before native shading. Compact GPU cut-endpoint patches show new surfaces at display resolution; paths and a visual cutter share the same stream. Finite display height does not limit the infinite collision model. Wire/cage/component editing still addresses original sources. The most recently completed/seeked root supplies shared Stock presentation. Hiding that root restores normal source presentation; showing it restores the derived result. Protected fallback stays red/topmost; user materials take precedence. No alternate mesh scene or renderer is created.

Dense diagnostics retain limits of 2048 cells/axis and 4194304 XYZ rays. Imports allow 256 occurrences/role, 1024 raw hits/ray and 16777216 raw events, bounded by device bindings. Planning allows 200000 events, 100000 distributed passes, 8192 tiles/query and 48 detour source boxes. Replay has eight checkpoints/64 MiB; fine tiles 64 MiB; cut presentation 2097152 patches. Capacity failure retires results instead of exporting partial paths. Nonempty Stock with balanced sampled crossings is required; empty/ambiguous Stock is diagnostic-only. Open Target/Protected surfaces are conservatively preserved. General broken/open solid interiors cannot be universally recovered.

## Progress and time

Only full success publishes N and sets root Progress=N. Progress covers all stream events, including tool/spindle/pause/modal events, and changes derived display only. Backward/random seeks restore immutable source or a bounded checkpoint and replay exactly the selected cut prefix. New seeks supersede older requests. Source/settings/relative-frame changes, cancellation, deletion, HASH/scene replacement and device changes retire derived resources. Common rigid assembly motion reuses physical results. HASH stores authoring, not GPU jobs; reopened Progress resets to zero.

Slice shows --:--:-- until completion, then a lower-bound time marked with a greater-than-or-equal sign. Feed/dwell time comes from the exact exported stream. Controller S/P values are quantized before recording (0.001 RPM / 0.000001 s); positive values below that precision are rejected. The displayed lower bound rounds down to whole seconds. Controller rapid speed, acceleration/deceleration and manual pause duration are unknown and listed separately. No artificial rapid-speed field is added. Export G-code is enabled only for complete results. Physical/text defaults use localStorage frame.mill.defaults.v1, excluding Progress. Parameters validate before mutation; failures stay in status without a standing diagnostics panel.

## G-code contract

LinuxCNC RS274 uses metric absolute XYZ in G54, XY plane, units/min feed and G61 exact-path mode. Root physical coordinates must already be configured G54 coordinates. Start at root home with the first tool installed and no G92 offset. Every manually changed tool must be preset to the same calibrated effective tip offset already active at program start. M0 does not provide an MDI touch-off session; no unverified offset change is inferred. The program establishes G21 G90 G17 G94 G40 G80 G61 G54 and M5 S0. It invents no machine-specific offset or homing macro.

Start G-code executes once. Tool Change defaults to M5 then M0 and must contain mandatory M0; M1 alone is insufficient, and the spindle must be stopped at each mandatory tool-change pause. Accepted custom state: finite metric/absolute G0/G1, G4 P seconds, G17/G21/G40/G54/G61/G80/G90/G94, F/S, M0/M1/M3/M4/M5/M7/M8/M9 and comments/line numbers. Every custom motion enters the common verifier/stream. G1 custom positioning must be clear air; it cannot silently cut. Feed/Plunge maxima apply. G80 clears the remembered motion mode; subsequent axes need explicit G0/G1. S alone does not start a stopped spindle; M5 retains commanded S.

Relative/inch modes, arcs, offsets, G28/G53/G92, G43, G64, M6, macros and custom termination are rejected until a machine-specific state model exists. Finish is generated once: verified home, M5, M30. Primary contracts: [LinuxCNC G-code](https://linuxcnc.org/docs/stable/html/gcode/g-code.html) and [M-code](https://linuxcnc.org/docs/stable/html/gcode/m-code.html).

## AI operations

Discover plugins.describe {plugin:"mill"}; invoke plugins.command {id,operation,args}. Native create/transform/tag/history/HASH remain authoring paths.

| Operation | Contract |
| --- | --- |
| settings | Validated physical/text fields or root integer Progress; native Undo/defaults; API waits for seek. |
| status | Eligibility/preorder, stage/state, current/requested/N, actual revision, transforms/planning/contours/residuals, time uncertainty and GPU accounting. retainedGPUBytes counts actual owned buffers; peakGPUBytes is an aggregate estimate and excludes driver/compiler allocations. |
| slice | Root-only complete CAM. geometryOnly:true explicitly builds sampled diagnostics, geometry-ready/machiningReady:false. |
| cancel | Cancel active work without partial publication. |
| paths | Immutable events in root physical mm; offset/count, at most 256. |
| gcode | Program character page, at most 65536, plus dialect/setup/time contract. |
| export | Download complete verified .ngc via the minimal native action. |
| inspect | X/Y/Z interval pages, at most 256 rays and 4096 intervals. |

inspect defaults to current sampled shared Stock in root physical coordinates. Protected is shared; Target is local to an enabled valid operation. Child requests explicitly label root space/job scope for shared material. point:[x,y,z] selects a fine root-physical Stock/Protected tile after complete CAM. Count/offset paginate that tile's grid. Inspection revalidates source identity and returns no GPU resources/CPU triangle mirror.

## Verification

node plugins/mill/tests/run.mjs --headless runs hardware WebGPU checks. Standard/stress discover all numerical and machining modules through tests/index.mjs. Coverage includes authoring/materials/history/HASH, full external stock, transforms, independent convex cutter oracles, GPU sweeps/XYZ cavities, thin envelopes, sparse replay/eviction, Flat/Ball/V nonplanar deviation, signed RPM, quantized ramp angles, pecks, sequential/manual changes, blocked-plane detours, unsafe custom state, independent exported G-code replay, random/native Progress and completed-operation/CPU/GPU frame budgets.

npm run test:mill:performance -- --headless checks unchanged 100548288-triangle source residency and native fallback presentation. Full npm test and DPR-2 npm run test:stress are required before publication. Reports bind exact runtime/plugin hashes; historical foundation results do not validate newer code.

## Verified release (2026 29 oct 17:46)

Standard and DPR-2 stress each passed 6459 assertions, including 245 Mill checks, on hardware nvidia turing. Neither run reported JavaScript/console/WebGPU errors, device loss or device replacement. The separate unchanged 100548288-triangle presentation benchmark passed 15 checks, including a 512-sweep fragment mask; canonical source residency stayed unchanged. Its machined-mode p95 was 0.900 ms CPU / 13.009 ms GPU. These are local fixture/device measurements, not universal throughput or geometry certificates.

Source-bound reports are tests/results/mill-standard.json, mill-stress.json, mill.json and mill-performance.json. The tested index SHA-256 is 8ad1b4e3e9e3f234ec778c36fab8e07810e3348f4db9021fd4fa20e9a91ad49c; Mill plugin SHA-256 is 32f011056b8c11b7b72afabab9cc45af3afdb39bae46ba4a496201d1900fdddc.
