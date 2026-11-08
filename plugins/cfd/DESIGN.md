# CFD design alignment

The current design is the revised 1 November 2026 specification, not the earlier
steady-only version. Source:
https://chatgpt.com/c/6ae71311-9158-83ea-876f-3a1bd5f07a7b?messageId=0337720f-3fa3-4358-a793-40dc7e563e1b
The preceding explicit user corrections are:
https://chatgpt.com/c/6ae71311-9158-83ea-876f-3a1bd5f07a7b?messageId=e089044f-75fc-47b9-82a2-4434c15fe3ac

## Required production behavior, not current capabilities

- Independent CFD box objects; all evaluated geometry within the box participates,
  including partial intersections. No manual source selection or semantic tags.
- Flow travels from one side plane to its opposite, independent of pivot position.
  Default speed is 20 m/s; normal Frame transforms and animation remain native.
- Actual triangle geometry defines boundaries; imported normals are not physics.
- Arbitrary ordinary animation supplies physical boundary position and velocity.
  Rotors are not isolated steady poses. Internal physical timesteps differ from
  render samples; flow history and fluid/solid transition recovery are required.
- Preferred production engine: D3Q27 Cumulant, WALE/WMLES, pressure-gradient-aware
  wall treatment, moving cut-links and block AMR. BGK is reference-only.
- GPU limits and usable memory determine resolution and block/cache budgets;
  there is no fixed 8 GB GPU requirement or fixed 5 GB solver cap.
- Machine-readable AI operations/results are mandatory. Results and Force only
  appear for a valid completed state; Play does not initiate heavy solves.
- Reuse Frame scene GPU resources, animation, Curves, lifecycle and render waits.
  No private scene graph, permanent CPU triangle mirror or separate graph UI.

## Geometry milestone

Sections 38, 42 and 43 require time-dependent cut-link position, geometric normal,
wall velocity and source identity. `cut-links.mjs` provides a small independent
Float64 oracle for those quantities. It samples triangles and instantaneous
vertex velocities at the exact requested physical time, then computes segment
intersection and barycentric wall velocity. It deliberately does not freeze a
missing velocity to zero or infer a propeller from a name.

It operates on explicit CPU fixtures only. It is not the production scene data
path, a manifold/occupancy certificate, a moving-cell refill method, or a boundary
condition coupled to the LBM reference. Ambiguous links are unavailable rather
than being silently assigned an arbitrary surface.

## Next integration gates

1. Obtain native evaluated geometry through the shared scene capture/volume API;
   support buffer and paged storage without a CPU mirror. Confirm current shared
   animation sampling capabilities for position and instantaneous velocity.
2. Implement GPU acceleration/cut-link construction and compare distances,
   geometric normals, source mapping and velocities against this oracle, including
   rotations, nonuniform transforms, deformation and clipped domains.
3. Establish fluid/solid occupancy and explicit ambiguous/open/degenerate geometry
   treatment. Couple moving cut-links and newly exposed cell recovery to a
   conservative solver. Validate mass, momentum, force and torque independently.
4. Validate production collision/turbulence/AMR, SI scaling, inlet/outlet/road
   conditions and scene-result readiness before installing a scene solver.

None of these gates is satisfied by a successful CPU geometry test alone.

## Observed shared API gap

In this isolated checkout the plugin bridge (`index.html`, `activate` context)
exposes `scene.capture(hash, keys)` for the currently evaluated GPU geometry.
It has neither a physical-time argument nor instantaneous per-vertex velocities.
The production transient adapter therefore needs a shared evaluator contract for
time-sampled positions and velocities, with native buffer/paged storage, rigid
and deforming sources, stable provenance and ownership/stale checks. It must
not silently substitute zero motion, read back a permanent CPU mirror, or mutate
the user's visible timeline just to sample an internal CFD timestep. This is a
required core integration step, not a capability provided by the oracle.
