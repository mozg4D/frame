# Prescribed uniform-magnetization cuboid field oracle

This independent CPU module evaluates H and B from explicitly supplied rectangular cuboids. It integrates their six charged faces analytically. It does not sample dipoles, soften the kernel, approximate a cuboid by a sphere, or solve a material constitutive law. It consumes no native geometry and changes no solver, state, animation, authoring or scene API. There is no native persistence, HASH record, geometry mirror, worker cache or production fallback.

## API, units and geometry

```js
import {evaluateCuboidField} from './finite-body.js';
const fields = evaluateCuboidField({
  units: 'SI',
  bodies: [{
    center: [0, 0, 0],           // world metres
    halfSize: [0.01, 0.02, 0.03], // positive local half lengths, metres
    magnetization: [0, 0, 8e5], // prescribed uniform local M, A/m
    rotation: [0, 0, 0, 1],    // optional local-to-world XYZW unit quaternion
  }],
  targets: [[0, 0, 0], [0.04, 0.01, 0.05]], // world metres
});
// fields.H, fields.B, fields.materialM: world vec3 arrays (A/m, T, A/m).
// fields.region: 'exterior', 'interior', or 'overlap' at each target.
// fields.metrics: bodies, targets, faceEvaluations = 6*bodies*targets.
```

Each cuboid occupies the closed box [-a,a] x [-b,b] x [-c,c] in its own rotated frame. M is supplied in that frame. A quaternion must have norm within 1e-12 of unity; normalization within that tolerance removes input rounding. The identity is used if omitted. Rigid rotation moves both the geometry and M. H and B contributions superpose. In an overlap, materialM is the sum of all covering prescribed M vectors, so B = mu0*(H + materialM). This is a mathematical distribution superposition, not a model of two real materials occupying the same volume.

Exterior B = mu0*H. Interior B = mu0*(H+M), including contributions of other bodies in H. Here mu0 = 4*pi*1e-7 H/m is an explicit conventional reference value consistent with the existing CPU kernel, not a new metrology claim. No external applied field is inferred. Empty body/target lists are supported. Every result and nested array is frozen; no reference to caller input is retained. Errors return no partial field array.

## Derivation and primary references

For constant M, the volume magnetic charge -div(M) vanishes. The surface charge is sigma = M dot n on each outward face normal. The field away from the charged surface is

H(r) = (1/(4*pi)) sum_faces sigma * integral_face (r-r') / |r-r'|^3 dA'.

The equivalent-charge derivation and its relation to bound surface currents are described by the [Magpylib authors](https://magpylib.readthedocs.io/en/5.2.0/_pages/user_guide/examples/examples_misc_equivalent.html). A primary analytical prism treatment, including arbitrary orientation and logarithm/arctangent expressions, is [D. J. Hemingway, Geometric properties of the magnetic field outside a magnetized rectangular prism, 2026, equations 1–4 and Appendix A](https://doi.org/10.1093/rasti/rzag015). Our implementation below is derived directly by integrating a single rectangle; it is not copied from a numerical library or that paper's implementation, and its interior branch is separately tested.

For one face, let u and v be source coordinates relative to the observation's projection, with bounds u0,u1 and v0,v1. Let d be observation minus face coordinate along the positive coordinate axis normal. Thus the field numerator is (-u,-v,d). Write R=sqrt(u²+v²+d²), and define

L(t0,t1,rho) = asinh(t1/rho) - asinh(t0/rho).

Integrating -u/R³ in u gives 1/R at the two edges, so the first tangential component is

Iu = L(v0,v1,hypot(u1,d)) - L(v0,v1,hypot(u0,d)).

The second component Iv exchanges u and v. asinh is the logarithmic antiderivative, evaluated without subtracting R+t when t is negative. When rho=0 on an edge-line extension away from the actual rectangle, the integral has the finite limit sign(t0)*log(abs(t1/t0)); intervals crossing zero are rejected.

The normal component is the signed solid angle:

In = F(u1,v1)-F(u0,v1)-F(u1,v0)+F(u0,v0),

F(u,v) = sign(d)*atan2(u*v, abs(d)*sqrt(u²+v²+d²)).

The positive denominator implements the principal arctangent branch on both sides of a face. Using atan2(u*v,d*R) unmodified would introduce spurious 2*pi branch jumps behind a face. For d=0 outside the finite rectangle, In=0. Actual surface points and a collar around them are excluded below. For a face at signed local half length, sigma=sign*Mnormal. We multiply (Iu,Iv,In) by sigma/(4*pi), permute components to local XYZ, sum faces, and rotate H into world axes. Inside bodies, materialM is then added only when forming B.

Coordinates are divided by each body's maximum half length before the face integral. The inverse-square field kernel and face area cancel this scale exactly in the mathematical integral; no physical size or M correction is needed. This also avoids squared metre scales overflowing or underflowing.

## Bounded numerical domain

These conservative operational bounds are checked for every supplied pair, including a body with zero M. They are not a rigorous uniform floating-point error bound or a qualification of every point in the admitted domain. Test tolerances apply to the fixtures described below.

- At most 32 bodies and 512 targets; O(6*bodies*targets), at most 98,304 rectangular face evaluations. No external numerical libraries.
- All vectors are dense numeric arrays; plain records have exactly the documented fields. Nonfinite values, strings, sparse arrays, accessors, extra fields and unsupported units fail closed.
- Each half length lies in [1e-100,1e100] metres and maxHalf/minHalf <=16. M components lie in [-1e100,1e100] A/m, with each nonzero component having magnitude >=1e-100 A/m. Zero is valid.
- For every target/body pair, each local coordinate relative to the center has magnitude <=64*minHalf. Distant targets are rejected; there is no silent dipole replacement. This limits cancellation of nearly equal corner/face terms. Large aspect ratios are rejected for the same reason.
- Each absolute world center and target coordinate must have magnitude <=1e6*minHalf for every contributing body. This bounds loss of geometric detail when subtracting large translated coordinates. Rebase a fixture around a nearby origin when appropriate.
- A target is excluded if, along any local axis, abs(abs(qAxis)-halfAxis) <=1e-10*maxHalf and its other coordinates project inside the face rectangle expanded by the same collar. This rejects face interiors, edges, corners and their collar from both sides. Exact exterior points on extended supporting planes remain admissible when outside the expanded face rectangle.

Analytical integrals can lose precision through cancellation at large separation; see [Michael J. Donahue, NIST, Accurate computation of the demagnetization tensor, especially slides 11–16](https://math.nist.gov/~MDonahue/talks/hmm2007-MBO-03-accurate_demag.pdf). That source concerns volume-averaged demagnetizing tensors, while this oracle is pointwise: it motivates our bounded domain, not a numerical error estimate for our algorithm. We do not claim certified relative accuracy near field zeros, near edges, or throughout arbitrarily tiny gaps. The collar is a rejection policy, not regularization of an underlying singular field.

## Evidence and limits

The implementation suite checks cube-center H=-M/3 and B=2*mu0*M/3; a separately written on-axis rectangular-bar solid-angle formula; signed linearity, zero and body superposition; dipole far-field behavior; scale/translation covariance; finite one-sided near-face fields and normal-B/tangential-H continuity; surface/edge/corner/collar rejection; finite/magnitude/capacity/domain checks; immutable results and complete near-face/many-target timing. Each maximum-size operation uses nonzero M and asserts a 3000 ms local CPU fixture budget; this is not a portable production latency promise.

The independent review adds converged six-face Gauss quadrature at oblique interior/exterior points, a non-spherical central demagnetizing tensor/trace, independent Rodrigues rotation covariance, face jumps, a prescribed shrinking gap fixture, and local Maxwell derivative checks. See finite-body-review.md for fixture limits. These are CPU physical reference checks, not GPU/browser/native integration or a certified continuum solver convergence study.

The existing reference-solver.js is unchanged. Its symmetric Plummer dipole Hessian differs from a cuboid near a face (explicitly demonstrated by a test), and its optional equivalent-sphere diagonal -M/3 is a sphere result: it happens to match the cube center but does not describe the general cuboid field or central shape factors. This oracle does not silently replace either approximation. It is for prescribed, uniform M, with no nonlinear soft-body demagnetization solve, spatial discretization/refinement, calibrated presets, loads/energy oracle, dynamic geometry or electromagnetic transients.

`npm test` runs all retained CPU tests. `npm run verify` retains exact before/after source hashes, TAP, operation timing, and results/finite-body-report.json. Native integration, any JSON scene record in HASH, persistence and publication remain outside this isolated milestone.
