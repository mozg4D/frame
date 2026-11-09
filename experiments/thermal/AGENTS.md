# Isolated Thermal P(T) experiment

Follow ../../AGENTS.md. Read README.md before modifying the model.

- Do not register this experiment or import it from the installed Thermal preview without separately scoped current-core numerical/native qualification.
- Reuse the extracted conduction backend. Preserve its exact-body provenance or explicitly document and test any mathematical change. No CPU production fallback or second GPUDevice.
- Heater power is total object watts evaluated at the prior field's volume mean, then uniformly distributed. Keep source normalization and feedback/duration limits explicit. Never call this an implicit nonlinear solve.
- Preserve strict snapshots, per-heater reconstructed watts, original per-cell/source physical residuals, signed dt-integrated energy, and separate precision-limited diagnostics. No extrapolation, hidden clamping or invented material/fluid roles.
- GPU resources are runtime-only and owned locally. Revalidate cancellation/device/currentness after awaits and dispose retained fields on every exit. Do not hold GPU scopes across an await.
- Keep the catalogue, installed authoring, native transforms, viewport and gizmo behavior unchanged. No custom renderer or UI.
- Run focused CPU, dedicated real-hardware headless checks and npm test. Hardware results bind exact final hashes. Label command-emulator tests as orchestration checks, not hardware arithmetic validation. Coordinate the GPU queue with other workers and never touch user windows or printing.
