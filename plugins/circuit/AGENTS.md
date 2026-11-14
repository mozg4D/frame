# Circuit

Authoring/connectivity only; no electrical solver, measured voltage/current, Scope, firmware/controller execution or ngspice/WASM ships.

- Circuit is an empty native owner; components are separate objects with explicit Circuit hash independent of parenting. Native record c17c0170000000000000000000000001 stores bounded authoring JSON; replace immutable values, never mutate arrays.
- Pin IDs are component-local, net IDs Circuit-local. Names NFC+trim/case-sensitive, 1..128 UTF-16 units without controls. Empty disconnects one pin; rename to existing merges pins/Ground transactionally. Disconnected pins are distinct; only explicit Ground maps to 0, never name '0'. Address topology by (circuit,node).
- topology is detached authoring, not a physical netlist; include enabled flags/reject dangling refs. Preflight target data/capacity before creation/transfer/generic owner edits: 512 components/Circuit, 64 pins/component, 1024 nets/Circuit.
- Flat symbols/nets borrow shared pass/device, renderKind helper. Cache includes Circuit inverse frame, component frames/pins and inherited visibility. Retire bounded owned vertex buffers. No playback loop/Circuit-specific tags/pin/PCB/Scope objects.
- Browser selection/gizmo works. Pin hit-testing/interactive Net rows/labels/net selection/model import/validation remain unfinished. Unavailable voltage is null, not zero. Numerical endpoints reject CIRCUIT_AUTHORING_ONLY before mutation.
- Time scale is electrical s/Frame s (default 0.001), MB decimal. Stored history budget allocates no samples. Next gate is a reproducible licensed solver and independent closed-loop accepted-time/state-preservation proof; Scene Control scheduling alone is insufficient.

Checks: node plugins/circuit/tests/authoring.mjs; node plugins/circuit/tests/net-cache.mjs; node plugins/circuit/tests/index.mjs --headless. CPU authoring/cache checks do not qualify native GPU or electrical results.
