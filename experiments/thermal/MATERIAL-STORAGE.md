# Explicit-cell material storage and energy accounting

This unregistered preparation module connects the independently tested material
tables to explicit per-cell SI inputs. It never captures scene geometry, assigns
materials by bounds, invokes the native API or a solver, or accesses a GPU.

`snapshotMaterialStorage({materials, cells})` accepts 1..64 raw material tables
using `snapshotMaterialProperties`, and 1..4096 cells. Each cell has exactly
`materialIndex`, positive `volumeM3`, and `temperatureCelsius`. It snapshots all
data and freezes the result. Cell mass is density times the explicit volume;
initial heat capacity is mass times mass-specific heat. Both must be positive
normal binary64 values. Initial conductivity and volumetric heat capacity are
sampled through the first-batch material module. No density factor is applied
twice. A flag reports whether any input material has temperature-dependent cp.
Unused table entries are allowed and conservatively included in that flag.

The caller must separately prove the physical cell volumes, their nonoverlap,
material assignments and completeness. These inputs contain no owner identity,
geometry lease or native tag provenance. The cell count is an experimental bound,
not an automatic meshing or user Quality policy. Cells remain at their initial
temperatures; accounting calls do not advance the snapshot.

`accountMaterialStorage(plan, {temperaturesCelsius, sourceEnergyJ,
boundaryEnergyOutJ})` requires one final temperature and two signed, already
time-integrated energy values per cell. Positive boundary energy leaves the
cell; negative energy enters. Watts, endpoint power times a duration, or source
normalization are never inferred. It returns frozen per-cell quantities:

    storageEnergyJ = massKg * integral[initial,final] cp(T) dT
    residualJ = storageEnergyJ - sourceEnergyJ + boundaryEnergyOutJ

These are material enthalpy differences. A future thermal solver must explicitly
justify its use of cp and omission of pressure/mechanical work before treating
them as storage internal energy. Density and volume are held constant here.
The existing constant-capacity conduction/P(T) backend is not changed or called;
sampling cp at the start of a variable-cp interval does not implement this
integral or qualify a nonlinear GPU discretization.

The result includes signed sums, gross source/boundary magnitudes, and the sum of
absolute cell residuals. Thus errors in two cells cannot disappear merely
because their global signed residual cancels. Summation is compensated;
nonfinite/subnormal results and overflowing intermediate sums reject with
`NUMERICAL_RANGE` (conservative even when another summation order could work).
Inputs must be dense ordinary own-data arrays and exact plain-data records;
accessors and unknown fields reject. Proxy objects are outside the plain-data
trust boundary. Temperature domain and first-batch interpolation restrictions
are preserved, with no extrapolation or clamping.

No residual threshold, numerical success flag, precision allowance or energy
acceptance is invented here. External cell source/boundary numbers are assertions
by the caller, not independently measured fluxes. This report is not a replacement
for per-cell equations, face-flux reciprocity, source-normalization and physical
residual/precision gates in a future solver. `solverReady`, `currentnessCertified`
and `completePhysicalScene` remain false in both snapshot and report.

## Verification and integration dependencies

Run the short CPU suite from the separate copy on Node >=22:

    node --test experiments/thermal/tests/material-properties.mjs experiments/thermal/tests/material-storage.mjs

Tests use analytic synthetic bodies: SI mass/capacity, constant/linear cp energy,
heating/cooling and inward/outward flux signs, different materials, refinement,
compensating local errors, malformed snapshots, immutability and representability.
4096-cell snapshot and accounting each have a 500 ms local CPU latency budget.
There is no browser or hardware arithmetic qualification in this suite.

Batch 2 depends on the exact first-batch material-properties.js. Apply the first
batch before adding this module, test and document. It does not depend on core
lifecycle/live-guard changes, native-inputs, conduction or installed Thermal.
Before native use, finish the separately tracked physical participation and
geometry/material-source provenance contracts. Before variable-cp stepping,
implement and qualify enthalpy-consistent GPU storage and time/mesh convergence.
Native tags/table records, animation, cache identity, UI and installed Solve
remain separate work. Shared acceptance and main publication stay with the
coordinator; no GPU or aggregate tests start during its occupied gate.
