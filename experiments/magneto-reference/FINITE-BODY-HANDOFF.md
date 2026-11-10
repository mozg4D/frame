# Finite uniformly magnetized body reference

Baseline: sibling `magneto-chronology` with 126 passing bounded CPU tests. Its source/data fingerprints are retained outside this candidate in `../finite-body-baseline-hashes.json`. The prior current and chronological deliverables remain separate and unchanged.

The next independent reference layer evaluates the magnetostatic field of explicitly supplied, uniformly magnetized rectangular volumes. Its purpose is to provide a finite-body oracle for investigating the existing Plummer interaction and equivalent-sphere diagonal approximations. It does not infer body shape from Frame geometry, solve a nonlinear material, or establish spatial convergence of the general magnetic-sample discretization.

Independent physical review uses the surface-charge integral `H(x) = (1/(4 pi)) integral sigma(s) (x-s)/|x-s|^3 dA`, `sigma=M dot n`. A separate face quadrature will be compared with the implementation's analytic formulas at interior and exterior oblique points, avoiding singular surfaces. The cube-center result and far-field moment provide additional checks. Numerical cancellation and boundary-domain limits must be explicit.

Primary sources: [Magpylib equivalent surface-charge formulation](https://magpylib.readthedocs.io/en/5.2.0/_pages/user_guide/examples/examples_misc_equivalent.html), [Magpylib analytical-solution references](https://magpylib.readthedocs.io/en/latest/_pages/user_guide/guide_resources_01_physics.html), and [NIST numerical accuracy discussion](https://math.nist.gov/~MDonahue/talks/hmm2007-MBO-03-accurate_demag.pdf). No third-party runtime or source implementation is copied.

Architecture constraint: this milestone adds no native persistence and no JSON scene records to HASH. Runtime arrays are transient CPU reference fixtures only. A report or delta manifest is development evidence, not scene serialization. Native scene integration must honor the project's current typed/binary persistence design and omit recomputable fields.

The common GPU slot remains reserved by the main coordinator. This isolated task performs short CPU/source checks only; no browser, GPU load, shared main edits or publication. The general solver and native Solve remain unqualified. The output is a baseline-relative delta for the common integration batch, with exact source hashes and physical limitations recorded on disk.
