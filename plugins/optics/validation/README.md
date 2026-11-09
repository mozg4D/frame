# Compact terminal-power accounting

This module is an unloaded validation foundation. It complements the scalar interface-law `powerResidual` experiment with explicit per-source identity and completeness checks. Neither is a scene solver. The native Optics authoring plugin does not import this module or publish its output as a measured result.

The caller must reduce real terminal contributions into five disjoint categories:

- `usefulWatts`: power accepted by the requested receiver objective.
- `unwantedWatts`: power reaching an undesired receiving region.
- `absorbedWatts`: power physically absorbed by blockers, media or surfaces.
- `escapedWatts`: power that has left the modeled transport problem under an explicit escape rule.
- `unresolvedWatts`: power whose final physical destination is unknown, including bounded-work termination. It is not absorption or success.

The Design Space boundary alone is not an escape condition. Intersections with a receiver must not be counted twice as both useful/unwanted and escaped. Reflection and transmission weights belong to the original source's ledger; a branch is not a new source. Source power is fixed when comparing design candidates.

`evaluatePowerLedger` accepts a source table, one complete terminal aggregate per source, and explicit absolute/relative conservation tolerances. Native source hashes identify records independently of names and order. All quantities are watts. The function validates and evaluates caller-provided numbers; it cannot establish that any native source exists, belongs to this task, has that authored power, or generated those contributions.

Per-source checks are necessary even when the global residual is zero: one over-counted source must not cancel another under-counted source. Unresolved power stays visible even when conservation closes. Zero emitted power has no defined efficiency or unresolved fraction. No candidate is normalized to repair its power balance.

The returned accounting status does not qualify optical laws, sampling weights, material models, receiver mapping, geometry, staleness or manufacturing. A future tracer must establish these independently. Multi-receiver coverage and per-source/per-receiver attribution remain a separate future contract; summing useful watts cannot prove that every requested target is served.

## Integration boundary

Keep only bounded compact aggregate records on the CPU. Do not read back or retain full ray/triangle arrays to use this helper. It owns no scene, job, device, buffers, persistent results or HASH data.

Before connecting it to a scene Solve, resolve the common capture policy: the inspected native `pluginSnapshot` excludes `frameVisible === false` occurrences, while the Optics concept requires hidden optical objects to retain physical participation. Obtain a coordinated shared-core contract, source/data revision validation and independent transport tests first. Never toggle user visibility or infer physics from viewport materials to work around this gap.

Focused tests are ordinary Node tests and include invalid inputs, source-wise cancellation traps, zero-power cases, arithmetic limits and a bounded completed-operation latency check. They do not exercise WebGPU or qualify the existing native authoring browser gate. Full and hardware suites remain in the coordinator's shared queue.
