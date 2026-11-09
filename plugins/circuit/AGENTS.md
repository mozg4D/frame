# Circuit authoring preview

Follow ../../AGENTS.md and ../AGENTS.md. Read README.md before changes.

- This installed preview is under construction. No solver, measured value, Scope, virtual firmware, ngspice/WASM or electrical qualification exists. Numerical commands reject before mutation.
- Circuit is an ordinary empty native owner, with no box, frame, surface or decorative geometry. Each component is a separate native object. Its explicit Circuit hash is independent of parenting.
- Plugin record c17c0170000000000000000000000001 stores bounded authoring JSON only. Native records, parameters, transactions, references, HASH and Undo are authoritative. Do not create a second scene, Undo stack or binding registry.
- Stable pin IDs are local to their component; stable net IDs are local to Circuit. Names use NFC + trim, case-sensitive. Empty names disconnect only that pin. Rename to an existing name merges pins and Ground in one transaction. Never treat disconnected pins as one shared node.
- Native numeric declarations supply common field units/ranges/write access. Reuse context.parameters.schema rather than duplicate bounds in an API.
- Render uses the existing callback, borrowed camera/frame/pass and shared device. Flat line symbols are not card textures or camera billboards. Circuit owns only bounded symbol/net vertex buffers, never borrowed resources. There is no animation loop or model-time integration.
- Network cache identity must include the Circuit-owner inverse frame and effective inherited visibility of each component, as well as component frames/pin authoring. Test independent owner motion and hidden ancestors with tests/net-cache.mjs.
- Plain object-browser selection and native transforms are supported. Pin hit-testing, interactive Net rows, labels, net selection, Scope, model replacement/import and electrical model validation remain unfinished; do not imply otherwise.
- No Circuit-specific tags are required or registered. Do not create PCB, Scope or pin objects. Docs and Scene Control remain shared infrastructure.
- topology is a detached, read-only authoring snapshot, not a solver graph or physical validation. Node identity includes the Circuit hash; only explicit Ground maps to 0. Keep disconnected pins distinct and reject dangling references. Validate target authoring and capacity before create/transfer mutations, including generic owner edits.
- Coordinate hardware tests and publication with the release coordinator. Never publish independently over simultaneous work. Standard/stress and focused browser gates must report exact source hashes and no skipped hardware checks as passed.
