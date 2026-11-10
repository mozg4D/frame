# Independent finite-body field review

The six tests in `tests/finite-body-review.test.mjs` were authored separately from `finite-body.js`. The main comparison implements the magnetic surface-charge integral with tensor Gauss-Legendre quadrature, without using the implementation's solid-angle, inverse-hyperbolic or corner formulas. The charge formulation is described in [Magpylib's primary documentation](https://magpylib.readthedocs.io/en/5.2.0/_pages/user_guide/examples/examples_misc_equivalent.html). The quadrature and integration code are original test code.

1. Oblique three-component magnetization: independent order-32 and order-48 face integration agree to 3e-7 A/m at four safe interior/exterior observations, and the analytic implementation agrees to the same absolute tolerance. Interior induction adds local material M; exterior induction does not.
2. Aspect-10 prism: each central demagnetizing coefficient agrees with separate order-128 quadrature within 2e-5 A/m at 900 A/m magnetization. The three coefficients sum to one. The long-axis center coefficient is below 0.01 rather than the equivalent-sphere 1/3. This demonstrates an existing reference approximation's limitation; it is not a volume-averaged demagnetization factor or a new nonlinear solution.
3. Translation and arbitrary-axis rotation agree with an independently coded Rodrigues transform for both H and B.
4. Opposite limits of a face-interior point reproduce the expected normal-H jump by normal M, tangential-H continuity and normal-B continuity within the finite-offset tolerances.
5. Two explicitly supplied uniformly magnetized cubes retain a finite exterior field at the center of gaps shrinking from 1e-2 to 1e-6 m. This tests the finite-volume point-field formula only. It does not validate native geometry preprocessing, magnetic sample refinement, volume-averaged coupling or a general tiny-gap solver.

6. Central finite differences at safe interior/exterior points obey divergence-free B and curl-free H within the stated truncation tolerance.

Initial isolated run: 6/6 pass, about 245 ms including the separate quadratures. Final combined exact-source evidence belongs to `results/verification.json` and `results/finite-body-report.json` in the candidate root. Timing is local CPU evidence, not a hardware-independent latency promise.

This review found no reproduced defect in the tested field domain. The prescribed M is uniform and fixed: no claim is made about self-consistent nonuniform magnetization, calibrated materials, induced soft-material response, energy/force derivatives, source reactions or production field accuracy. The implementation rejects surfaces/collar and bounds aspect ratio, coordinates and observer distance to reduce numerical singularity/cancellation risk. These bounds are explicit restrictions; they are not a rigorous universal floating-point error guarantee. The NIST [accuracy discussion](https://math.nist.gov/~MDonahue/talks/hmm2007-MBO-03-accurate_demag.pdf) motivates treating cancellation limits carefully.

No native persistence is invoked. Development JSON reports are not HASH scene records; no JSON scene data or recomputable field arrays are saved to HASH.
