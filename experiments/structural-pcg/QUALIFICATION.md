# Local lifecycle candidate: not hardware qualified

The current source is CPU-qualified only; see LIFECYCLE-QUALIFICATION.json. The hardware harness now includes four additional lifecycle checks, but has not been run on the candidate. No main publication or installed solver is claimed.

The text below is historical qualification for the saved original source hash 68ad2fdc0b0c8d7ba7263e3bbb30b5fe1d89ae2b7732084467746e55a7d4be03. Its old hardware report is retained under tests/results/hardware.json for provenance, not as qualification of this candidate.

---

# Structural GPU PCG qualification

Date: 2026-11-09T07:29:15.935688+00:00

Scope: an uninstalled GPU numerical component on authored resolved grids. sceneSolved=false and analysisReady=false remain explicit. This is not Stage 1 scene voxelization or a complete Structural release.

## Final-payload checks

- 17/17 CPU admission, canonical topology, rigid-mode, command-emulator, resource cleanup and stale-result tests passed, with zero skipped tests.
- 18 actual-hardware numerical/ownership/failure checks and 4 hardware/scene/error checks passed in an isolated headless Frame browser.
- Physical GPU: NVIDIA GeForce RTX 3060, 610.47, 12288 MiB. WebGPU metadata: nvidia/ampere, isFallbackAdapter=false. Shared Frame GPUDevice was retained; no new device was requested by the component.
- No WebGPU validation or uncaptured error, lost device, page error or native authoring-scene mutation was observed. The owned browser closed after the final gate.
- Every successful GPU solve was accepted only after a fresh GPU equation-residual check. Failed solves did not expose displacement inspection.

## Independent analytical tension

All three grids represent a 0.2 m by 0.04 m by 0.04 m bar with E=210 GPa, nu=0.3 and the same total 1000 N load. Analytic axial displacement is F L / (E A); transverse displacement follows Poisson contraction. Stress, reaction and the original Float64 equation residual are independently checked from the returned GPU diagnostic displacement. Stress postprocessing in this fixture is an oracle, not an installed GPU stress kernel.

- tension 4x1x1: 13 iterations, 5.500 ms run time, 1.51767e-05 exact GPU relative residual, maximum relative displacement error 3.98106e-06, stress error 5.6511e-06, 192 scalar bytes read, 4384 owned buffer bytes. Timing excludes construction/compilation; each complete construction/run/oracle check also passed a 15 s bound.
- tension 8x2x2: 27 iterations, 13.200 ms run time, 1.46211e-05 exact GPU relative residual, maximum relative displacement error 2.01516e-06, stress error 4.51561e-06, 288 scalar bytes read, 10352 owned buffer bytes. Timing excludes construction/compilation; each complete construction/run/oracle check also passed a 15 s bound.
- tension 16x4x4: 54 iterations, 24.800 ms run time, 1.23586e-05 exact GPU relative residual, maximum relative displacement error 6.36849e-06, stress error 1.15124e-05, 528 scalar bytes read, 44272 owned buffer bytes. Timing excludes construction/compilation; each complete construction/run/oracle check also passed a 15 s bound.

## Other numerical and failure gates

- A two-material thin bending fixture agrees with the Float64 equation: relative displacement difference 1.42794e-05. GPU convergence took 1497 iterations and 879.700 ms at tolerance 2e-5, below the explicit 10 s limit. This high iteration count is a measured Float32/Jacobi limitation near the residual floor, not evidence of production-scale performance.
- Nonzero prescribed rigid translation enters the projected RHS and reproduces uniform translation. This does not collect a native Fixture volume.
- One-iteration exhaustion, mid-await stale ownership, cancellation and Float32 overflow/underflow fail explicitly without exposing a converged result.
- CPU command emulators cover ignored/nonadvancing GPU work and asynchronous allocation errors. They are not physical device-loss or physical out-of-memory tests.

## Source binding and environment

- Frozen Frame index SHA-256: 249e38310644ac9deaa2ca753d121674adcbdd3319bd2e64a0dbca229b7334c5. The copied Frame core was not edited by this task. Current-main publication of this experimental delta is a separate coordinated operation.
- gpu-pcg.js SHA-256: 68ad2fdc0b0c8d7ba7263e3bbb30b5fe1d89ae2b7732084467746e55a7d4be03.
- Unchanged preserved Hex8 reference SHA-256: a7fd55e54ae7130bb8297e7829d6715cc3ef1794e58b09421925c4ce245ede8d.
- Hardware harness SHA-256: 24775ac50860ba555abb5e7c804aa5aa729f397b77a4b562c0a361cce223a66c.
- Local executor Node version was v21.6.1. Frame declares Node >=22; a Node22/full shared-suite qualification was not performed by this bounded component run. Browser/Playwright came from the existing pinned Frame lab installation.
- The supplied full structural.txt concept was reviewed. Its source SHA-256 is ddeb86d386b72bd327f3b515379c12cb7543cf338d8a9c5bd973147e4219b34d. The original concept is not copied into the publication delta.

## Unrun and excluded

Full npm test, stress, DPR2, offline/PWA, 100M-triangle and large-structural-grid suites were not run and are not counted as passes. General scene clipping/voxelization, tag-to-load mapping, torque application, fixture volume mapping, contact, animation, optimization, result visualization and Result to Object remain outside this component. No public Solve is enabled, no existing preview/runtime file is changed, and no numerical state is serialized.
