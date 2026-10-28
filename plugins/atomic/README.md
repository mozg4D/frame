# Atomic

Native Frame integration of the supplied Atomic_sim_r47 (1).html. Runtime is one plugin.js, including compressed NEP89-1 weights, NEP4/ZBL WGSL, Gaussian SQE charge diagnostic and the original embedded license. provenance.json pins the supplied source and model digests. No runtime build, CDN or extra GPUDevice is required.

Create Atomic from Plugins, choose an element and click in a viewport. Elements toggles a shared transparent periodic table of all 75 supported species in the active viewport. Present species have native colored material rows inside Atomic; clicking a row opens the Material Editor. Escape exits placement. Select atoms with click, Shift/Ctrl or Alt marquee; selection pauses physics. Use the normal Frame gizmo and Coordinate Manager. A selected atom highlights its element. Right-click selected atoms for Fixed, Velocity or Force. Named selections appear in the ordinary Browser and support nesting and material tags.

Internal units are angstroms, femtoseconds, eV and amu; Temperature is Celsius. Velocity uses local XYZ components in angstrom/fs, applied once at initialization. Force uses local XYZ components in eV/angstrom; Speed limit is angstrom/fs. Damping retains the r47 integrator parameter. Fixed atom positions follow their authored/animated Frame selections and still contribute to interactions. Only Fixed internal selections permit PSR animation. Atomic object transforms never change physical coordinates.

Store State saves positions. Restore State requires unchanged stable IDs, resets velocity/clock/derived buffers and reproduces the same initialization. The timeline is fixed at 60 fps. Time scale (fs/s) determines physical time per timeline second; each frame advances Time scale / 60 fs using stable internal substeps. The common timeline Play waits for every enabled world before advancing another frame, slowing the entire animation when necessary. Pause drains the current frame. Each world keeps its own Time scale. There is no independent Atomic Play. Choose Camera Renderer = Viewport to include Atomic in image/video output. The normal path tracer does not trace Atomic impostors.

Charge color retains the original diagnostic with its 32768-atom limit. It is not an extra electrostatic force model. Fixed, Velocity and Force materials override species material colors; owner emission uses a cheap shared shader. Opacity, textures, roughness and individual material pipelines are omitted. Material does not change species or forces.

Detached selections become ordinary 20-triangle sphere instances. Large detached sets use a compact native instance group using the common Browser child limit and red plus; explicit exports expand occurrences when needed. Ordinary objects placed inside Atomic are ignored by physics.

## Automation

```js
const {hash} = await frameAI.call('plugins.create', {plugin:'atomic'});
await frameAI.call('plugins.describe', {plugin:'atomic'}); // Full validated schemas.
const atomic = (operation,args={}) =>
  frameAI.call('plugins.command', {id:hash,operation,args});
await atomic('create-molecule', {name:'water'});
await atomic('settings', {Temperature:20,Damping:1,'Time scale':60});
await atomic('store-state');
await atomic('step', {timeFs:0.73});
await atomic('inspect', {count:3,runtime:true,forces:true});
await atomic('restore-state');
await frameAI.call('animation.play');
await frameAI.call('animation.pause');
```

Operations: status, inspect, visualization, create-atoms, delete-atoms, set-species, select-atoms, transform-atoms, create-selection, selection, store-state, restore-state, settings, step, add-mode, create-molecule and create-crystal. Structure positions are local angstroms. Stable IDs start at one and survive deletion/reordering. Inspect is bounded to 4096 atoms. Named selection and whole-object lifecycle also use normal scene commands. Errors remain available through automation, never Attributes.

## Verification

Run from the repository root on real hardware WebGPU:

```sh
npm run test:atomic
npm run test:atomic:performance
npm test
npm run test:stress
```

Standard/stress discover tests/index.mjs. Focused coverage includes palette dimensions, native icon, component UI/history, independent worlds, HASH, materials/shared depth, Fixed animation, Velocity/Force, detachment/export and exact offline time. Eight original-r47 reference cases compare GPU force and energy values (water, H2, methane, Si/C diamond, Cu FCC, Fe BCC and close-pair ZBL). nep-reference.json records the input provenance and expected values. generate-reference.mjs is an optional developer helper requiring the original supplied HTML; normal verification uses the checked-in reference.

The million-atom performance command measures paused display, selection, component edits, full selection rotation, object movement, named selection creation, native detachment and exact Undo/Redo samples under the 256 MiB history budget. It records operation latency, native CPU/GPU frame times, source digests and GPU errors in ignored tests/results/atomic-performance.json. It does not measure million-atom physical simulation throughput. The focused report is tests/results/atomic.json; standard/stress bind source digests in tests/results/latest.json.

## Previous validated baseline (2026-10-26)

On native NVIDIA Ampere WebGPU, standard and DPR-2 stress passed 5141 / 5141 assertions; the 100548288-triangle renderer benchmark passed 43 checks. The 63 focused Atomic checks and million-atom preview/edit/detachment/history run used visible Chromium. Full suites used headless hardware Chromium to isolate the OS pointer; no software adapter was used. Reports contain no JS/WebGPU errors or device loss/replacement.

The million-atom run created the structure in 1.44 s, rotated all atoms in 1.13 s, created a named selection in 1.71 s and detached it in 1.76 s. Whole-object movement took 1.5 ms and preserved internal coordinates. Detach Undo/Redo also passed. The complete history used 217.4 MiB of the 256 MiB limit. These are local fixture/device measurements, not million-atom physical simulation throughput.

Validated index SHA-256: 3843af09e6d94430470c05061142e002b70fab7886c7a487d1f7bd0e812c2f0c; Atomic SHA-256: e4d428dc6b3df557ca1befbafa25ea2d20f6604ec32866b69e4dbf68c086cfd8. Ignored tests/results/atomic-acceptance.json binds the reports and source hashes.

Plain left drags away from the gizmo navigate while preserving selected atoms. Ctrl-copy and all transformations use the native gizmo. Scale changes atom centers, never radii; one atom uses the reduced move gizmo and Fixed retains full controls. Placement in orthographic views intersects the actual grid plane; rounding follows Quantization. Store/restore share one state row and Restore enables after a valid store. Unknown nested objects and detached content are ignored; moving between Atomic objects is allowed.

## Revision validation (2026-10-27)

Native NVIDIA Turing WebGPU: 90 focused Atomic checks pass. Standard and DPR-2 stress each pass 5168 assertions, with no JS/console/WebGPU errors or lost/replaced device. The unchanged 100548288-triangle fixture passes 43 rendering/editor checks. The million-atom preview/edit benchmark passes creation, selection, center transforms, native detachment and exact Undo/Redo; create/full rotation/detach complete in 2.08/1.50/3.74 seconds, and history uses 217.5 MiB of its 256 MiB limit. These are local fixture measurements, not physical simulation throughput.

Runtime SHA-256: 27ba8da240dcf34ef7d1680385b5b336ad36fd2421645af23c2aea8464c32c9e. Atomic SHA-256: 2f010d85b9fa7903b4b0ea7ce68b489c654f56066a5453e9bbe1f99cd9182047. Ignored tests/results/atomic-acceptance.json binds the passing reports to final staged bytes. The model/NEP kernel prefix remains byte-identical to the incoming revision.


October 27 interaction update: the final table row combines supported rare-earth species and Ac; its active element is a pressed button. Placement ends on Escape, right click or another editing action, and survives navigation. Named Force/Velocity clicks open Attributes. Restore preserves the current playback mode. Detached appearances belong to groups, including separate groups for mixed colors. Display data remains visible while derived state updates.

The reproducible gallery is `tests/scenes/atomic-mega.hash` (see `tests/scenes/atomic-mega.md`). Run `node tests/atomic-mega.mjs`, `node plugins/atomic/tests/physics.mjs`, and the standard Atomic performance runner for scene, solver and million-atom edit measurements respectively. These measure different workloads.

### Moving clamp and impact example

Open `tests/scenes/atomic-tube-impact.hash`. The orange Fixed clamp moves 1 angstrom and returns over frames 0-240; the green tip receives a continuous +X force. The gold diamond starts with -X Velocity and collides with the tube. All components share one Atomic world. Use timeline Play; native 60 fps video output advances 2 fs between frames at Time scale 120 fs/s. Frame zero is the initial state. The reproducible generator checks clamp motion, mobile response and projectile deceleration before exporting H.264 video.

Green Browser points control computation on Atomic, Fixed, Force and Velocity only. Disabling a world freezes positions, velocities and its physical clock without hiding it or catching up later. Disabling Fixed releases its atoms; re-enabling anchors their current positions and subsequent clamp animation continues from there. Force stops contributing without clearing acquired velocity. Velocity is a one-time initialization source: enabling it mid-run does not inject an impulse. Red points affect visibility only, including species/membership rows, never forces or computation. Separate worlds do not interact.

Scrubbing evaluates animation and enabled Fixed positions without integrating or rewinding physics. Restore resets stored positions, velocity and physical clock. Video output resets enabled worlds to stored positions (or the initial runtime authoring positions), evaluates frame zero without stepping, and computes every interval sequentially from zero, including preroll before a nonzero output start. Still output captures the current state without advancing. Simulation playback stops at the timeline end; it cannot loop an uncached physical history. The path tracer does not include Atomic impostors; choose Viewport for Atomic exports.

Run `node plugins/atomic/tests/million-physics.mjs` for the separate real million-atom initialization/step benchmark (up to 90 s initialization and 60 s per measured interval; several GiB of GPU memory). Standard tests retain the compact million-atom preview benchmark.

The [impact example guide](../../tests/scenes/atomic-tube-impact.md) describes controls, units and validation; [rendered MP4](../../tests/scenes/atomic-tube-impact.mp4).

### Throughput and interruption

For 8192+ atoms the solver profiles its existing serial/cooperative kernels and uses the measured faster paths. The shared timeline owns display cadence and exact physical intervals. GPU work packets target 8 ms, with two queued packets for fast steps and up to eight when a physical step already exceeds one display period. Pause interrupts scheduling immediately and drains the current multi-world frame. The NEP model, descriptor/energy math, stable timestep bounds and offline physical intervals are unchanged.

`status` exposes `kernelModes`, `kernelProfiles`, `packetBudgetMs`, `maxQueuedPackets`, and `queueWaits`. Force inspection evaluates pending constraint changes first. `npm run test:atomic:comparison -- --original path/to/Atomic_sim_r47.html [--output report.json]` measures the original unmodified file and Frame on the same GPU/browser; five samples follow 41 warmup steps in each of two ABBA trials. Native Play is measured independently: the original uses its 10 fps display target; Frame uses its 60 fps timeline and Time scale 30 fs/s. Performance acceptance permits at most 5% measurement tolerance relative to the original. Initialization is reported but not used as a cold-start comparison because the applications initialize their solvers at different times.
