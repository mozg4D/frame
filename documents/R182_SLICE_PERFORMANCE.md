# Frame r182: bounded reuse of completed Slice preparation

The saved seven-perimeter zoo improved materially because the owner no longer repeats most component preparation discarded by oversized helper replies. This is a bounded performance milestone; general clockwise inward spirals and transitions over one nominal line width remain the next product priority.

## Dominant measured cost

Comparable r181 profiling used the ready saved zoo with 61,074 retained triangles, 363 layers, seven perimeters, minimum path 3, width 1 mm, layer height 0.3 mm and initial height 0.6 mm. The two runs spent 7.933 / 8.285 seconds in 325 owner component preparation calls. Helpers had already calculated those same 325 components across 13 replies whose conservative sizes exceeded 4 MiB. Initial source preparation took 51–58 ms; the prepared-geometry sends took 148–254 ms in aggregate. Repeated inset preparation, rather than initial source preparation, dominated the removable owner cost.

The final instrumented worker reuses 324 of those 325 components. Owner preparation fell to 0.194 / 0.201 seconds and 1 / 1 calls. Instrumentation changes timing and these wall times are diagnostic, not product benchmark results. Interleaved uninstrumented measurements below establish the full-flow gain.

## Protocol, lifetime and memory

The existing 14 helpers and owner retain the shared 15-lease budget on this 16-logical-thread host. Completed component values are sent in pieces no larger than 4 MiB, with at most 8 MiB retained preparation replies per layer. The helper holds its preparation lease across intermediate replies and releases it after the terminal reply. The owner completes its already ordered canonical reservations from those immutable values. Components outside the admitted reply envelope are calculated on the owner. Oversized final jobs still finalize the entire layer together on the owner; additional-overlap acceptance remains coupled across the whole layer.

Each pending layer now reserves 16 MiB of input. The owner input reservation ceiling is 256 MiB, output reservation ceiling 64 MiB, and canonical value-cache ceiling remains 128 MiB. Pool admission deducts these owner reserves, source estimates and 128 MiB per helper plus prepared-copy estimates from 40% of declared device memory. Low-memory admission can keep the complete job on the owner. A positive frontend helper request that becomes zero under this aggregate admission completes without creating an empty pool. These are conservative admission estimates, not hard JavaScript-heap or simultaneous-process-peak guarantees.

All pieces require the current run, job and layer IDs. Duplicate component indexes, stale completed replies and aggregate reply overflow fail distinctly and terminate the owned pool. The existing cancellation, source edit, supersession and model invalidation paths terminate workers, close ports, revoke URLs and release leases. Values live only for the current Slice and its existing bounded canonical cache; no persistent workers, cross-generation prepared cache or SharedArrayBuffer are introduced. Active-set ends-before-starts ordering, canonical insertion order and ascending source/reference registration remain intact.

## Full Slice-to-paint measurements

The boundary is Slice API invocation through two painted RAF callbacks, with source import and readiness excluded and no correctness hashing during measured work. Cold means first Slice in a fresh page/context; warm means the immediate repeat with the same source/settings/page. Every Slice creates fresh owner and helper workers. ABBA version order supplies two cold and two warm observations per version per scene; the median and complete range are reported in seconds.

| Scene | Condition | r181 median (range) | r182 median (range) | Change |
| --- | --- | ---: | ---: | ---: |
| lowpoly | cold | 3.419 (3.398–3.441) | 3.429 (3.217–3.641) | 0.3% |
| lowpoly | warm | 3.262 (3.213–3.311) | 3.316 (3.308–3.323) | 1.6% |
| zoo | cold | 23.242 (22.835–23.650) | 15.507 (15.184–15.830) | -33.3% |
| zoo | warm | 23.259 (22.573–23.946) | 15.230 (15.110–15.351) | -34.5% |
| human1000 | cold | 4.029 (3.938–4.120) | 3.959 (3.953–3.965) | -1.7% |
| human1000 | warm | 3.902 (3.844–3.961) | 3.943 (3.842–4.044) | 1.0% |
| large | cold | 0.292 (0.285–0.299) | 0.298 (0.297–0.298) | 1.9% |
| large | warm | 0.279 (0.270–0.287) | 0.269 (0.268–0.270) | -3.4% |

Zoo entries use the independent repetition on the final published worker bytes. The first all-scene campaign independently measured zoo medians of 21.635 to 14.514 seconds cold and 21.681 to 14.542 seconds warm. Other scene entries come from that first campaign before a four-byte null-safe duplicate-reply guard; their successful-job implementation is identical. That exact candidate is archived as candidate-first-perf.js. The final zoo repetition and final output/lifecycle/protocol gates use SHA256 1c0bcf37cba38f1d9e9fd4690b983ae86a012beae2c5215b6f89e6bef993eab7.

High-guard has 100 layers and three perimeters, human is the exact 1,000 mm male with 3,332 layers and one perimeter, and the short source has 196,608 original faces, 101,376 retained triangles, 99 layers and one perimeter at width/layer/initial height 0.4/0.1/0.2 mm. The observed high-guard, human and short-source changes are small and inconsistent across cold/warm conditions; no general speed improvement is claimed. The 999-layer dense correctness control remains slower in parallel than serial.

Actual helper-stage overlap reaches 14 in the recorded traces and all heavy leases are released. In the final zoo campaign average logical cores range from 7.97–8.33 for r181 to 11.34–11.94 for r182. Maximum final zoo RAF gaps are 200.1 ms and 200.0 ms respectively. The UI continues processing frames; preview assembly can still cause visible pauses. Continuous 60 fps is not promised. Stage traces are capped at 128 entries per stage/run and do not describe every job.

## Correctness and release gates

Complete owner packets, raw Float32 warning values, canonical reference definitions and public geometry/width/provenance/commands match the verified r180 controls on high-guard, zoo and the exact human. Human retains all 3,332 layers, 27 exceptional sections and 3,305 exact normal sections. The half-human control also retains all 2,967 layers and 24 exceptional sections. The existing 11 finite-bank/contact/minimum-path/source-angle controls, dense source and forced output/prepared-memory fallbacks pass.

Model old/new-volume invalidation with undo/redo, unrelated outside edits, in-flight cancel/edit/delete, Start/Finish/Position visibility in Solid and Lines-Dots, hardware/memory policy, distinct canonical resource failure, stale generation rejection and clean recovery pass. Exact binary native addressed-source reload and extracted texture/catalog assets are preserved. The unchanged service worker passes its real 60-second update throttle with an unsaved r181 window retained and a fresh r182 offline Slice/native reload. Required licenses and all earlier immutable assets remain.

QA includes corrected harness failures for instrumentation admission and duplicate-reply/readiness expectations; only the later passed receipts count as gates. Original r180/r181 seals and the preexisting handoff are verified unchanged. Publication is direct main with exact CI/head/assets/live-browser verification recorded in the task handoff.

## Scope boundary

Cold compilation, ordinary message cloning and conservative packet traversal remain measurable overhead, especially on human and small jobs. Removing substantially more of those costs would require worker-lifetime or deeper transport redesign with new cancellation, invalidation and memory responsibilities. Stop this performance milestone here and return to general inward clockwise spirals and W-long adaptive transitions. Existing source ownership, finite-bank/seam constraints, commanded-flow/nozzle distinctions and physical-coverage qualifications in [r180 engineering](R180_SLICE_ENGINEERING.md) and [r181 engineering](R181_SLICE_ENGINEERING.md) continue to apply. Mixed Morph/point-animation reload ordering and broad native/10-million-mesh benchmarks remain separate work.
