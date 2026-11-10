# Independent chronological physics review

The seven tests in `tests/chronology-review.test.mjs` were authored separately from the animation driver. They use its public issued-problem/schedule API and the existing reference solver; expected material transitions are calculated independently.

- Scalar prefixes: project the prior remanence onto `[H-Hc,H+Hc]`, then the remanence saturation interval. Positive, removed, reversed and removed source sequences agree at every requested prefix.
- Uniform sphere: a reverse field of -800 A/m acting on initial 600 A/m remanence gives `M=-800-M/3+1000`, hence 150 A/m. Removing the source retains 150 A/m and leaves self-field -50 A/m.
- A declared 2 ns pulse retains 200 A/m, agreeing with the same source path widened in time. This tests mandatory knot handling in a rate-independent quasistatic model, not transient electromagnetic pulse duration.
- Reversing the order of positive/negative pulses changes final memory. Repeating the same schedule from the same immutable baseline gives identical remanence and does not alter that baseline.
- Final problem/state provenance is coherent with the existing selected-owner load interface.
- Pre-cancellation rejects without exposing a partial result or mutating the baseline; a subsequent valid run retains the expected state.
- An oblique triangular source path is independently integrated using 4096 projection substeps per segment. Adaptive history at tolerance 1e-5 agrees within 3 A/m, rejects/refines intervals, preserves strict chronological trace order, visits every explicit knot exactly once, and stores scalar trace values only.

For mathematical comparisons, the tests use the existing solver's microtask yielding option to avoid timer overhead; the history driver retains its cooperative macrotask cancellation checks. Those checks are not operation latency benchmarks. The separate implementation smoke test exercises the driver's default scheduling and records completed-operation time and a fixed budget.

The projection law is the existing synthetic vector-play reference law. These checks do not establish manufacturer hysteresis, dynamic relaxation, arbitrary hidden events, native timeline capture, scene integration, physical source reaction or production Solve Animation. Adaptive tolerance is a local estimator; cumulative global history error is not certified. Final exact-source combined results are in workspace `results/verification.json` and `results/final-tests.tap`.
