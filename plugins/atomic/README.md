# Atomic

Native Frame integration of the supplied Atomic_sim_r47 (1).html. Runtime is one plugin.js, including compressed NEP89-1 weights, NEP4/ZBL WGSL, Gaussian SQE charge diagnostic and the original embedded license. provenance.json pins the supplied source and model digests. No runtime build, CDN or extra GPUDevice is required.

Create Atomic from Plugins, choose an element and click in a viewport. Attributes includes all 75 supported elements in uniform rows under Common, Semiconductors, Metals, Gases and Other. Escape exits placement. Select atoms with click, Shift/Ctrl or Alt marquee; selection pauses physics. Use the normal Frame gizmo and Coordinate Manager. A selected atom highlights its element. Right-click selected atoms for Fixed, Velocity or Force. Named selections appear in the ordinary Browser and support nesting and material tags.

Internal units are angstroms, femtoseconds, eV and amu; Temperature is Celsius. Velocity is angstrom/fs along the selection pivot's X axis, applied once at initialization. Force is eV/angstrom along pivot X; Speed limit is angstrom/fs. Damping retains the r47 integrator parameter. Fixed atom positions follow their authored/animated Frame selections and still contribute to interactions. Only Fixed internal selections permit PSR animation. Atomic object transforms never change physical coordinates.

Store State saves positions. Restore State requires unchanged stable IDs, resets velocity/clock/derived buffers and reproduces the same initialization. Interactive Target FPS adjusts work scheduling. Fixed Time determines the exact physical interval per offline output frame, split into stable integration substeps; hardware speed does not change this interval. Choose Camera Renderer = Viewport to include Atomic in image/video output. The normal path tracer does not trace Atomic impostors.

Charge color retains the original diagnostic with its 32768-atom limit. It is not an extra electrostatic force model. Material color overrides element color for assigned selections; owner emission uses a cheap shared shader. Opacity, textures, roughness and individual material pipelines are omitted. Material does not change species or forces.

Detached selections become ordinary 20-triangle sphere instances. Large detached sets use a compact native instance group with an inert Browser plus; explicit exports expand occurrences when needed. Ordinary objects placed inside Atomic are ignored by physics.

## Automation

```js
const {hash} = await frameAI.call('plugins.create', {plugin:'atomic'});
await frameAI.call('plugins.describe', {plugin:'atomic'}); // Full validated schemas.
const atomic = (operation,args={}) =>
  frameAI.call('plugins.command', {id:hash,operation,args});
await atomic('create-molecule', {name:'water'});
await atomic('settings', {Temperature:20,Damping:1,'Fixed Time':1});
await atomic('store-state');
await atomic('step', {timeFs:0.73});
await atomic('inspect', {count:3,runtime:true,forces:true});
await atomic('restore-state');
```

Operations: status, inspect, visualization, create-atoms, delete-atoms, set-species, select-atoms, transform-atoms, create-selection, selection, play, pause, toggle-play, store-state, restore-state, settings, step, add-mode, create-molecule and create-crystal. Structure positions are local angstroms. Stable IDs start at one and survive deletion/reordering. Inspect is bounded to 4096 atoms. Named selection and whole-object lifecycle also use normal scene commands. Errors remain available through automation, never Attributes.

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

## Verified local run

On native NVIDIA Ampere WebGPU, standard and DPR-2 stress passed 5141 / 5141 assertions; the 100548288-triangle renderer benchmark passed 43 checks. The 63 focused Atomic checks and million-atom preview/edit/detachment/history run used visible Chromium. Full suites used headless hardware Chromium to isolate the OS pointer; no software adapter was used. Reports contain no JS/WebGPU errors or device loss/replacement.

The million-atom run created the structure in 1.44 s, rotated all atoms in 1.13 s, created a named selection in 1.71 s and detached it in 1.76 s. Whole-object movement took 1.5 ms and preserved internal coordinates. Detach Undo/Redo also passed. The complete history used 217.4 MiB of the 256 MiB limit. These are local fixture/device measurements, not million-atom physical simulation throughput.

Validated index SHA-256: 3843af09e6d94430470c05061142e002b70fab7886c7a487d1f7bd0e812c2f0c; Atomic SHA-256: e4d428dc6b3df557ca1befbafa25ea2d20f6604ec32866b69e4dbf68c086cfd8. Ignored tests/results/atomic-acceptance.json binds the reports and source hashes.
