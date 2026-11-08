# CFD native authoring preview

CFD is under construction. This preview lets you author independent native CFD box objects; it does not solve fluid flow or provide engineering results.

## Working authoring

The lazy Plugins entry creates a normal CFD scene object. Speed defaults to 20 m/s; Medium cycles Air/Water, Altitude is in metres and Ground cycles None/Road. Values remain ordinary scene parameters and use native Attributes, shared field authoring, animation, transforms, duplicate, Undo and HASH. No second scene graph or stored runtime result is used.

The helper is a 1000 mm local box, from (-500,0,-500) to (500,1000,500), with its initial pivot at the lower corner (-500,0,-500). A straight arrow travels across the box from the local -X face to the opposite +X face at its mid-height. It shows authored direction, not a calculated streamline. Moving the pivot does not redefine the face-to-face axis. Rotate/scale the ordinary object to place the box. Multiple overlapping boxes remain independent.

Medium, Altitude and Ground record requested future physics only. They currently change no density, flow or road boundary. The disabled Under construction notice is always visible in Attributes. Result/Force/Flow lines and Solve buttons are intentionally absent until real completed results exist.

## Machine-readable API

Discover the native type with plugins.list and plugins.describe {plugin:'cfd'}. Create with plugins.create {plugin:'cfd'}. The shared scene.update/fields.write authoring paths validate declared parameters before mutation; Speed must be finite and nonnegative, Altitude finite, and choices must be declared values.

plugins.command {id:<CFD hash>,operation:'status',args:{}} returns detached parameters, local authoring bounds and explicit authoringOnly:true, solverAvailable:false, resultsAvailable:false, geometryDiagnosticAvailable:false and geometryEvaluated:false. These are not geometry admission or simulation readiness claims. No source geometry is evaluated by this operation.

The solve-frame, solve-animation and results operations are explicit rejection contracts. They always throw CFD_AUTHORING_ONLY, perform no numerical work and preserve the scene. No job is created.

## Tags and production target

There are no CFD semantic tags in the concept. A future solver automatically includes evaluated geometry intersecting the box, including clipped occurrences; rotor/propeller/wing/car/source tags and manual source selection would contradict that target. The preview therefore registers only the CFD owner type and no tags.

The target remains the transient D3Q27 Cumulant/WALE-WMLES/block-AMR solver in DESIGN.md. General motion/occupancy, population transport/refill, production collision/turbulence, SI scaling, force/pressure and scene acceptance remain unfinished. No BGK reference or geometry benchmark is presented as the production solver.

## Recovered numerical foundation

The latest local numerical checkpoint, including relative-wall geometry-budget work, remains separately preserved outside plugins/cfd and outside this release payload. It is uninstalled and never imported/preloaded by this preview. The bounded earlier RTX 3060 space-time gate reported 92 checks/23 cases/40,624 exact comparisons for prescribed integer geometry only, runtime SHA256 6a415699e184da8b2deb0a08019b4d2cfd7f9f67aefa62df73262bd287dca630. That historical result is not a validation of newer relative-wall work, arbitrary geometry or a CFD solver. Original reference tests and limitations remain in the original checkpoint layout; they are not the preview test entrypoint. The production design is copied here as DESIGN.md without claiming those goals are implemented.

## Verification

Host contract: node --test plugins/cfd/tests/authoring.test.mjs

Dedicated real-browser authoring gate: node plugins/cfd/tests/browser.mjs --headless

The focused gate uses an isolated page on the current frozen core and actual nonsoftware WebGPU. It covers discovery/lazy import, genuine 32px icon, real repeated clicks, native fields/status, invalid writes, multiple boxes, transform and parameter Undo/Redo, duplicate, HASH, animation, unavailable numerical calls and bounded operation/render times. It checks uncaptured/validation GPU errors and no numerical imports. Reports bind to exact source hashes. Full repository standard/stress qualification is separately required before catalogue publication.
