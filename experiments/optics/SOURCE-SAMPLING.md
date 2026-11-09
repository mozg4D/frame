# Finite rectangular source reference

This independent CPU experiment supplies one emission sample at a time for a uniform finite rectangle. It supports the two intended Source authoring distributions without loading a solver into Frame. It does not import native geometry, allocate a ray batch or use a GPU. Runtime source parameters and unavailable Solve behavior are unchanged.

## Physical model

The emitting rectangle is centered at the origin in local X/Y, with propagation into the +Z hemisphere. Its dimensions are physical millimetres supplied by the caller. There is one discrete wavelength in nanometres; `powerW` is the total emitted radiant power in watts at that wavelength, not a spectral density or lumens.

For **Lambertian**, radiance is uniform over area and outgoing directions. The emitted-power distribution over solid angle is cosine weighted. For **Collimated**, every direction is exactly +Z and the emitting positions still fill the rectangle. Collimated is an ideal delta-direction model with zero divergence, not a finite-solid-angle PDF or a calibrated physical LED.

Let A be emitting area in mm2, Phi total watts and N the requested positive sample count. Sampling uniform area and the Lambertian directional density gives

```text
p_A = 1/A                     [mm^-2]
p_omega = cos(theta)/pi        [sr^-1]
L = Phi/(pi*A)                [W mm^-2 sr^-1]
ray weight = L*cos(theta)/(N*p_A*p_omega) = Phi/N  [W]
```

The cosine is already included in the sampling density. Multiplying each emitted watt weight by another cosine loses power and changes the angular model. Changing N must not change Phi. Converting area density to m^-2 requires multiplying by 1e6; the returned area PDF explicitly uses mm^-2.

Sources: [PBRT 4, cosine-weighted hemisphere sampling](https://pbr-book.org/4ed/Sampling_Algorithms/Sampling_Multidimensional_Functions#Cosine-WeightedHemisphereSampling) derives the normalized solid-angle density; [PBRT 4, area lights](https://pbr-book.org/4ed/Light_Sources/Area_Lights) gives the one-sided uniform-radiance flux relation. This implementation uses elementary inverse radial/azimuth mapping, not copied PBRT code or its concentric disk routine.

## API

```js
sampleRectangleSource(
  {widthMm, heightMm, wavelengthNm, powerW,
   distribution: 'lambertian' /* or 'collimated' */},
  sampleCount,
  {areaU, areaV, directionU, directionV}
)
```

All four unit inputs are finite numbers in [0,1), including in Collimated mode. They represent independent uniform variates for the probability interpretation. There is no hidden random generator, seed, optimization state or sampling-sequence policy; a caller can reproduce inputs exactly. Statistical quality is the caller's responsibility. Reusing one variate for both area and direction can create correlations even though each marginal looks right.

The fixed-size output is `{originMm, direction, wavelengthNm, powerW, pdfAreaPerMm2, pdfSolidAngle, angularDiscreteMass}`. `originMm` and unit propagation `direction` are three-element arrays. For Lambertian the solid-angle density is numeric and the discrete mass is null. For Collimated it is the reverse: `pdfSolidAngle:null`, `angularDiscreteMass:1`. Do not substitute a finite density for a delta distribution or use this emission PDF as a receiver-point solid-angle PDF.

Dimensions and wavelength must be positive finite numbers, source watts nonnegative finite, and N a positive safe integer. Derived area, density and half extents must remain positive finite. A positive source whose divided ray watts underflow to zero is rejected rather than silently disappearing. IEEE-754 rounding remains; this is not an arbitrary-scale or exact-arithmetic guarantee. Plain supported inputs are validated before emission; returned arrays do not alias caller state.

## Independent checks

The Lambertian polar-angle marginal implies `P(theta <= alpha) = sin(alpha)^2`, `E[z] = 2/3`, `E[z^2] = 1/2`, `E[x^2] = E[y^2] = 1/4`. These integrated quantities distinguish cosine-weighted emission from uniform-hemisphere sampling and from a second erroneous cosine factor. Midpoint strata at increasing resolutions are checked against these analytic values; deterministic quadrature errors are not Monte Carlo confidence intervals.

Uniform rectangle positions have zero centroid and second moments `widthMm^2/12`, `heightMm^2/12`. Collimated projection onto an unobstructed parallel plane retains those spatial coordinates, so a finite source cannot be replaced with one point while passing the footprint test. This analytic projection is not a scene intersection or general receiver model.

Focused tests also cover fixed total power, zero power, spectrum metadata, endpoints, malformed inputs, arithmetic overflow/underflow, input immutability, reproducibility and completed streaming-sampling latency. Exact test output, timings and source digests accompany each handoff.

## Remaining work

Native affine/sheared/reflected frames, task membership, material and polarization models, spectral integration, textured sources, nonuniform measured LEDs, visibility, geometry intersections, occlusion, receiver accumulation and source-to-target attribution are not implemented here. No footprint test qualifies an optical scene, optimizer, manufacturing result or diffraction prediction. Before a scene adapter is added, shared physical capture must include hidden eligible geometry and explicit enabled participation under the coordinated core contract.

## Recorded CPU qualification — 9 November 2026

Based on published preview `cd90c4cbbf01f26bdbed5260a98861ca0e06c316`, using the installed Node v24.22.1 executable. Eleven new tests plus the existing authoring, interface-law and ledger tests passed 41/41, zero failures/skips, total 214.4973 ms:

```text
node --test --test-reporter=tap plugins/optics/tests/authoring.test.mjs plugins/optics/tests/power-ledger.mjs experiments/optics/reference.test.mjs experiments/optics/source-sampling.test.mjs
```

| Midpoint strata | Absolute E[z] error | Maximum cone-fraction error | Absolute E[x-position^2] error (mm2) |
| --- | ---: | ---: | ---: |
| 8 x 8 | 2.3655e-3 | 5.8013e-2 | 1.8750e-1 |
| 32 x 32 | 3.1602e-4 | 1.1897e-2 | 1.1719e-2 |
| 128 x 128 | 4.0774e-5 | 3.7280e-3 | 7.3242e-4 |

Cone half-angles: 13, 30, 50, 75 degrees. At 128 x 128, angular second-moment errors were at most 5.55e-17. These are the specified ideal-model quadrature checks, not a general error bound for arbitrary scenes or independent Monte Carlo validation.

A streaming loop completed 100,000 mixed emission calls plus output-shape/unit-vector checks in 64.14 ms against a 5000 ms CPU budget. The test's reproducible LCG input seed is 20261109; checksum 82583.424138. The function itself has no RNG. No full ray array is retained; no GPU was used. This measured CPU loop is not a production GPU-throughput claim.

The delta changes only this experiment and its documentation. Syntax and whitespace checks passed. Full npm test, stress and hardware checks were held for the coordinator's common batch; no browser/user window, OBS, printing or publication action was performed. Raw output and source SHA-256 values are provided with the handoff rather than borrowing an older application's hardware pass.
