# Frame F1 Help qualification packet

Source-only delta from main 69320eabf91b1cdd838a09082c34a843f21aec21. It opens the existing application Help dialog on unmodified F1 and preserves the current Doc runtime. The supplied Python helper only verifies and assembles source; it does not run code or browser tests.

Create a fresh target with --base-from and an existing verified main copy. The helper downloads only mismatched source files from that pinned public main commit, verifies all 554 inputs, then --apply checks and writes the nine changed/additional files and verifies all 557 outputs. Do not overwrite a user's working checkout.

Qualification commands, using existing approved Node/Playwright/Chromium and an owned temporary directory:
- node tests/help-f1-state.mjs
- node tests/help-f1.mjs --headless
- node tests/release-non-unite-audit.mjs
- node tests/release-non-unite.mjs --headless
- node tests/documentation-button.mjs --headless

The focused native test covers viewport/editable focus, native F1 suppression, key repeat, Escape, menus, button, backdrop and modifier/IME exclusions. Never run the full npm test/stress or Unite. Coordinate the LAB window first. Main/live publication remains a separate step after qualification.
