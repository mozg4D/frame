# CPU direct interaction reference (isolated, not production qualification)

This module is a bounded, dependency-free numerical reference for distinct weighted magnetic samples. It does not implement a material law, nonlinear solve, hysteresis, geometric preprocessing, sampling, GPU acceleration, native Frame integration, or physical presets. It is not an exact finite-body kernel and is not qualified for tiny gaps. Do not infer those capabilities from the tests.

## API and SI contract

`evaluateDirect(samples, { supportScale=1, selectedOwners=null, pivot=[0,0,0] }={})`

Each sample is `{position:[x,y,z], moment:[mx,my,mz], volume, objectId}`. Positions and pivot are world-space metres. Volume is strictly positive cubic metres; moment is A m^2. If starting from magnetization density M in A/m, the caller computes moment=M*volume. For transformations, the caller must supply world positions, rotated moments, and correctly scaled physical volume; this module does not interpret local transforms or Frame units.

Returns `{H,B,forces,torques,energy,selection,pairCount}`. Per-sample H is A/m. B is the vacuum/source interaction field mu0*H in tesla, NOT material induction mu0*(H+M). Force is N; intrinsic torque is N m; energy is J. `MU0=4*pi*1e-7` is the conventional vacuum approximation used consistently here. Pair energy appears once. All distinct samples contribute, including other samples of the same owner. The i=i field and energy are omitted: there is NO implicit diagonal equivalent-sphere demagnetizing term. A separately documented self model belongs in the caller, with matching energy if forces or energies depend on it.

`selectedOwners` is null or an array of existing nonempty string object IDs; duplicate IDs are harmless. Selection returns net `{force,torque}` about pivot. Only pairs crossing the selected/unselected boundary contribute. Internal pair forces cancel analytically and their orbital plus intrinsic torques cancel. Skipping those pairs in resultants prevents internal cancellation roundoff from appearing as net self-force. Individual per-sample arrays still contain all distinct interactions. An empty selection returns zero loads. Unknown owners throw. With no selection, `selection=null`.

## Equations and approximation

Let r=xi-xj, mi and mj be moments, Ri=(3Vi/(4*pi))^(1/3), e^2=supportScale^2*(Ri^2+Rj^2), s=r.r+e^2, c=mu0/(4*pi), a=mi.r, b=mj.r, d=mi.mj.

This is the Hessian of a Plummer-softened Green function G=1/sqrt(s). Its volume-derived softening length is finite, but the kernel is NOT compact support and is NOT the exact volume-averaged field of two balls or arbitrary bodies.

- Bi = c*(3*r*b/s^(5/2) - mj/s^(3/2)).
- Uij = c*(d/s^(3/2) - 3*a*b/s^(5/2)) = -mi.Bi.
- Fi = -gradient_xi Uij = c*(3*(d*r+b*mi+a*mj)/s^(5/2) - 15*a*b*r/s^(7/2)); Fj=-Fi.
- Intrinsic torque_i=mi cross Bi.
- Torque about pivot p=(xi-p) cross Fi + intrinsic torque_i.

Volume/support is held fixed in translational and rotational derivatives. The model is isotropic, reciprocal, finite at coincidence, and rotation invariant. It approaches textbook point-dipole physics only at distances large relative to softening. supportScale must remain strictly positive; reducing it is a convergence experiment, not a calibration or proof of short-range accuracy. At zero separation forces vanish; finite energy/field depends on support. Omission of self terms makes arbitrary subdivision a changed discrete model, particularly for internal fields and energies. No continuum demagnetization or material-physics claim follows.

## Optional prescribed-current field

`evaluateCurrentField(sources, targets, {supportScale=1}={})` accepts sources `{position,currentDensity,volume,objectId}` and target world vec3 positions. Current density is signed A/m^2 (Frame A/mm^2 requires multiplication by 1e6). It returns source `{B,H}` by volume quadrature B(x)=c*sum(V*J cross r/(r.r+(supportScale*R)^2)^(3/2)). Sign reversal and zero current are preserved. This is a regularized Biot-Savart reference for an already supplied physical J; it does NOT solve or certify divergence-free currents, cut planes, circuits, boundary conditions, current forces, or magnetic/current coupled energy. Targets are observation points with no target support volume.

## Validation, bounds and tests

Inputs are copied and checked before evaluation. Arrays must be ordinary three-number arrays. Nonfinite values, nonpositive volumes/support, missing owners, oversized arrays, unrepresentable support/distance, or nonfinite computed results throw without returning partial output or modifying inputs. This is synchronous CPU work, capped at 2048 magnetic/current sources and 2048 current targets. Magnetic cost is O(N^2), maximum 2,096,128 pairs; current cost maximum 4,194,304 source-target evaluations. Output storage is O(N) or O(targets). This is a safety cap, NOT an interactive latency guarantee. Callers should use much smaller reference batches. There is no cancellation or wall-clock deadline inside the synchronous loop.

Run `node --test plugins/magneto/tests/direct-kernel.test.mjs`. Tests cover independent textbook axial/equatorial far-field values; finite-difference energy forces for both samples; intrinsic and rigid rotation derivatives; moment/field energy duality; action/reaction; internal group load cancellation; finite coincidence; support convergence; fixed-total-moment coincident volume subdivision; signed-current far-field behavior; malformed, overflow and capacity rejection; unchanged inputs. Coincident subdivision checks weights and support scaling only, NOT convergence of spatial geometry quadrature. Independent finite-body near-field and spatial mesh-refinement validation remain required.

The 256-sample smoke case has 32,640 pairs and a deliberately loose 5-second CI budget; it is not a browser/GPU or production performance qualification. Initial LAB run: 11/11 tests passed; smoke case 34.66 ms, full file about 122 ms. Timings vary with CPU load. The existing lifecycle npm suite is a separate contract check and does not automatically include this file until its owner updates test tooling.

## Prescribed-current dipole loads

`evaluatePrescribedCurrentLoads(sources,dipoles,{supportScale=1,selectedOwners=null,pivot=[0,0,0]}={})` evaluates magnetic dipoles in a fixed, externally supplied current quadrature. Source shape matches evaluateCurrentField; dipole shape matches evaluateDirect. Returns `{B,H,forces,torques,fixedMomentEnergy,selection,pairCount}`. It does not add dipole-dipole interactions. Units and validation match the APIs above. Dipole volumes are validated but do not enter source-only softening; source and target samples interact even when object IDs match. Selection IDs refer only to dipoles. All selected loads are summed; there is no internal pair cancellation assumption for these externally imposed sources.

For r=x_target-x_source, s=r.r+(supportScale*Rsource)^2, and Cartesian basis ek:

- B=c*V*(J cross r)*s^(-3/2).
- derivative_k B=c*V*((J cross ek)*s^(-3/2)-3*(J cross r)*r_k*s^(-5/2)).
- Fk=m dot derivative_k B.
- Intrinsic torque=m cross B.
- fixedMomentEnergy=-sum_targets(m dot B).

This energy is the fixed-moment potential in prescribed current fields, not the full current/dipole circuit energy. The current distribution is held fixed in these translation and rotation derivatives. No forces, torques, reactions, momentum balance or energy accounting for the source conductors or their power supply are returned or claimed. At source/target coincidence B and intrinsic torque vanish, while the analytic force can be finite and nonzero. The externally supplied current quadrature remains unqualified as a divergence-free physical conductor current. Maximum cost is 2048*2048 interactions; there is no cancellation inside the synchronous loop.
