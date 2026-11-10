# Explicit integrated-face energy ledger

`accountMaterialFluxes(plan, input)` is an unregistered accounting prerequisite
for connecting explicit solver face energies to batch-2 material enthalpy.
It imports only `accountMaterialStorage`. It computes no flux law or time step,
accesses no native scene/GPU, and writes no persistence or HASH records. In
particular, it adds no JSON scene data to HASH. Returned JavaScript reports are
runtime-only plain data; diagnostic JSON files in evidence are external reports.

The plan must be the original validated batch-2 storage snapshot. Input contains:

- `temperaturesCelsius`: final temperature per cell.
- `sourceEnergyJ`: signed, already time-integrated source energy per cell.
- `internalFaces`: records with unique nonnegative safe-integer `faceId`,
  distinct valid `cellA`/`cellB` and signed integrated `energyJ` from A to B.
- `boundaryFaces`: records with `faceId`, valid `cell` and signed `energyOutJ`,
  positive toward the exterior and negative into the cell.

Face identities must be unique across both arrays. A face is supplied once,
never once for each side. An internal entry adds its energy to A's outflow and
the exact sign reversal to B's outflow. Multiple different physical faces may
connect the same pair of cells. Up to 4096 cells and 32768 entries in each face
array are supported. Dense own-data arrays and exact plain-data records are
required; ordinary accessors, extra/inherited fields and malformed numeric data
reject. Proxy traps are outside this plain-data trust boundary.

`internalNetOutJ` and `exteriorNetOutJ` retain per-cell components. Their combined
`totalNetOutJ` is passed to the existing storage accountant's per-cell
`boundaryEnergyOutJ` input, where it means net energy leaving that particular
cell, including internal faces. Consequently the nested `storage` report's
boundary field must not be mistaken for the domain's exterior-only energy.
The wrapper's `exteriorEnergyOutJ` and `globalResidualJ` explicitly use only
domain boundary faces:

    cell residual = delta-h * mass - cell source + total cell outflow
    global residual = total storage - total source + exterior energy out

The nested absolute cell residual exposes opposite local errors even when the
global sum cancels. `grossInternalTransferJ` counts the absolute energy of each
internal face once. Compensated summation is used, but binary64 per-cell sums
can still lose contributions. `internalAssemblyResidualJ` reports the sum of
the assembled internal outflows; `cellToGlobalResidualDifferenceJ` reports the
difference between the nested signed cell residual sum and exterior-only global
residual. These values are never silently zeroed. Overflow/subnormal final sums
reject conservatively with `NUMERICAL_RANGE`, including overflowing gross
transfers whose signed net could otherwise cancel.

The caller must independently certify adjacency, physical face identity,
coverage, cell volumes/materials, face areas/geometry and actual integrated
fluxes. Different IDs for one physical face cannot be detected without that
geometry contract. A missing face, invented flux or wrong conductivity is not
made physical by pairwise equal-and-opposite assembly. No tolerance, numerical
acceptance, source normalization, enthalpy stepping or scene authority is added.
The three authority flags remain false. The unchanged conduction/P(T) backend
is neither called nor qualified by this ledger.

## CPU verification and integration

Run from the isolated copy on Node >=22:

    node --test experiments/thermal/tests/material-properties.mjs experiments/thermal/tests/material-storage.mjs experiments/thermal/tests/material-flux.mjs

Analytic tests cover internal sign/orientation, source/exterior exchange, local
versus global residuals, unique IDs, multiple faces per cell pair, validation,
immutability, large cancellation, explicit assembly roundoff and variable-cp
reuse. A 4096-cell / 8190-face complete account operation has a 1000 ms local CPU
latency budget. The benchmark does not allocate GPU resources.

Apply batches 1 and 2 first, then the three new batch-3 files. Preserve the exact
dependency hashes in the handoff. Future GPU integration must produce actual
time-integrated face energies, source accounting and independent physical
residual/convergence checks. Native scene provenance/currentness and binary
authoring/serialization remain separately tracked. GPU/aggregate tests and main
publication remain with the coordinator's queue.
