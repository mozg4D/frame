# Thermal temperature-dependent heater experiment

This directory is an **unfinished, unregistered numerical experiment**, not an installed Thermal solver. Main 0b9c5e3 remains an authoring-only preview. No catalogue entry, scene command, Solve action, Material/Heater tag, measurement or renderer is added. Viewport navigation and ordinary gizmos are untouched.

## Physical model

A heater has an explicit sorted set of equal-volume Cartesian cells and a piecewise-linear table of `temperatureCelsius` and **total object** `powerWatts`. Signed watts permit cooling. The control temperature is the volume mean of those cells, not a local material constitutive law and not a maximum or surface temperature. Each heater's cells must share one constant volumetric heat capacity. Conductivity may be heterogeneous. Heaters must not overlap.

At each completed time step:

1. Sample each heater's mean temperature from the previous actual field.
2. Interpolate its table without extrapolation. Distribute total watts uniformly by physical cell volume. Verify that the assembled cell powers recover the requested object watts. Divide watts by cell count before volume, so a large region-volume product cannot erase a heater.
3. Reuse the existing Thermal finite-volume GPU conduction backend for backward-Euler conduction with that fixed source.
4. Read the bounded actual field, verify the original physical cell equations, source-cell power and global energy, and dispose the retained GPU field.
5. Integrate each actual step's source power and outward boundary power over dt. Never substitute endpoint power times total duration.

This is first-order lagged-source integration. It is not a nonlinear implicit heater solve. Positive-slope feedback can represent physical thermal runaway; a bounded time step does not make such a system stable.

The explicit feedback-resolution gate is dt * maximum absolute table slope / heater heat capacity <= 0.25. It considers all table segments conservatively. It is not a local error estimate. Reducing dt shows first-order convergence for the tested linear feedback model.

## Input and API

`advanceTemperaturePowerGPU({device}, input, {stepCount, signal, check})` borrows the existing Frame GPUDevice. It creates no device and has no CPU production fallback. The default one-step operation is explicit; nothing runs during ordinary Play or navigation.

Input fields:

- `dimensions`: three integer cell counts; at most 4096 cells in this experiment.
- `cellSize`: three positive lengths in metres.
- `conductivity`: one value or one positive W/(m K) value per cell.
- `heatCapacity`: one value or one positive volumetric J/(m3 K) value per cell.
- `initialKelvin`: one initial 1..2000 K temperature per cell.
- `boundaryKelvin`: explicit whole-face Dirichlet temperatures using xMin/xMax/yMin/yMax/zMin/zMax. An explicit empty object means insulation. Half-cell boundary distances and reciprocal harmonic interior conductances are preserved.
- `timeStep`: positive seconds. At most ten steps and 0.1 seconds total.
- `heaters`: one to 64 objects with `cells` and `curve`. Each curve has two to 128 strictly temperature-ordered points. Its endpoint temperatures must cover every sampled and completed heater mean. No endpoint clamp or extrapolation is invented.
- Optional `tolerance` in 1e-6..1e-4 K and `maxIterations` in 1..20000 are internal experimental inputs, not interface controls.

The pure `snapshotPowerCurve`, `powerAtTemperature`, `snapshotHeatedConduction` and `assembleHeaterPowerStep` seams support inspection/tests. The public planner accepts an optional dense ordinary temperature array and snapshots it before use. Raw descriptors, hidden/unknown properties, getters, inherited values and sparse arrays are rejected without invoking authored callbacks. This is a plain-data boundary, not a sandbox for arbitrary Proxy traps.

The returned runtime-only result contains Kelvin temperatures, per-step sampled heater watts, signed source/boundary energies, global balance and explicit precision diagnostics. There is no native cache, serialization, continuation handle or scene ownership inference. Caller input is privately copied before awaits. Cancellation, a changed shared device, device loss or a failed caller-currentness check prevent publication and retire owned buffers. GPU error scopes close within the same synchronous turn.

## Precision and energy interpretation

Every actual cell must satisfy the original heat equation within 0.001 K of storage-normalized residual. Every active source cell retains the separate 0.001-relative source-power check plus a reported numerical roundoff floor. Float32 RHS upload must resolve each nonzero source. Silent density underflow and overflow are rejected. Nonzero subnormal Float32 coefficient/account/initial uploads are rejected by the heater layer without changing the reused backend.

Global balance reports distinct allowances:

- `physicalDriveAllowanceJ`: 0.001 times absolute heater energy plus absolute net boundary energy per cell. Opposed prescribed faces of one cell cancel before that boundary magnitude is summed; this is not a gross per-face wall-power diagnostic.
- `precisionAllowanceJ`: original-versus-uploaded matrix defect at the actual returned field, uploaded diagonal times requested solver tolerance, a conservative gamma32 arithmetic bound, possible flush-to-zero intermediates, Celsius/Kelvin readback conversion and Float64 summation roundoff.
- `precisionLimited`: the precision allowance exceeds the physical-drive allowance. A zero-drive case can therefore complete with explicitly precision-limited tiny energy drift; it is not declared exactly energy-conserving.
- `netSourceCancellationResolved`: only compares signed heater energy with gross heater energy. It does not establish accuracy against a heat bath or storage flux.
- `sourceEnergyAbovePrecisionFloor`: explicitly reports whether the signed source exceeds the precision allowance. A false value is not a resolved physical heater response, even when the equations pass their consistency gates.

These are consistency and representability checks, not a physical accuracy guarantee. No acceptance tolerance was loosened in the independent original per-cell or source-cell gates to accommodate the precision accounting. The CPU command emulator checks orchestration/resource lifecycle; its intermediate arithmetic is not a WGSL Float32 oracle.

## Reuse and provenance

`conduction.js` extracts the existing backend body from the earlier unregistered Thermal `numerical.js`, from MAX_CELLS through the end of solveConductionGPU. Assembly, coefficients, WGSL, GPU iterations, readback and cleanup are byte-identical. Only unrelated scene/native imports and activation are omitted. The physical-frame validator is imported from the unchanged installed Thermal helper. `exterior-film.js` and the shared-device-state helper are reused; this heater API does not expose Robin film conditions. `BACKEND-PROVENANCE.json` identifies the exact extracted body and dependency hashes.

No CFD/Aero dependency exists. This stage does not implement fluid advection, natural convection, moving material, radiation, phase change, variable material properties, arbitrary geometry classification, adaptive meshing, automatic resource sizing, steady solving, animation cache, native Heater authoring or installed Solve. The 4096-cell and duration bounds qualify an experiment, not the eventual user's mesh or VRAM policy.

## Verification

Run from the repository root:

- `node --test experiments/thermal/tests/heater-power.mjs`
- `node experiments/thermal/tests/heater-power-browser.mjs`
- `npm test -- --headless`

The dedicated hardware harness uses a new headless browser context and the actual borrowed Frame device's adapter identity. It records exact source hashes before/after, checks temperature-feedback and signed/zero drives, tests 4096 cells, asserts completed-operation latency, and counts every owned Thermal GPU buffer's destruction. It does not access the user's scene, browser profile, windows or printing. Source changes invalidate older hardware evidence.

The focused suite does not qualify the full native numerical chain or installed Thermal. Full application stress/large-scene qualification and future native integration remain separate gates. Publishing these source files alone does not register or enable the numerical runtime.
