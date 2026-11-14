# Optics

Native authoring only; no scene tracer, measured image/power, optimizer, physical material/coating catalogue or manufacturing qualification. Numerical endpoints reject OPTICS_AUTHORING_ONLY before mutation/GPU; unavailable measurements are null.

- Design Space and Subject/Sensor/Source/Target use explicit native task/receiver hash links independent of names/nesting. Planes local XY 100x100 mm at Z=0; normal +Z, U=+X/V=+Y, future propagation/reception +Z. Initial source/subject Z=-75 and receiver Z=+75 are defaults, not boundary conditions.
- Native frames define extent, no duplicate angles/size. Optical/Blocker are authoring tags; colors are not physical properties. Shared helper rendering/native fields/history/HASH. Browser selection/gizmo works; direct viewport edge picking needs a shared per-owner helper bridge and remains unavailable.
- Design Space limits geometry edits, not ray transport. Fixed optics/Blockers outside it must participate. Visibility is presentation; enabled controls future physics. Current capture excludes hidden occurrences: resolve shared-core mismatch before integration, never toggle visibility as workaround.
- status/inspect/add-plane/role creation expose authoring. No private scene/camera/renderer/device/loop/CPU mirror. experiments/optics interface laws stay unloaded, not scene qualification.

## Validation and next gates

validation/power-ledger.js evaluatePowerLedger is an unloaded compact CPU aggregate checker. Caller supplies one record/source, fixed emitted watts, explicit tolerances and disjoint useful/unwanted/absorbed/escaped/unresolved watts. Check each source and globally; unresolved stays visible, zero emission has no efficiency, never normalize bad balance. Design Space exit is not escape; receiver hits cannot double-count. Conservation alone does not certify transport/attribution/receiver coverage.

Before Solve qualify physical capture, spectral materials/coatings, closest-surface/media/Fresnel/TIR, source sampling/receiver mapping and per-source accounting with bounded-work unresolved power. Optimization must independently retrace actual shared manufacturable surfaces; E_opt is not energy, source power stays fixed. Separate direct Solve from optimization/topology research; compare representations before adopting dense full-volume methods. No universal/global-optimum claims.

Checks: node --test plugins/optics/tests/authoring.test.mjs experiments/optics/reference.test.mjs plugins/optics/tests/power-ledger.mjs; node plugins/optics/tests/index.mjs --headless. CPU laws/accounting, native authoring and scene physics are separate gates.

## Native roles and physical admission

- Role refs must target correct receiver role in same task. Moving an actively linked receiver across tasks rejects; deletion leaves a dangling diagnostic, never reconnects by name/proximity. Native copy/clipboard/merge remaps internal typed links.
- Finite Subject validates ordered depth offsets; Infinity is angular field mode hiding finite controls, not a far-away substitute. Switching back validates stored finite fields. Upright/Inverted is mapping intent, not computed image. Sensor resolution/Target goals allocate no pixel-proportional runtime arrays in authoring preview.
- Source power/wavelength and Lambertian/Collimated selection are intentions; Optical Unassigned is not a material. Missing properties must make Solve unavailable, not guess air/glass from appearance. Volume medium and surface coating R/T/A require separate provenance/wavelength/polarization contracts. Blocker absorbs surface hits, not broad-phase bounds; frame normal marker is not sensitive receiver area.
- Direct transport must cover return/repeated boundaries, open mirror versus closed transparent surfaces, holes/double-sided Blocker, TIR/dispersion and interaction-budget unresolved branches with independent analytic and seeded convergence oracles. Geometric spots are not diffraction PSFs.
- Multiple angular paths must share a physically integrable manufactured surface. Check smooth derivatives by finite differences and visibility/TIR discontinuities, including zero-useful-hit initial states; E_opt improvement requires fresh geometric retrace improving physical metrics. No silent stock-lens substitution after failed hypothesis. Expand finite LED/imaging field/depth/spectrum before claiming topology/multi-source generality.
- Useful/unwanted/absorbed/escaped/unresolved accounting is source-wise; branch is not a new source. One aggregate/source does not prove multi-receiver attribution/coverage. Keep compact ledger only, no CPU full-ray/triangle readback to feed checker.
