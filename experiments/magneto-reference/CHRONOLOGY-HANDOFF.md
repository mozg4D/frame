# Chronological source-history reference milestone

Starting point: the verified explicit-current reference in sibling `magneto-reference`, 111 passing CPU tests. Baseline fingerprints are retained in `../chronology-baseline-hashes.json`. This isolated copy preserves the previous deliverable. The native preview and its disabled Solve actions are unchanged.

This milestone adds chronological evaluation for explicit piecewise-linear magnetic/current source schedules with fixed geometry, using the existing phenomenological materials and bounded CPU solver. Every declared knot is a mandatory physical evaluation, so a narrow declared source pulse cannot disappear through sparse endpoint interpolation. Adaptive numerical trials use immutable baselines, and failed trials must not advance physical history. No generic source callback can certify absence of hidden pulses; unsupported source models must be rejected rather than silently sampled.

Independent physical review will use scalar play-law pulse formulas and exact source ordering, checking retained remanence, reversal, repeatability and cancellation. The numerical approximation of vector path-dependent history requires refinement checks. These tests do not calibrate the material law or qualify real magnetic damage.

No GPU, browser, native scene/UI, standard/stress/all Frame tests or GitHub publication is performed. The coordinator's coordinate gate owns the LAB GPU slot. The main chat owns shared integration and publication; this task produces a standalone baseline-relative delta and results on disk.

Remaining native work includes dynamic geometry/cut topology, robust preprocessing, GPU near/far solving, calibrated presets, checkpoint ownership and budgeting, native source/timeline capture, curves, cache invalidation and full physical/editor qualification. This isolated history driver does not enable native Solve Animation.
