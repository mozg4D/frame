# Atomic: A million possibilities

Open `atomic-mega.hash` in Frame. It contains **1,048,670 atoms in 12 independent worlds**, a front-facing gallery, native text labels, a 1920 x 1080 Viewport camera, stored initial states, and a 0–120 frame animation.

| Exhibit | Atoms | Features |
| --- | ---: | --- |
| Element spectrum | 75 | Every supported NEP species |
| Molecular playground | 51 | Water, hydrogen, CO2, methane and benzene |
| Crystal collection | 896 | Cu FCC, Fe BCC, Si diamond |
| Carbon nanotubes | 3,840 | Two radii, open-ended honeycomb tubes |
| Graphene nanosheet | 3,944 | Carbon honeycomb, fixed edge |
| Bilayer boron nitride | 1,728 | B/N honeycomb, 3.35 angstrom spacing |
| Animated nanogrip | 704 | Fixed end and animated pulling grip |
| Force-driven copper | 448 | Fixed base, continuous Force X and speed cap |
| Velocity collision | 216 | Two gold clusters with opposing initial velocities |
| 32,768 atoms in motion | 32,768 | FCC copper with a named Velocity owner |
| One million atom diamond | 1,000,000 | Compact editable display benchmark |
| Multiwall nanotube | 4,000 | Concentric tubes and an animated Fixed ring |

Select an Atomic owner and press Play to simulate it. Worlds are independent. Select Force/Velocity children to edit vectors. Scrub frames 0–120 to see Fixed grips move. Restore resets the stored positions and clock while preserving playback. All demo coordinates are in angstroms and times in femtoseconds; Frame object transforms only arrange/scale the exhibits for presentation.

The two largest worlds have **Fixed Time = 0** for camera export. This keeps the million-atom sample as a rendering/editing exhibit and avoids scheduling its NEP initialization. A zero interval does no physical work. Play on the 32,768-atom copper world is a real NEP simulation; the million-atom preview is not a physics-throughput claim. These are idealized educational structures, not validated experimental trajectories or universal chemistry predictions.

Rebuild: `node tests/scenes/generate-atomic-mega.mjs` (headless real WebGPU). Validate opening, four views, physical states, Fixed animation and native camera export: `node tests/atomic-mega.mjs`. Solver throughput: `node plugins/atomic/tests/physics.mjs`. Million-atom edit/history performance: `npm run test:atomic:performance -- --headless`. Reports are under ignored `tests/results/` and identify runtime/plugin/scene hashes.
