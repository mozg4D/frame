# Magneto unfinished native authoring

Follow ../../AGENTS.md and ../../plugins.md. This plugin stores authoring only. Never import the separate bounded CPU reference as a scene solver, invent calibrated presets, enable Solve or manufacture fields, Force/Torque values or curves.

Use native object parameters, tags, hierarchy, transforms, animation, history and HASH. No extra scene, canvas, iframe, timer, renderer/device or CPU triangle mirror. The finite XY plane uses core helper lines; +Z is its normal. Size is ordinary scale. Native Material tag has exactly one preset field; Reset is absent without persistent physical state.

Material names are intended authoring metadata, not validated physics. Every intended preset has physicsAvailable:false. The native surfaceStyle fallback never creates or edits a material. Core suppression for effective Frame materials preserves explicit and inherited appearance.

CPU tests: node --test plugins/magneto/tests/authoring.test.mjs. Focused browser tests: node plugins/magneto/tests/authoring-browser.mjs --headless. Browser/GPU requires the coordinated LAB slot. Focused tests never qualify the full solver or replace aggregate/stress gates.
