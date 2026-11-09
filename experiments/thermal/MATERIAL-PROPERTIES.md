# Temperature-dependent material preparation

This is an unregistered, single-phase SI data module. It does not alter the
installed Thermal preview, declare native tags, launch a solver, allocate GPU
resources or certify a scene. It is independent of the separate native
energy/lifecycle/live-guard checkpoints. The existing conduction and P(T)
backends still require their existing constant heat-capacity contracts.

## Explicit material contract

`snapshotMaterialProperties({densityKgPerM3, points})` accepts a positive constant
density and 2..128 strictly temperature-ordered points. Each point contains:

- `temperatureCelsius`: finite temperature strictly above absolute zero.
- `specificHeatJPerKgK`: positive mass-specific heat capacity.
- `conductivityWPerMK`: positive thermal conductivity.

The point temperatures define the entire valid domain. Both endpoint values are
included. Each property is linearly interpolated between adjacent points; no
clamping, extrapolation, preset or phase behavior is inferred. Constant properties
use equal values at two different explicit temperatures. The knot count is a
bounded preparation contract, not a mesh-quality or VRAM policy.

Snapshots copy and deeply freeze plain own-data records. Accessor, inherited,
hidden, symbol, unknown and sparse-array properties reject without executing
ordinary accessor callbacks. This is a plain-data boundary, not a sandbox for
arbitrary JavaScript Proxy traps. A parsed/serialized record must be snapshotted
again before use; copied objects are not accepted as validated snapshots.

## Sampling and heat accounting

`materialAtTemperature(material, temperatureCelsius)` returns density, specific
heat, conductivity and `volumetricHeatCapacityJPerM3K`. The conversion is
`densityKgPerM3 * specificHeatJPerKgK`, once. The result is frozen.

`specificEnthalpyChange(material, fromTemperatureCelsius, toTemperatureCelsius)`
returns signed J/kg:

    delta-h = integral[from,to] cp(T) dT

Every intersected table segment is integrated by its trapezoid, which is exact
for the declared piecewise-linear cp model apart from floating-point rounding.
Celsius and Kelvin temperature intervals have identical magnitude. Summation is
compensated. Integration evaluates the requested interval directly rather than
subtracting two large cumulative enthalpies. Cooling returns the negative of the
reverse heating integral; equal temperatures return zero.

`materialEnergyChange(material, massKg, fromTemperatureCelsius,
toTemperatureCelsius)` returns `massKg * delta-h` in joules. Mass is explicitly
supplied; no geometry, clipping, material participation, volume or source power
is inferred. This is an enthalpy difference. Equating it with stored internal
energy in a future solver requires that solver's thermodynamic assumptions; this
module does not model pressure work, mechanical energy or thermal expansion.

Density, material properties, nonzero returned energies and volumetric capacities
must be finite normal binary64 numbers. Nonrepresentable products, integrals and
sums reject with `NUMERICAL_RANGE`. Out-of-domain temperatures reject with
`MATERIAL_TEMPERATURE_RANGE`. The module does not promise Float32 upload accuracy
or a numerical residual tolerance. Each interpolation weight is computed from
its own endpoint distance to avoid cancellation; an interior weight that is
zero or subnormal rejects conservatively even if an alternative scaled
calculation could recover a meaningful value. Density is constant; latent heat, phase
transitions, emissivity/radiation and property discontinuities remain absent.

## Verification and integration

Run the independent CPU suite from the repository root:

    node --test experiments/thermal/tests/material-properties.mjs

It uses synthetic analytic fixtures, not qualified material presets. Cases cover
constant/linear heat capacity, conductivity interpolation, cross-knot integrals,
cooling, subdivision invariance, differential consistency, small intervals far
from the domain origin, SI density conversion, immutability, malformed data and
representability failures. A 128-point snapshot has a 100 ms budget; 30,000
completed sample/integral/energy queries have a combined 1000 ms CPU budget.
These are local regression budgets, not universal device guarantees.

This module is not a CPU substitute for a GPU thermal solver. No production
runtime imports it. Hardware qualification of the previous constant-capacity
solver cannot qualify a future variable-capacity solver merely by importing this
module. Before activation, separately specify native table authoring and
animation, HASH/copy/Undo, material-source identity, GPU discretization with
enthalpy-consistent storage, phase-change convention, and independent energy and
mesh/time convergence tests. Preserve the existing backend until those changes
are explicitly qualified.
