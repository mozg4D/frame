# Atomic

Follow ../../AGENTS.md and ../../plugins.md. Runtime is one plugin.js; the NEP89-1 weights, NEP4/ZBL shader, charge diagnostic and their provenance/license are embedded from the supplied Atomic_sim_r47 (1).html. Preserve the NEP energy/descriptor kernels. All GPU resources use context.device. Never destroy the borrowed device, render pass, camera or frame buffers.

One Atomic owns one independent solver. Its object affine frame never changes atom coordinates in angstroms. Selection edits pause, change positions and preserve velocities. Fixed atoms retain interactions while skipping integration. Velocity initializes once; Force applies continuously using the selection local XYZ vector; Velocity initializes its local XYZ vector once. Store/Restore stores positions only; restore clears runtime velocities and clock.

Persistent arrays have separate typed HASH records. Runtime velocity, force, neighbor, descriptor, charge and draw buffers are excluded. Named selections are ordinary native Browser owners with typed membership/reference records. Only Fixed selections may have internal PSR animation. Animation precedes physics. Offline output waits for the exact Fixed Time interval and all GPU submissions, independent of interactive budget.

Use the native gizmo, attributes, material editor, hierarchy and chronological history. No standalone UI, canvas, device or perpetual RAF. Interactive timers exist only while playing. Keep explicit GPU diagnostics in automation, never Attributes. Test native UI, HASH, independent worlds, history, clock, fixed/velocity/force, shared depth/material and performance through tests/index.mjs.

Species rows are native material owners and use dynamic species membership. Fixed/Velocity/Force material overrides take priority. The core owns the periodic-table overlay, vector fields, state action row and generic Browser child limit. Plain off-gizmo drags navigate. Orthographic placement uses the world grid plane and rounds only with Quantization. Do not reintroduce per-atom rows, plugin-specific Browser expansion, cross-Atomic drag restrictions or source-reference attributes on detached hidden-template instances.
