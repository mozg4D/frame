# CPU reference constitutive materials

This isolated module is an analytically defined test material family, not a calibrated steel, ferrite, NdFeB or SmCo preset. Numeric constants in tests are synthetic fixtures only. No experimental hysteresis validation, manufacturer curve fit, temperature validity range, energy-consistent hysteresis potential, physical solver, native UI or GPU qualification is claimed. Do not present these laws as production material data.

## API and units

- `createMaterial(parameters)` validates and freezes an owned material. Required soft parameters: `kind: 'soft'`, `saturationMagnetization` > 0 (A/m), `reversibleSusceptibility` >= 0 (dimensionless).
- Hard materials use `kind: 'hard'` and additionally require `remanentMagnetization` > 0 (A/m, <= saturationMagnetization), `initialRemanenceFraction` in [0,1], `coerciveField` > 0 (A/m), and `irreversibleSusceptibility` > 0 (dimensionless). No defaults or named real-material presets are invented.
- `coerciveField * irreversibleSusceptibility >= remanentMagnetization` ensures every allowed remanent state is stable at zero applied H. Derived scales must remain finite. Unknown parameters are rejected rather than silently treated as supported physics.
- `validateMaterial(material)` returns true for owned validated materials and throws otherwise. Reconstruct serialized parameters with createMaterial; spread/cloned objects are deliberately not valid material identities.
- `createInitialState(material)` returns a fresh immutable `{remanence: [Mr * initialRemanenceFraction, 0, 0]}` for hard material and zero for soft material. Axes are object-local; initial magnetization is along local +X.
- `evaluateMaterial(material, {H, baselineRemanence})` returns immutable `{M, remanence, saturation}`. H, M and remanence are 3-vectors in A/m in the same coordinate system. Saturation is dimensionless |M|/Ms in [0,1]. Supply an explicit zero baseline for soft material. Finite number arrays or typed arrays of length three are accepted and copied; inputs are never mutated.

Magnetization is not magnetic flux density. If needed elsewhere, B = mu0 (H + M), with B in tesla; this module does not estimate demagnetizing fields or compute B. Sample weights/volumes and interaction geometry belong to the solver, not the material law.

## Defined laws

Let h = |H|. The reversible vector is zero at h=0, otherwise V = Ms tanh(chi_rev h / Ms) H/h. Its infinitesimal slope is chi_rev and its norm is bounded by Ms. Soft materials have M=V and zero persistent remanence. This is an isotropic, reversible saturating response, not a measured B-H table.

For hard material, start every evaluation from the same physical-step remanence R0. Define center C = chi_ir H and radius a = chi_ir Hc. If |C-R0| <= a, leave R=R0. Otherwise set R = R0 + (1 - a/|C-R0|)(C-R0). Project that result onto the ball |R| <= Mr. Finally M is the Euclidean projection of R+V onto |M| <= Ms.

This vector-play construction supplies a material-specific dead band and a continuous partial irreversible transition rather than a shared global threshold. A virgin collinear sample changes only beyond Hc; its partial remanence is chi_ir (|H|-Hc), capped at Mr. Reversal from a prior state depends on that state. Hc is a parameter of this defined irreversible play law, not a promised measured intrinsic coercivity or B=0 coercive field of a real material. The reversible term and final projection change the total-M zero crossing. These simple laws have projection kinks and no provided differentiable tangent.

Zero field preserves all admissible hard remanence; weak fields can change M reversibly without changing remanence. Strong positive or negative pulses change persistent remanence, including partial magnetization, demagnetization and reversal. An unchanged subsequent field does not drive a new scalar-play transition merely because a new frame was evaluated. All vector operations are isotropic and covariant under joint rotation of H and R0. Local +X is an initialization convention, not intrinsic anisotropy. Do not interpret this as an easy-axis NdFeB model or quantitative off-axis switching prediction.

## Per-sample lifecycle and reset

Allocate independent remanence for every magnetic sample. Local H must be obtained by transforming the solved world field with the sample object's rigid inverse rotation. Rotate M back for interactions; never apply translation to a magnetic vector. Per-sample history allows a pulse to remagnetize different regions differently.

For each physical timestep, the lifecycle controller supplies an immutable preceding baseline. Every nonlinear trial passes that same sample baseline into evaluateMaterial. A previous trial may warm-start the field solve but must never become the remanence baseline. Persist only the final converged candidate through the controller. Repeated Solve Frame uses the retained preceding state; a cache clear cannot reset physical history. This function is pure and cannot enforce caller chronology itself.

Reset recreates each sample's initial state from its material and local +X orientation, and explicitly installs a new independent controller state. Reset is not achieved by evaluating zero field. Checkpoint restore and backwards-time replay remain controller/solver responsibilities. Material/sample-layout changes need an explicit compatible reset or state migration, not accidental reuse of another material's history.

This is rate-independent reference behavior: no dt, frequency, thermal dynamics, eddy current losses, coercivity distribution, nucleation/domain-wall model, measured minor-loop fit or pulse-width dependence. Temporal sampling must resolve field extrema; a pulse omitted between frames cannot be recovered by this material function. General vector paths need independent physical validation before any production use.

## Verification

Run `node --test plugins/magneto/tests/materials.test.mjs`. Tests cover analytic soft response, zero/virgin/remanent states, weak reversible recovery, signed strong pulses, partial magnetization/demagnetization, local-X reset, immutable per-sample records, material-specific coercivity, fixed-baseline repeated trials, vector rotation covariance, saturation, extreme finite fields and invalid input. The timing test measures completed CPU calls and reports its checksum; it is not a benchmark of a native solve or GPU implementation. Lifecycle integration tests belong to the solver adapter.
