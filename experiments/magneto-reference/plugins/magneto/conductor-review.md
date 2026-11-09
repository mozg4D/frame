# Independent current-flow reference review

This review covers only the explicit bounded conductor graph, its scalar flux normalization and optional quadrature adapter. The implementation was written by the Astra high-reasoning worker; these eight additional tests were authored separately after reading its equations and API.

`tests/conductor-review.test.mjs` passed eight checks in an isolated CPU run:

- Three parallel branches with resistances 1, 2 and 3 plus a shared return of resistance 2: for 6 A, branch currents are 36/11, 18/11 and 12/11 A; return current is 6 A and total dissipated power is 1008/11 W.
- Feasible perturbation `(2,-3,1,0)` preserves current conservation and cut flux. Its power increase is exactly `25 t^2`, testing both stationarity and positive curvature independently of the solver's residual calculation.
- Reordering nodes/edges and reversing selected edge orientations and cut signs preserves physical currents and power.
- Multiplying every conductivity by a common factor leaves current unchanged and divides effective resistance and dissipated power by that factor.
- Dead ends and disconnected unforced loops carry zero current.
- Quadrature normalization is unchanged by source sign, reproduces current density and volume, and rejects copied or unrelated graph results.
- A separating cut has zero flux on every closed cycle and is rejected even for a zero-current request.
- A subdivided square loop passes graph flux through the current quadrature adapter and direct field evaluator. The independent exact straight-wire center result is `H_z = sqrt(2) I/(pi a)` for half-side `a`. Increasing from four to eight samples per side reduces the absolute error by more than threefold; the fine relative error is below 0.3%. Negative current reverses the field.

The square-loop check tests convergence of this small quadrature fixture. It is not evidence of arbitrary volume accuracy, dirty-mesh classification, finite cross-section resolution, tiny-gap accuracy, GPU execution or native scene integration.

Review prompted rejecting a cut spanning independent conductor components: a single global current constraint would incorrectly allow redistribution between them when the intended control is prescribed density per component. Unforced disconnected components remain valid. Use a separate active-conductor problem for each component; no automatic cut-topology extraction is supplied.

The original CPU reference's synthetic materials, regularized magnetic kernel and source-reaction limitations remain unchanged. Full verification of the final combined source set is recorded in `../../results/verification.json` relative to this plugin directory (workspace `results/verification.json`); this review's initial isolated pass is not a substitute for that exact-source report.
