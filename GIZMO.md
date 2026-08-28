# Gizmo rules

The gizmo is object-agnostic. The same transform rules apply to meshes,
splines, generators, instances, nested objects, and skewed objects.

## Reference frame

- The gizmo origin is the object's pivot (or the shared pivot of a selection).
- **Object** mode uses the pivot's local axes.
- **World** mode uses world axes.
- All transforms preserve the complete affine matrix, including skew.

## Move and rotate

- Axis and plane handles move in their displayed coordinate frame.
- The upper white handle moves in the screen plane.
- Vertex snapping is calculated from the gizmo origin, not from the cursor or
  the white handle.
- Moving changes Position. Rotating changes Rotation, but not Position.
- Quantization is measured from the transform's starting state.

## Scale

- Scaling always happens around the pivot and never translates the pivot.
- Axis scale follows the selected World/Object coordinate frame.
- Uniform scale uses the central handle, ignores spatial snapping, and only
  applies scale quantization.
- Size cannot be negative.
- In Pivot Mode, scale still scales the object; Pivot Mode only changes the
  behavior of move and rotate.

## Pivot Mode

- Move and rotate edit the pivot frame while keeping geometry fixed in world
  space.
- Coordinate Manager Position and Rotation edit that same pivot frame.
- Multi-selection edits the shared pivot without moving selected geometry.

## Coordinate Manager

- Position and Rotation describe the pivot in the selected World/Object frame.
- Object Size is measured along object axes.
- World Size is the world-axis-aligned bounding-box size, so it may change when
  the object rotates.
- A mixed multi-selection field displays `multiple`; entering a value applies
  that component to the selection.

## Component modes and history

- Components are editable only for editable polygon meshes and spline control
  points. Procedural geometry and Spline Patch surfaces fall back to selecting
  the whole object.
- Every completed gizmo or Coordinate Manager operation is one undoable action;
  undo and redo restore both object and pivot transforms exactly.
