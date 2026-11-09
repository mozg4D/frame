# RF development

Follow ../../AGENTS.md and ../AGENTS.md. Keep runtime in plugin.js. Current work is authoring only, never a qualified RF calculation.

- Native RF/Section planes and Terminal cubes use the common helper contract, document hierarchy, transforms, selection, Undo and HASH.
- A Terminal belongs to its nearest RF ancestor. No hidden pairing, ground, electrical connections or scalar-field proxy for received power.
- Validate before native mutation. Do not await the serialized API inside activation or an operation. Native editor selection is awaited after one creation transaction.
- Numerical requests reject with RF_AUTHORING_ONLY before scene capture or GPU allocation. Do not replace this gate until the corresponding physical tests pass.
- Keep UI minimal and English; diagnostics belong to the API or red native rows, never warning prose in Attributes.
- Material names are saved intentions, not calibrated electromagnetic constants. No automatic visual-material replacement.
- Run node --test plugins/rf/tests/authoring.mjs plugins/rf/tests/native-helpers.mjs, native browser checks, standard and stress qualification. Coordinate hardware use; headless isolated contexts only when the user is working.
