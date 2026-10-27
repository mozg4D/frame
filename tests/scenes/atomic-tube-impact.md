# Moving nanotube clamp and diamond impact

Open `atomic-tube-impact.hash`; the rendered result is `atomic-tube-impact.mp4`.

- Orange: bottom nanotube rings held by a Fixed selection. Their native Position track moves +1 angstrom along X at frame 60, then returns at frame 120.
- Green: free tip with continuous Force X = 0.025 eV/angstrom and a 0.02 angstrom/fs speed cap.
- Gold: 64-atom diamond crystal launched with Velocity X = -0.045 angstrom/fs.
- Blue: mobile carbon nanotube atoms.

All 640 atoms share one Atomic world. Interactive use requires both Atomic Play and timeline Play. For reproducible physical timing, export the 0–120 range with the stored Viewport camera: 960x720, 30 fps, 4 fs per frame (484 fs including frame zero). Temperature is absolute zero and damping is 0.01. Target FPS is 10.

Run `node tests/scenes/generate-atomic-impact.mjs` to rebuild the scene, validate physical response and render H.264. Set FRAME_ATOMIC_OUTPUT to choose an output directory. The generator checks moving-clamp displacement, mobile-tube response, projectile deceleration/reversal, finite state, output physical time and WebGPU errors. It records final atom-position differences between the manual run and export; equality after the nonlinear collision is not asserted. The exported trajectory is checked independently against the expected physical outcomes.

Store/Restore concerns positions and resets the physical clock/velocities; the named Velocity selection initializes the projectile again on the next physical advance. Keep every interacting structure within this one Atomic owner; separate owners do not interact.
