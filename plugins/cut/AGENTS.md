# Cut development

Follow ../../AGENTS.md and ../AGENTS.md. Keep runtime inside this directory and use native scene identities, fields, tags, transforms, Undo, HASH and the shared GPU. No external geometry library or private offset implementation.

This release is an authoring foundation. Never return an empty successful generation or synthetic route when geometry is unavailable. Keep Generate disabled and return CUT_AUTHORING_ONLY from unavailable operations. Save and G-code position must be absent until an actual current nonempty sequence exists. No machine connection or execution.

Read README.md and PLAN.md before extending behavior. Preserve arbitrary machine blocks as opaque Unicode strings; no default M commands are safe for every machine. Only machine generation errors may eventually color the owner red; missing implementation is documented in API capabilities and plugin metadata.

Run tests/model.mjs for CPU authoring behavior. tests/index.mjs exports native pluginChecks for the standard/stress hardware suite. Browser tests require explicit headless mode on the shared lab computer. Parent integration owns browser scheduling, complete repository qualification and publication.

The viewport callback declares `renderKind:'helper'` through the shared core bridge. Local axes remain available with both Solid and Lines off. Ordinary owner visibility and Solo still apply.
