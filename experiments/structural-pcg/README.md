# Structural GPU PCG research checkpoint

## Local lifecycle continuation (2026-11-09)

The current local candidate extends the saved checkpoint with serialized bounded diagnostic reads, scoped diagnostic allocation/copy errors, and one shared disposal promise. Disposal waits for pending run/read cleanup; late or stale readbacks never escape. The numerical WGSL and preserved Hex8 reference are unchanged. See LIFECYCLE-QUALIFICATION.json and tests/lifecycle.mjs for the new CPU-only evidence. The hardware report and QUALIFICATION.md below describe the original saved source hashes, not this modified candidate. A coordinated current-source hardware gate and shared release tests remain pending; this candidate is not published or installed.

CPU lifecycle regression command:

    node --test experiments/structural-pcg/tests/validation.mjs experiments/structural-pcg/tests/lifecycle.mjs

Known admission limitation retained: the rigid-mode rank guard can conservatively reject extremely anisotropic fully constrained grids (for example spacing [1,1e-11,1e-11]). This follow-up does not relax numerical admission or claim production-scale conditioning.

This is an independent, explicitly started numerical component, not the installed Structural solver. The live Structural plugin remains an under-construction authoring preview. No plugin, catalogue, core file, UI, native scene, or HASH format is changed by this checkpoint.

## New work

- Full-integration trilinear Hex8 matrix-free stiffness action, Jacobi-preconditioned conjugate gradients and all iteration vectors/scalars remain on the shared Frame GPUDevice. No global stiffness matrix and no CPU iteration vector are assembled.
- Prescribed nodal displacements enter the reduced right-hand side. Constrained directions stay projected out of the iteration.
- Each face-connected material component must have six constrained rigid modes. Canonical topology, active nodes, local stiffness and diagonal are reconstructed and verified before device access. Edge/point-only joins are rejected rather than silently welded.
- Recursive convergence is only a candidate. A separate GPU action recomputes the equation residual before a converged result can be inspected. Failed convergence, invalid floating-point range, stale ownership, cancellation, loss and disposal cannot expose a current displacement result.
- CPU control reads one 48-byte scalar checkpoint per batch, normally every eight or sixteen iterations. Explicit diagnostic displacement reads are limited to 256 DOFs per call; packed storage makes that at most 4096 bytes. Normal iteration performs no displacement readback.
- Scoped WebGPU validation/allocation errors, a host progress bound and a nonadvancing-checkpoint guard prevent an ignored GPU command from becoming an unbounded loop.

## Explicit input and capacity

Input is an authored, fully resolved rectangular SI Hex8 grid created by the included reference module, explicit total nodal loads in N and prescribed displacement constraints in metres. At most 32768 cells, 32 materials and 10000 iterations are admitted, subject to actual device buffer/workgroup limits. Float32 tolerance must be selected explicitly within 1e-7..1e-2; that range is an admission limit, not a promise that a particular problem reaches it. Bad conditioning can hit the iteration limit or floating-point floor. The included canonical Float64 Hex8 implementation is an unchanged preserved reference, not the GPU solver.

The matrix-free operator integrates each element at eight Gauss points and uses the engineering shear convention [xx, yy, zz, xy, yz, xz]. Isotropic linear elasticity and small strain apply. The operator uses one GPU work item per DOF and gathers incident element contributions without float atomics.

## Qualification

See QUALIFICATION.md and tests/results/hardware.json. Tests use Frame's actual GPUDevice in a new headless browser, never the user's working scene or OS pointer. They include independent analytical uniaxial displacement F L / (E A), Poisson contraction, stress and reaction, refinement with the same 1000 N force, multi-material bending versus a Float64 equation, nonzero prescribed motion, one-iteration failure, stale/cancelled jobs, and Float32 overflow/underflow failure.

A multi-material thin bending case exposes a real current limitation: Jacobi and Float32 exact-residual restarts can approach the numerical floor slowly. Its measured iteration count is recorded, not hidden behind an analytical tension success.

## Not implemented or qualified here

There is no general-scene geometry capture, clipping/dirty-geometry voxelizer, Material/Force tag bridge, torque-region mapping, fixture-volume weld mapping, sliding contact, animation load cases, GPU stress display, topology optimization or Result to Object. Authored boundary conditions in a numerical fixture are not collected user Fixture/Force tags. No derived numerical data is added to HASH. No public Solve endpoint or button is enabled. GPU device-loss injection, out-of-memory on physical hardware, large-scene performance, near-incompressibility and large-scale preconditioning remain unqualified. Failure paths use separate CPU command emulators where named.

## Run in a Frame checkout

Overlay the archive's experiments/structural-pcg directory into a Frame checkout with its existing pinned development dependencies. The source archive is not a rebuilt standalone Frame application.

CPU admission/command-emulator tests:

    node --test experiments/structural-pcg/tests/validation.mjs

Isolated actual-hardware component gate, always headless:

    node experiments/structural-pcg/tests/hardware.mjs

Do not run concurrent GPU suites. The hardware harness requires the checkout's tools/browser.mjs and Playwright installation, an identifiable non-fallback physical adapter, and nvidia-smi for the independent NVIDIA identity check. It never silently selects a software adapter. Reports bind exact source hashes. Full npm test, stress, DPR2, offline and 100M-triangle suites are separate gates and are not claimed by this component checkpoint.

## Provenance

The numerical reference is copied unchanged from the preserved Structural research's solver.js. Its SHA-256 is a7fd55e54ae7130bb8297e7829d6715cc3ef1794e58b09421925c4ce245ede8d. The complete original structural.txt was reviewed, including its opening correction to use Safety factor. The original concept is not added to this source overlay. Existing occupancy/load/contact/topology prototypes were reviewed but are neither imported by this module nor reinstalled.
