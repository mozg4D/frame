# Independent Frame plugins

Follow ../AGENTS.md and ../plugins.md. Read ../requests.md before work and before finishing. That root file is the only core/plugin API request queue. Always identify From and To using core or plugin:<manifest-id>. Implement relevant requests without asking the user; verify the requesting side can use the result, update documentation/tests, and delete only the fulfilled request. Keep incomplete and unrelated entries. Keep plugin runtime code inside its own directory and reuse the shared core GPU resources/API.

Each plugin owns AGENTS.md and tests/index.mjs exporting async pluginChecks(page), which returns {pass,checks,timings,error?}. Standard/stress runs discover these checks through plugins/index.json. Keep plugin-specific fixtures/helpers under that plugin's tests directory. Icons must use native artwork dimensions without CSS/viewBox scaling. Tests default to full Chromium headless with hardware WebGPU; --headed is explicit opt-in.
