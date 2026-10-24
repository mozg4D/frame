# Independent Frame plugins

Follow ../AGENTS.md and ../plugins.md. Keep plugin runtime code inside its own directory and reuse the shared core GPU resources/API.

Each plugin owns AGENTS.md and tests/index.mjs exporting async pluginChecks(page), which returns {pass,checks,timings,error?}. Standard/stress runs discover these checks through plugins/index.json. Keep plugin-specific fixtures/helpers under that plugin's tests directory. Icons must use native artwork dimensions without CSS/viewBox scaling. Tests open visible Chromium with hardware WebGPU by default; --headless is explicit opt-out. Keep input inside Playwright. Isolate native pointer-lock checks in headless Chromium.
