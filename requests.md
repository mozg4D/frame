# Core / plugin requests

This is the only development request queue for API cooperation between Frame core and independently developed plugins. Read it before work and before finishing. No open requests.

For each new request use a unique heading and these fields:

- From: `core` or `plugin:<manifest-id>` (required, including for core requests).
- To: `core` or `plugin:<manifest-id>`.
- Need: concrete missing capability and why the requester needs it.
- Acceptance: observable behavior or a small reproducible check.

The chat responsible for the recipient implements the request without asking the user. A chat may complete both sides when available. Check existing capabilities first; make the smallest necessary extension, document ownership/lifetime/error behavior in app.md or plugins.md and add focused regression/performance coverage. Verify that the requester receives and can use the requested capability. Only then delete that request completely. Do not delete unrelated requests. Incomplete requests remain with a precise unresolved dependency; do not mark them fulfilled merely because the receiving side was edited. Update the documentation to describe the resulting API; do not keep completed history or create parallel request files.

## Open requests
