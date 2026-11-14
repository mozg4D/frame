# CFD

Native box authoring only. Runtime plugin.js never loads numerical research or captures solver geometry.

- Local box (-500,0,-500)..(500,1000,500) mm; pivot lower corner. Mid-height arrow spans -X to +X faces regardless of pivot edits, not a streamline.
- Stored fields: Speed >=0 m/s (default 20), Medium Air/Water, finite Altitude metres (0), Ground None/Road. No physical effects; native transforms/animation/Undo/duplicate/HASH and manifest constraints own authoring.
- status returns detached values, authoringOnly:true; solverAvailable/resultsAvailable/geometryDiagnosticAvailable/geometryEvaluated:false. solve-frame/solve-animation/results reject CFD_AUTHORING_ONLY before work/mutation. Disabled Under construction; no Force/Result/Flow lines UI.
- No semantic/source tags/manual source selection. Intended participation is automatic evaluated geometry intersecting each independent box, including clipped occurrences.
- Production target: transient D3Q27 Cumulant, WALE/WMLES, moving cut-links, block AMR; BGK reference-only. Imported normals are not physical normals. Arbitrary animation needs physical-time positions/wall velocities, flow history and fluid/solid refill. Device limits determine memory/resolution, no fixed GPU-memory requirement.
- Shared capture lacks arbitrary physical-time sampling/vertex velocities. Qualify that contract, GPU cut-links/occupancy/conservative moving boundaries, mass/momentum/force/torque, SI scaling and production collision/turbulence before Solve. CPU geometry oracles are not a scene solver.

Checks: node --test plugins/cfd/tests/authoring.test.mjs; node plugins/cfd/tests/browser.mjs --headless. tests/index.mjs supplies current-core hardware authoring gate; no numerical results exist to qualify.
