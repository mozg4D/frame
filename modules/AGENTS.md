# Independent Frame plugins

Follow ../AGENTS.md and ../plugins.md. Read ../requests.md before work and before finishing. That root file is the only core/plugin API request queue. Always identify From and To using core or plugin:<manifest-id>. Implement relevant requests without asking the user; verify the requesting side can use the result, update documentation/tests, and delete only the fulfilled request. Keep incomplete and unrelated entries. Keep plugin runtime code inside its own directory and reuse the shared core GPU resources/API.
