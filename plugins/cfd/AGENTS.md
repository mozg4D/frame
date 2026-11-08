# CFD authoring preview

Follow ../../AGENTS.md and ../AGENTS.md. Keep runtime changes local to this plugin.

- This is the separately qualified native-authoring milestone, not the numerical foundation or a scene CFD solver. Catalogue installation is allowed only after the dedicated current-core hardware/browser authoring gate and repository gates pass.
- Keep the numerical foundation in the original LAB checkpoint uninstalled and unloaded. Its original AGENTS.md still applies there. Never import it into plugin.js or preload it as an asset. Its historical tests/hardware evidence do not qualify this preview or a solver.
- The preview owns only ordinary CFD box parameters and a native shared-device helper. No private scene, GPU solver allocations, snapshot capture, result cache, physical result or Solve UI.
- The face-to-face local-X arrow is an authoring direction marker, never a streamline. Ground/Medium/Altitude are stored intent without physical effects.
- No rotor, propeller, wing, car or manual source-selection tags. The production concept specifies automatic box participation. Do not invent tags to make a checklist appear complete.
- Numerical operations must reject CFD_AUTHORING_ONLY without mutation. The native disabled Under construction notice remains visible. No Force, Result or Flow lines controls until a separately qualified solver exists.
- Use native transforms, pivot, HASH, Undo, animation, duplication, shared field schemas and the single core viewport/device. Never touch the user's tabs or scene.
- Test node --test plugins/cfd/tests/authoring.test.mjs and node plugins/cfd/tests/browser.mjs --headless, then repository npm test and npm run test:stress. Coordinate GPU use. Record source-bound reports and distinguish pending/full-suite failures from focused passes.
