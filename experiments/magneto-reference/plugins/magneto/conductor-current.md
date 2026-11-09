# Bounded explicit conductor graph oracle

`conductor-current.js` solves a supplied closed network of oriented resistive flux tubes. It is an independent CPU numerical reference, limited to 32 nodes and 64 edges. It does not read Frame data, generate a graph from polygons, classify a native plane cut, allocate GPU resources, or enable native Solve. It establishes discrete Kirchhoff conservation and minimum Joule dissipation for the supplied model, not a continuum finite-volume convergence result.

## Input and API

`createConductorGraph({units:'SI', nodes, edges, cut})` validates, copies and freezes a graph. Nodes are unique string identifiers. An edge has `id`, `from`, `to`, positive `length` in m, `area` in m², and `conductivity` in S/m. Every edge joins two distinct known nodes. Parallel edges are supported; self loops, unknown properties, sparse arrays, external terminals and boundary-outflow fields are rejected. No supplied node injects or removes current. Isolated nodes, dead-end branches, attached unforced cycles and inactive disconnected components are allowed.

Conductivity is explicit reference-fixture data, not a guessed copper/aluminium preset or a new native UI parameter. For a homogeneous geometry-normalized basis, choosing the same positive conductivity on every edge changes power and resistance but leaves normalized current unchanged. The graph model permits different conductivities only when the caller supplies them.

`cut:{edges:[{edgeId, sign}]}` names unique edges with signs +1 or -1 relative to edge orientation. The caller asserts that these are disjoint transverse portions of the intended cut, with area equal to each edge's cross section. The cut area is their sum. There is no oblique-face reconstruction or spatial verification. Repeated crossings of a cycle count algebraically; a cycle crossing twice positively contributes twice its circulating current. This is explicit discrete cut semantics, not automatic detection of a physical section. Cuts spanning multiple connected components are rejected: solve each active conductor separately. A cut that cannot carry nonzero divergence-free flux is rejected even for a zero-amplitude solve.

`solveConductorCurrent(graph, {current: I})` uses signed total cut current I in A, defaulting to 1 A. The result contains edge-order `unitFlux` (current per unit cut current), `flux` in A, scalar oriented `currentDensity` in A/m², node-order signed `divergence` in A, `cutArea`, `averageCurrentDensity`, `effectiveResistance` in ohms, `dissipatedPower` in W and numerical/timing metrics. Solutions and nested arrays are frozen; forged or copied graph handles are rejected. A solution is associated with the exact graph that issued it.

## Derivation and numerical checks

Let B be the incidence matrix, with -1 at each edge's source and +1 at its destination. Let f be oriented edge currents, R the positive diagonal resistance matrix with R_e = length_e / (conductivity_e area_e), and c the signed cut vector. The problem is

    minimize (1/2) fᵀ R f, subject to B f = 0 and cᵀ f = I.

The objective is half the dissipated power; it is not magnetic energy. Integrating the reported power over a specified duration would give dissipated energy in J. There is no duration, thermal evolution, induced eddy-current or circuit-voltage model here. Imposing circulation assumes an external source supplies the necessary electromotive work.

A spanning forest gives independent fundamental cycle columns Z with integer entries -1, 0, +1 and BZ = 0. With f = Za, define H = ZᵀRZ and d = Zᵀc. Positive edge resistances make H positive definite. If d is zero, every closed flow has zero signed cut flux: the cut is impossible. Otherwise

    x = H⁻¹ d
    a = I x / (dᵀ x).

This is the unique minimum: any feasible perturbation δf has Bδf = 0 and cᵀδf = 0; stationarity eliminates the cross term and power increases by δfᵀRδf. Tree branches carry zero current. Unforced cycles and disconnected components also carry zero at the minimum. A separating boundary cut necessarily has zero flux by conservation; a circulating conductor needs a nonseparating cut functional.

The implementation normalizes resistance by its maximum, uses Cholesky without an explicit inverse, and checks signed cut normalization, Kirchhoff conservation and projected stationarity before returning. Resistance ratios below 1e-12 and Cholesky pivots at or below 1e-13 of the maximum diagonal fail closed. Residual limit is 2e-10; it is an internal bounded-oracle check, not a user quality parameter or forward-error guarantee. Some highly contrasted graphs inside the ratio bound may still be rejected. Logarithmic positive products avoid intermediate overflow; nonfinite, overflowing or underflowing required physical outputs are errors. A timing measures a completed synchronous solve, not kernel submission or GPU performance.

## Average current density and optional quadrature

The discrete cut-average density is Jbar = I / Acut. Thus prescribing signed average Jbar means calling the solve with I = Jbar Acut after checking representability. At edge e, J_e = f_e / A_e along the oriented tube. The sum of signed J_e A_e over cut entries equals I. A single integrated constraint does **not** prescribe a uniform pointwise J on every cut portion. Nonuniform branch current distributions are a model choice; this is not proof that the original native signed-current-density boundary condition has been implemented for arbitrary solids.

To request quadrature, supply each edge's explicit object-local `localPosition` (m) and unit `direction` from `from` to `to`. These are paired optional fields. `toReferenceCurrentBasis(graph, solution, {id, objectId})` requires both on every edge and returns the existing reference-solver `currentBases` shape:

    density = I / Acut                       // A/m²
    sample.basisDensity = direction * Acut * unitFlux_e / A_e
    sample.volume = A_e * length_e           // m³

Consequently `density * basisDensity` is J_e and its volume integral is f_e length_e direction. The normalized basis remains defined when I = 0. The sample id is the edge id; one object owns the entire basis. This adapter is optional, validates representability, and performs no session or native-scene integration.

One point per supplied straight tube is a coarse midpoint quadrature. The caller must supply consistent tube geometry and midpoint positions; the graph has no node coordinates with which to verify endpoint closure, junction shape, tube overlap or segment direction. Graph conservation does not establish pointwise divergence-free quadrature, exact near fields, finite-body accuracy or source-reaction loads. The downstream regularized current kernel retains all its existing limitations.

## Verification and remaining boundaries

`conductor-current.test.mjs` contains 23 cases: independent series-loop and parallel-path formulas; constrained energy curvature; sign, area, size and conductivity scaling; orientation/order invariance; topology failures; inactive components; strict scale and ownership failures; quadrature dimensional identities; and 12 completed maximum-capacity solves with timing and a 3-second CPU smoke budget. `conductor-review.test.mjs` adds 8 independently authored checks, including three-branch power/optimality, invariance, scaling, ownership, impossible cuts and graph-to-quadrature magnetic field refinement against the exact finite-wire square-loop formula. See conductor-review.md. Existing magnetic/lifecycle suites are retained.

Native orientation-independent polygon/LDI preprocessing, native cut-to-volume topology, arbitrary conductor basis construction and caching, GPU solve, magnetic coupling, conductor force/reaction, pointwise boundary equivalence, mesh convergence and tiny-gap qualification remain unimplemented or unqualified here. The separate native authoring preview already exists in main with Solve disabled; these CPU tests do not change that status.
