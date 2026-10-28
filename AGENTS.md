# Frame development

- Core runtime application code lives in `index.html`. Independently developed plugins live in their own `plugins/<plugin>/` directories; see `plugins.md`. Development tools/tests may use separate files. Keep heavy-scene performance and memory use a priority.
- Keep runtime code minimal: reuse existing algorithms, editor paths and GPU resources instead of adding parallel implementations.
- Compatibility with earlier formats, APIs, and behavior is not required for now. The user will explicitly say when compatibility becomes necessary; do not add compatibility layers or migrations preemptively.
- Read `app.md` before changing behavior; update it when behavior or the API changes.
- The AI developer owns AI API/MCP maintenance. Whenever a task reveals inconvenient/missing automation or diagnostics, improve the API, schemas, documentation and regression coverage as part of that task.
- `window.frameAI` is the supported automation API. Discover commands with `frameAI.listTools()` / MCP `tools/list`. Reuse editor transactions, source spline cages and native GPU ownership; do not add a parallel scene model for AI/tests.
- After completing a task, run `npm test` from this directory. It checks syntax, API, real UI events, MCP and a 2304-cell spline fixture. Fix failures before reporting success. If the environment has no WebGPU adapter, report that limitation explicitly; never count skipped GPU tests as passed.
- For geometry/rendering/performance changes also run `npm run test:stress`; inspect timing and WebGPU errors. `npm run test:all` additionally loads the large user fixtures in `tests/scenes/` and requires ample free VRAM. Do not rename/delete user fixtures.
- Performance tests are mandatory for every added or changed operation. Record completed-operation wall time, assert a meaningful latency budget, and measure CPU/GPU frame times for rendering changes, including the 100M-triangle fixture when relevant.
- Add a focused regression case to the shared suite or focused UI modules under `tests/` for a fixed bug/new operation. Keep test code outside runtime. New automation commands require a schema, validation before mutation, and tests.
- `tests/results/latest.json` records the tested `index.html` SHA-256, failures and timings. Do not claim a newer file passed an older report. Test results, browser dependencies and failure screenshots are ignored by Git.
- Browser-only runner: `tests/index.html` on the same local server. It uses a separate iframe scene; leave the user's working scene alone. CLI uses its own browser context and ephemeral localhost server.
- CLI tests open a visible Chromium window by default; `--headless` is available explicitly. Playwright sends browser-local events without system mouse/keyboard automation. Run native pointer-lock checks in a separate headless browser to avoid capturing the system pointer. Never silently fall back to software GPU. Each plugin owns `AGENTS.md` and `tests/index.mjs`; standard/stress verification discovers plugin checks from the catalogue.

- Author every icon at its displayed native dimensions. Do not scale icons with CSS, transforms or a mismatched SVG viewBox; author a separate native-size variant when needed.

- Change the application interface only when the user explicitly requests that interface change. Keep code, documentation, fixtures and UI text in English.

- After completing and validating each task that changes this repository, commit the task changes and push them to GitHub `origin/main` without waiting for a separate publication request, unless the user explicitly asks to keep the work local. Preserve unrelated work, never force-push, and verify that remote `main` matches the intended commit. For application releases, also verify the GitHub Pages build and deployed assets against committed Git bytes before reporting publication.
