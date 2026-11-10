# Bounded chronological source-history reference

`reference-animation.js` is a pure, CPU-only quasistatic history driver over the issued immutable states of `reference-solver.js`. It evaluates the same synthetic, rate-independent tanh/vector-play material laws. Time orders source changes; pulse duration does not model transient Maxwell dynamics, eddy currents, relaxation, frequency-dependent hysteresis, inertia or heating. This does not enable native Solve Animation or publish timeline curves.

## Explicit schedule API

```js
const problem = createReferenceProblem(input); // existing explicit SI fixture
const baseline = createReferenceState(problem);
const schedule = createReferenceSchedule(problem, {knots: [
  {time: 0, uniformH: [0,0,0], currentDensities: {coil: 0}},
  {time: 1, uniformH: [100,0,0], currentDensities: {coil: 2e8}},
  {time: 2, uniformH: [0,0,0], currentDensities: {coil: 0}},
]});
const result = await solveReferenceAnimation(problem, baseline, schedule, {
  signal: abortController.signal,
  solverOptions: {tolerance: 1e-10},
  animationOptions: {tolerance: 1e-3, maxEvaluations: 4096},
});
```

Imports for the first two functions come from `reference-solver.js`, and the last two from `reference-animation.js`. For fixtures with no current bases, every knot supplies `currentDensities: {}`. Each knot must specify all three uniform-H components and exactly every known signed current-basis density. SI units are inherited: H in A/m, basis amplitude in A/m squared. Finite times strictly increase; interval differences must also be finite. A single-knot schedule is supported. There is no assumed source before the first knot: the supplied baseline is the physical state immediately before that knot, whose fully specified source is solved once.

Every declared knot is a mandatory physical solution, including the peak/removal/reversal knots of an arbitrarily narrow *declared* pulse. Knots and source vectors are copied and frozen. The issued schedule belongs to the exact issued problem supplied at creation; object copies, sparse input, missing/unknown sources, nonfinite amplitudes, duplicate/reversed times and unsupported fields fail validation. The initial state must have the existing solver's issued provenance and compatible layout. Each run begins from that caller-supplied baseline. Repeating a run from the same baseline is deterministic for physical state and trace; wall time is observational.

Between knots, the source is piecewise linear in world-space uniformH and signed amplitudes of the fixed supplied current bases. Materials, weighted magnetic/current samples, transforms, geometry, basis shapes and sample layout remain fixed. Transforms cannot appear in a knot. There is no callback source, inferred event search or promise to detect an undeclared pulse. A discontinuity needs a separate source-model milestone; these knots describe continuous linear segments.

## Chronological refinement and publication

At each interval, the driver solves its endpoint once from the interval's immutable start state (coarse), solves its midpoint from that same start, then solves its endpoint from the midpoint state (two half steps). For both M and remanence, the estimator is the maximum across samples of:

- Euclidean endpoint difference between coarse and two-half-step states, divided by that sample's saturation magnetization.
- Euclidean midpoint difference from the chord between the start and coarse-end states, divided by the same saturation magnetization.

The midpoint chord check detects nonlinear reversible intermediate response even when the endpoint is independent of history. This is a local numerical indicator, not a rigorous global error bound or a calibration of the material law. Vector-play approximation errors can accumulate over many accepted intervals; use an independent convergence comparison for a particular history. The nonlinear solver tolerance must be small enough relative to the requested chronological tolerance; the driver does not certify this relationship automatically.

An accepted interval uses the midpoint and the sequential endpoint as its two chronological steps. On rejection all three trial results are discarded, the left interval is replayed from the original baseline, and the right interval begins only from the accepted left endpoint. Trials never mutate or commit their baselines, and no rejected trial becomes a physical checkpoint. The implementation retains only a bounded recursion working set and a scalar trace, rather than a physical state for every frame.

Only successful completion of *all* knots returns an immutable result: `status: 'CPU_CHRONOLOGICAL_REFERENCE_ONLY'`, the final heavy `state`, the issued `finalProblem` for the last source, `trace`, and `metrics`. The final problem retains the existing `referenceLoads` provenance contract. Trace rows contain only time, nullable knotIndex, depth, error, residual, maximum M norm and maximum remanence norm; explicit knot markers appear exactly once, in order. Heavy state arrays are absent from the trace. Metrics include physical-solve invocation count (`evaluations`), summed residual evaluations (`solverEvaluations`), accepted steps, rejected intervals, deepest refinement, maximum accepted local estimate, knot count, tolerance and wall time.

Any invalid state, cancellation, solver exception/nonconvergence, budget exhaustion or unrepresentable midpoint rejects the promise. No partial state or partial trace is attached to the error or returned to the caller, and the supplied baseline remains untouched. `ReferenceAnimationError.reason` distinguishes `EVALUATION_BUDGET`, `STEP_BUDGET`, `REFINEMENT_LIMIT`, `TIME_RESOLUTION`, `NOT_CONVERGED` and `NONFINITE_ERROR`; cancellation is `AbortError`. Validation errors retain normal TypeError/RangeError behavior. Successful subintervals are private until the full run returns; an application must publish the result only at that point.

## Bounded resource contract

| Quantity | Default | Hard maximum |
| --- | ---: | ---: |
| Explicit knots | supplied | 128 |
| Accepted physical steps, including the first knot | 1,024 | 4,096 |
| Calls to solveReference, including rejected trials | 4,096 | 16,384 |
| Recursive rejection depth | 16 | 20 |
| Calls between driver cooperative yields | 16 | 128 |

`animationOptions` accepts `tolerance` (default 1e-3, allowed 1e-10 through 0.1), `maxAcceptedSteps`, `maxEvaluations`, `maxDepth` and `yieldEvery`. Integer budgets may be tightened within the table. Each solve is independently bounded by the existing 1..4096 iteration limit and at most 24 residual backtracking trials per iteration. Consequently residual work is also bounded above by `maxEvaluations * (1 + 24 * solverMaxIterations)`; `maxEvaluations` specifically counts complete physical-solve invocations, not residual calls. The reference geometry limits remain 128 magnetic samples, 16 current bases and 2,048 current samples. Work can still be expensive near these simultaneous limits; a budget is a ceiling, not a performance guarantee.

The driver defaults the underlying solver's yieldEvery to 128 and yields to the event loop every 16 physical solves, including trivially converged solves. Explicit solverOptions can tighten yielding or supply the existing cooperative callback; the callback is not a source function. This standalone pure driver does not reuse the session-private current field cache. Each solve remains correct for its supplied amplitude; no current basis preprocessing or cache performance claim is added here.

Tests include independent scalar pulse/removal/reversal formulas, declared nanosecond-scale pulse coverage, source-order effects, self-demagnetization retention, signed current superposition, nonlinear reversible intermediate refinement, independent dense vector projection and tolerance convergence, input/provenance rejection, cancellation, injected failure, bounded termination, baseline replay and scalar-only storage. A completed dynamic vector-source history and a separate 128-knot zero-source smoke operation each have a 3,000ms fixture budget; their measured CPU time and evaluation/accepted-step counts are retained by `npm run verify`. The zero-source smoke covers knot overhead; it is not a dynamic-throughput measurement. These tests do not establish native GPU throughput or general physical accuracy.

Native source capture, dynamic geometry/cut topology, checkpoint ownership and sparse budgeting, Frame transactions, user-visible curves, GPU solving, calibrated materials and browser/hardware/aggregate qualification remain absent. Existing reference approximation and load limitations continue to apply.
