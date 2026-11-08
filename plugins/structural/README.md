# Structural

Status: under-construction authoring preview. No general-scene structural solver, voxelization, stress field, safety factor, deformation result or topology optimization is installed.

## Working now

- A lazy Structural catalogue entry and native 32 x 32 truss icon.
- Independent Structural owners with an ordinary 100 mm box helper. Move, rotate and resize with Frame's native transforms; the native frame is the only size model.
- Native Voxel size (mm), Material (%) and Displacement settings. These are stored settings only. Their shared field declarations govern Attributes, scene.update and the authoring field API. No computation runs when they change.
- Fixture and Preserve are fieldless native authoring markers. They can be assigned to ordinary objects/groups, removed, copied, undone and saved. They do not currently weld, contact or preserve material in a solver.
- One disabled Under construction action. No calculation button or numerical result is shown.

Multiple owners and marker-bearing objects are allowed. The plugin keeps no global solver and allocates no numerical buffers or textures. Native helper resources remain core-owned.

## API

Use plugins.create {plugin:"structural"}, ordinary scene/transform/tag commands, and plugins.describe {plugin:"structural"}. Native tag kinds are structural_fixture and structural_preserve. Marker UIDs are owner-scoped; a copied marker remains independent even when native duplication preserves its UID. tag.set is the existing core assign/remove operation; markers are not new custom objects.

plugins.command {id,operation:"status",args:{}} explicitly reports authoringOnly:true and numericalAvailable:false. show-voxels, solve-frame, solve-animation, optimize-frame, optimize-animation and result-object are rejection-only API endpoints with STRUCTURAL_AUTHORING_ONLY. They do not publish an output or alter the scene.

The native box/settings/markers survive HASH and native history. There is no runtime FEM/grid/topology data to serialize. Parameter edits use existing Frame validation and Undo, not duplicated plugin logic.

## Intended calculation contract

The supplied structural.txt concept specifies a local computational box, clipping every effective Material/Fixture/Force/Preserve/Optimize Space volume before voxelization. Each owner has its own regular Hex8 grid and load cases. Material groups union their geometry; nearest Material wins. Force tags are additive and support several per owner, total force in N and total torque in Nm about the native pivot. Changing grid resolution must preserve the total load. Each animation frame is an independent static load case. Fixture overlap welds and other contact slides frictionlessly. Optimize Space owns a material preset; Preserve prevents removal inside the design domain. Runtime results stay out of HASH until explicit Result to Object.

Use Safety factor, not Min safety factor, following the concept's opening correction. No synthetic number appears in this preview.

The existing numerical research remains separate and unqualified for current core. An old GPU component test is not evidence that ordinary scene fixtures/forces work. In particular, general clipped geometry and reliable load/fixture mapping must be qualified before exposing Solve. Material, Force and Optimize Space parameter tags are deliberately not registered until the shared core contract in CORE-CONTRACT.md is implemented and tested.

## Validation

node --test plugins/structural/tests/authoring-preview.mjs performs CPU runtime/source-contract checks and completed-call budgets. It is not browser, native history or GPU verification.

node plugins/structural/tests/authoring-browser.mjs --headless opens an isolated native Frame scene and requires a real non-fallback WebGPU adapter. It checks lazy discovery, repeated icon creation, native transform/selection, parameter validation, marker assignment/removal, Undo/Redo, duplicate/HASH, rejection-only operations, frame budgets and GPU errors. The catalogue entry tests/index.mjs exports the same gate. The report records exact source hashes.

The dedicated gate never runs Unite or touches the user's working scene. Standard/stress and the 100M-triangle fixture remain separate release gates, not implied passes.
