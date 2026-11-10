# CPU reference solver contract

## Scope and units

The module consumes explicit synthetic or independently generated weighted samples, never native triangle buffers. It is O(N squared), bounded to 128 magnetic samples and 2,048 supplied current-quadrature samples in at most 16 bases. It is a small reference backend, not the production solver. Rigid transforms only; unsupported affine scale, unknown fields, nonfinite data, sparse arrays and capacities are rejected. The caller must convert Frame millimetres to metres, volume by 1e-9, and Current Density A/mm squared to A/m squared by 1e6.

Positions and pivots use m; volumes use m cubed; M and H use A/m; sample moment is M times volume in A m squared; B is tesla; fixed-moment interaction energy is joules; force is newtons; torque is newton metres. Sample M, remanence, H and B are returned in object-local axes. Loads and their explicit pivot are world-space SI.

Objects use translation plus an XYZW unit quaternion. localPosition is an object-origin coordinate, not a pivot-relative coordinate. The optional object pivot is inert authoring metadata; referenceLoads requires an explicit world-space pivot and defaults to world zero. No pivot transformation semantics are inferred.

## Equations and approximations

Distinct sample interactions use the symmetric Plummer Green-function Hessian in direct-kernel.md. The support scale derives from volume. This is smooth but noncompact and is not the exact interaction of finite magnetized bodies. It is not qualified for a tiny air gap or spatial refinement of a general body.

The optional equivalent-sphere diagonal adds Hself = -M/3 separately. This equals the exact uniform sphere demagnetizing factor for the one-sample sphere oracle. Applying it to each sample in an arbitrary multi-sample body is an approximation, not a proved demagnetization discretization or a refinement-invariant method. The alternative none omits diagonal self field and is useful only for controlled reference fixtures.

At each trial:
1. Rotate local M into world axes and multiply by the fixed sample volume.
2. Compute magnetic pair H plus prescribed external H.
3. Transform H into each object's local axes and include the optional diagonal.
4. Evaluate the explicit material law from the same physical baseline remanence.
5. Reduce max norm(Mtarget - M) / Ms across samples.

Residual backtracking reduces this constitutive fixed-point error; it does not minimize thermodynamic energy. A residual below the internal tolerance is numerical self-consistency only. Failure to descend, an iteration limit, cancellation or stale source state cannot commit remanence. Internal bounds are not user-facing quality controls.

The reported local Bsample is mu0 times (Hsample + Msample). The kernel's Bsource is mu0 times Hsource. Neither is a general native visualization-plane sampler.

## Material and energy limits

materials.md describes the saturating tanh and isotropic vector-play reference laws. They are not calibrated steel/NdFeB models and do not certify real hysteresis loops, demagnetization curves, temperature effects or magnetic damage. Named physical presets are not fabricated.

fixedMomentInteractionEnergy is pair interaction energy minus the dipole interaction with the uniform/prescribed-current external field. It omits diagonal self energy and material/internal magnetic energy. It is not total magnetic free energy. Its analytic load checks hold moments, volumes and support scales fixed while varying rigid pose. Nonlinear free-energy force/torque correctness and circuit source reactions are not established.

referenceLoads computes only selected magnetic-owner loads. Internal selected dipole pairs cancel by construction. A prescribed-current conductor selected for resultant loads is rejected because its source-reaction/Lorentz model is absent. No reaction/conservation claim is made for the prescribed sources.

## Prescribed current fixture

currentBases contains an explicit geometry-normalized quadrature: localPosition, volume, objectId and dimensionless basisDensity. The signed basis density scalar is A/m squared. No topology, divergence-free distribution or cut is inferred. The test ring is analytically closed by construction; this is not an arbitrary conductor implementation.

The separate conductor-current.js oracle can now generate this shape from a small explicitly supplied oriented graph and explicit tube quadrature geometry. Its scalar is average signed cut density, and its constraints are discrete Kirchhoff conservation and one integrated cut flux. See conductor-current.md: this is no native geometry adapter and no pointwise continuum current-density boundary implementation. The reference-solver capability currentDensityConductorSolve remains false because this solver still only consumes prescribed quadrature.

The session caches each normalized H at the fixed magnetic target positions. Cache keys include actual target/source geometry and rigid frames, excluding only the signed amplitude. A density-only change reuses this field; a relative geometry/frame change rebuilds it. This cache is private, bounded to 16 entries, disposable and separate from physical remanence. It is not evidence that a native conductor basis has been generated or cached.

## State and integration API

createReferenceProblem validates and freezes an issued problem; createReferenceState creates an issued initial local-X state. Edited/copied problem or state objects cannot claim solver provenance. createReferenceSession provides solveFrame, updateProblem, resetProblem, inspect, getResult, clearTransient and dispose. updateProblem preserves physical history only for identical magnetic sample/material layouts; other changes require an explicit reset. Pose/source changes mark the session dirty and cancel stale work. getResult may still return the last completed result while dirty; native consumers must check the scene identity and dirty state before display.

Every session physical solve passes one final state lease through physical-state.js. Its internal nonlinear iterations repeatedly evaluate the same baseline remanence. Re-solving the latest physical time uses the preceding baseline rather than compounding its own transition. A restored completed checkpoint must be reused at its exact time; advancing from it requires a later time. The separate reference-animation.js pure driver now adds bounded chronological adaptive replay for fully specified piecewise-linear source schedules and mandatory declared knots; see reference-animation.md. Native Solve Animation source/timeline capture, curve publication and sparse checkpoint ownership/budgeting are still absent.

No derived solver result should be put into HASH. A future native bridge must use native transactions, source signatures, shared GPU ownership and the usual aggregate/hardware gates. This CPU module must not become a production CPU fallback by reading canonical GPU geometry back to RAM.
