# Independent CPU numerical review

Scope: isolated LAB reference only. No native Frame integration, GPU, browser, user windows, conductor solve, production accuracy certification, Git change, or deployment was performed.

## Findings and remediation

1. Confirmed final-load overflow: a finite, converged one-sample scene could publish infinite uniform-field torque. Reproduction uses hard Ms=1000, Mr=600, chi_rev=0, Hc=1e300, chi_ir=1, volume=1e200 m^3, H=[0,1e200,0] A/m. Solver energy is zero, but m cross mu0 H overflows. Parent added final force/torque finite validation; regression now passes.
2. Confirmed missing source/state ownership: shallow frozen problem clones and copied solved states could bypass constructors; altered M above Ms could claim solved loads. Parent added issued-problem/state WeakSets; both regressions now pass.
3. Confirmed prescribed-current cache poisoning in initial integration: a caller-supplied Map could replace cached H while retaining a valid scene key and trusted solve result. The independent cache-edit regression originally changed energy from -5.965530739341202e-17 J to -7.539822368615504e-8 J with identical inputs. Parent restricted cache use to private-issued session caches; caller-owned caches are now rejected. The regression passes.

## Independent checks

The review suite adds oblique soft-sphere bisection; virgin hard-sphere pulse including self-demagnetization (analytic partial M=150 A/m), repeat and removal retention; oblique three-sample force versus energy derivatives; exactly zero internal group resultant; non-axis-aligned quaternion rotation and translation covariance of local state, forces, torques, pivot and energy; and fail-closed regressions above.

Existing suites independently cover sphere demagnetization/induction, signed hard reversal and material bounds, direct field/energy duality, pair translation/rotation derivatives, cancellation, stale-source invalidation, nonconvergence publication, lifecycle ownership, bounded CPU smoke timings and current quadrature derivatives.

The direct kernel equations are consistent with the Hessian of a Plummer-softened Green function. Material laws are explicitly phenomenological; materials.md is at workspace root. Documentation correctly avoids finite-body, measured-material and tiny-gap claims. A sphere diagonal is a separate model, not an exact finite-body interaction correction. Fixed-moment interaction energy must not be described as total nonlinear free energy. Current-source reactions and circuit energy are not supplied.

Initial complete run: 60/60 passed. After current-load algebra and first three fixes: 73/73 passed. Final complete run: 79/79 passed, zero failed/skipped/cancelled. All nine independent review tests pass. Source hashes before and after are identical; see results/numerical-review-hashes.json and results/numerical-review-final.tap. No runtime file was edited by this reviewer.

The final suite also verifies integrated prescribed-current force versus three-axis energy derivatives and signed-current force/energy reversal. No outstanding reproduced blocker remains within the bounded CPU reference scope.
