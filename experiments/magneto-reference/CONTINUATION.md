# Magneto continuation: current-flow reference milestone

## Audited starting point

Date: 2026-11-09. Original specification: Library `libfile_fde3_f-8c27f95033c481919a48c7325a93960d_9bd4792eb68881919bf88a6c2e1d28dd`, `magneto (1).txt`, 41,657 bytes. The specification was read through its final minimal-HASH requirement.

Remote Frame main inspected through GitHub: `649c046723fc2d181e75d234c43ddf73f5165e75`. Native Magneto files include plugin.js, plugin.json, icon.svg, authoring tests and qualification notes. The existing preview already supplies the native tag/material metadata, finite plane, signed density animation and visualization intent. It deliberately rejects numerical work. Rebuilding those surfaces is unnecessary.

Main documentation records earlier focused DPR1/DPR2 and aggregate authoring/rendering qualification. Those historical reports do not qualify this continuation or a magnetic solver. Current native APIs include synchronous authoringStamp, borrowed GPU scene.capture/signature/contentSignature, native editor lifecycle and field transactions. A scalar authoring stamp is not a geometry lease or physical fingerprint.

The separate CPU reference was copied from `C:\Users\user\frame-magneto-state-lab-20261109` into this task's writable isolated directory. Its original 80 tests passed again before the new work. The source folder and native Frame checkout are not edited. The local Frame checkout is stale (`0a55f5c`); it must not be used as an integration base.

## This milestone

Add an explicit small conductor-graph current-flow oracle, independently test current conservation and minimum dissipative energy, and bridge its normalized current samples to the existing bounded direct reference. This fills a mathematical reference gap before GPU geometry/topology work. It does not construct a graph from arbitrary Frame meshes and does not enable native Solve.

Acceptance requires analytic series and parallel currents; signed and zero density; Kirchhoff conservation at every node; invariance to edge orientation; minimum-energy behavior under admissible cycle perturbations; rejection of impossible cuts, unsafe numerical ranges and forged/malformed inputs; integration with a separate magnetic-field oracle; and completed-operation timing. Retain exact source hashes and distinguish all new results from copied historical results.

## Remaining implementation sequence

1. **Geometry and cut contract.** Agree with core on current evaluated occurrences, device/resource ownership and invalidation. Build orientation-independent GPU X/Y/Z parity classification and geometry-aware weighted local samples. Compare against small independent analytic solids, flipped/duplicated triangles, gaps and dirty shells. Do not read full canonical triangles back to a CPU mirror. Establish how cut constraints distribute prescribed density across disconnected conductor components; the graph oracle's average-flux interpretation is not a general plane boundary-condition proof.
2. **Conductor distribution.** Construct the discrete conductor operator and cuts from geometry on GPU. Verify conservation, insulating boundaries, closed-loop topology, branch distribution and spatial convergence against this small explicit reference. Cache geometry/relative-cut basis separately from signed density amplitude. Treat rejected/ambiguous topology explicitly, without silently inventing a conductor.
3. **Magnetic spatial accuracy.** Resolve finite-volume self/near interactions and refinement before claiming tiny-gap accuracy. Existing Plummer regularization plus equivalent-sphere diagonal is a bounded reference model, not a proved general-body discretization. Implement coarse far transport with near-field correction and no double counting; compare fields and fixed-moment forces/torques against direct references. Test gap refinement independently of global grid pitch.
4. **Physical materials and history.** Add traceable manufacturer curves and validated reversible/irreversible laws. Keep current synthetic fixtures separate from named steel/NdFeB presets. Solve from an immutable physical baseline and commit once on convergence. Validate pulse retention, reversal, reset and same-time replay.
5. **Chronological animation.** Add event-aware chronological stepping that cannot skip source pulses, warm starts, bounded disposable checkpoints and cheap curves. Persistent remanence is not an evictable cache. Validate interruption, replay and deterministic history before native curves or playback coupling.
6. **Native results and qualification.** Implement finite-plane camera-adaptive sampling without a magnetic re-solve on camera motion, selection/pivot loads, native curves and minimal persistence. Recheck source/device ownership after each await and immediately before atomic publication. Test cancel/delete/Undo/HASH/ABA and transformed source cases. Keep Solve disabled until these adapters and relevant physical gates exist.

## Integration and laboratory coordination

No GPU slot is claimed by this milestone. No browser, OBS, printer, system cursor or user window is touched. A later native/GPU run needs the coordinator's shared LAB slot and a fresh isolated checkout of main. Use explicitly headless hardware Chromium; do not silently replace hardware with software rendering. Run required focused, aggregate and stress gates for the exact integrated bytes, and test:all when affected heavy-scene paths require it.

Coordinator update during this work: other plugin chats share LAB. Before heavy GPU or aggregate testing, inspect already-running processes and agree the queue. Deliver an isolated delta; shared-file changes and publication must go through the main chat. This work performs only short isolated CPU checks and stores its sources, plan and reports on disk.

The standalone reference is not imported by the native plugin. Ready reference source can be integrated as test/reference code once the coordinator chooses its repository location and runs the repository gates. Publication is authorized, but no main update is made by this isolated milestone; no browser/GPU or full Frame pass is implied by CPU success.

## Environment findings

- Broad enumeration of `C:\Users\user` was denied; it was not repeated. Explicit supplied project paths were accessible.
- Sandboxed Node test child processes failed during path resolution with EPERM before executing suites. Authorized elevated execution of the same isolated CPU command passed all original 80 tests. This was an environment failure, not a numerical failure.
- Local `git ls-remote` failed with Schannel `SEC_E_NO_CREDENTIALS`. Read-only GitHub connector access resolved and inspected actual main; no credential configuration was changed.

## Completed result and handoff

The current-flow milestone is implemented in `plugins/magneto/conductor-current.js`, with model/API documentation in `conductor-current.md` and a separate review in `conductor-review.md`. It supports at most 32 nodes/64 edges, one active conductor cut, closed node flux, signed source normalization and minimum Joule power. An optional adapter supplies explicit straight-tube midpoint samples in the existing reference currentBases format. Multi-component cuts fail closed; each independent active conductor must be solved separately.

Both final `npm test` and `npm run verify` passed 111/111 tests (80 retained + 23 implementation + 8 independent review), zero failed/skipped. Exact source hashes before and after verification match, and the coordinator independently compared the current disk files with every recorded sourceAfter hash. The maximum-size graph create plus 12 completed solves took 70.4735 ms against the 3000 ms bounded CPU smoke budget. This is not a hardware-independent performance guarantee or GPU benchmark.

The first combined run had a test-fixture typo: a soft material used initialSusceptibility instead of reversibleSusceptibility. It was corrected before both final passing runs. No runtime defect was masked by relaxing a physical assertion.

Runtime SHA-256: `903bacbd71e868059dc59cab142cb05200dbebab0315f024645ed23eabf03c9f`. Fresh results are `results/verification.json` and `results/final-tests.tap`. Older copied review/result files remain historical evidence only.

Package the baseline-relative changes using the sibling `package-magneto-delta.ps1`. Its DELTA-MANIFEST records baseline and candidate hashes and explicitly prohibits overlaying this standalone folder onto native plugins/magneto. The main chat owns repository placement, any native integration, shared qualification and publication. No CPU implementation blocker remains. Production geometry/cuts, native GPU near/far solving, calibrated materials, animation and the associated physical/native gates remain open.
