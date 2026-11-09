# Optics CPU reference experiment

This directory is independent of the application runtime. It is not a scene tracer, material catalogue, native geometry adapter, GPU implementation, or path optimizer. No production imports are permitted.

Run: `node --test experiments/optics/reference.test.mjs`.

## Contracts

- Vectors are finite three-element JavaScript arrays. Inputs are normalized internally with scaling to avoid norm overflow. Directions are propagation directions, not directions toward the light.
- The interface normal points into the incident medium. The incoming propagation direction must oppose it. Dot products above 1e-14 are rejected; roundoff within that tolerance is treated as grazing. Callers select media and orient normals explicitly; the implementation never silently swaps them.
- Refractive indices are positive finite real scalars at the caller-selected wavelength. Dispersion, complex indices, absorption, roughness, polarization state and coatings are absent.
- Returned directions are unit vectors. `reflectance` and `transmittance` are unpolarized *power fractions*, summing to one for this lossless dielectric interface. They are not radiance or irradiance multipliers.
- At total internal reflection the transmitted direction is null and `tir` is true. At exactly the critical angle it is also null because transmitted power is zero, but `tir` is false. Numerically near-critical classification follows floating-point arithmetic.
- An index-matched interface transmits the incoming direction unchanged with zero reflection, including exact grazing. A mismatched grazing interface reflects all power.
- Power inputs and ledger entries use watts. `splitPower` partitions incident power without modeling transport. `powerResidual` returns incident minus escaped, absorbed, active and discarded power. Negative residuals expose over-accounting rather than being clamped; callers decide tolerances. This helper is not a mutable ledger or proof of physically correct transport.

## Verification and limits

Nine node:test cases cover normal incidence, Snell refraction, Brewster reflectance, TIR, the critical boundary, grazing, matching indices, extreme finite index values at normal incidence, validation, normalization, power accounting and 20,000 reproducible randomized interface cases. Random cases check unit lengths, Snell, reflection, reciprocity and power closure. CPU budget for that batch including assertions is five seconds; diagnostic output records measured wall time. This is a CPU reference safety budget, not a production throughput claim. No GPU or full application suite is executed by this isolated test command.

Floating-point real arithmetic cannot resolve arbitrary index ratios or rays arbitrarily close to critical/grazing boundaries; no arbitrary precision claim is made. All transport, scene intersection, path termination, wavelength sampling and integration remain future work.

## Finite source sampling

`source-sampling.mjs` adds an isolated one-sample reference for uniform rectangular Lambertian and ideal Collimated emitters. It preserves finite emitting area, uses explicit caller-provided unit samples and fixed source watts divided by sample count, and distinguishes solid-angle density from delta-direction probability mass. See [SOURCE-SAMPLING.md](SOURCE-SAMPLING.md) for units, physical references, analytic moment/cone/footprint oracles and numerical limits. Run `node --test experiments/optics/source-sampling.test.mjs`. The native plugin does not import this experiment; no scene calculation or LED calibration is implied.
