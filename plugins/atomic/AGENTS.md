# Atomic

Follow ../../AGENTS.md and ../../plugins.md. Runtime is one plugin.js; the NEP89-1 weights, NEP4/ZBL shader, charge diagnostic and their provenance/license are embedded from the supplied Atomic_sim_r47 (1).html. Preserve the NEP energy/descriptor kernels. All GPU resources use context.device. Never destroy the borrowed device, render pass, camera or frame buffers.

One Atomic owns one independent solver. Its object affine frame never changes atom coordinates in angstroms. Selection edits pause, change positions and preserve velocities. Fixed atoms retain interactions while skipping integration. Velocity initializes once; Force applies continuously in the selection pivot's X direction. Store/Restore stores positions only; restore clears runtime velocities and clock.

Persistent arrays have separate typed HASH records. Runtime velocity, force, neighbor, descriptor, charge and draw buffers are excluded. Named selections are ordinary native Browser owners with typed membership/reference records. Only Fixed selections may have internal PSR animation. Animation precedes physics. Offline output waits for the exact Fixed Time interval and all GPU submissions, independent of interactive budget.

Use the native gizmo, attributes, material editor, hierarchy and chronological history. No standalone UI, canvas, device or perpetual RAF. Interactive timers exist only while playing. Keep explicit GPU diagnostics in automation, never Attributes. Test native UI, HASH, independent worlds, history, clock, fixed/velocity/force, shared depth/material and performance through tests/index.mjs.
