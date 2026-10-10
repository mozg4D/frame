'use strict';
// Synthetic, self-contained checks only. No private model or installed package is needed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);
require('../scripts/prepare-workers.cjs').prepareWorkers(root);
fs.mkdirSync('evidence', { recursive: true });
const started = performance.now();
const results = [];
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const coreFiles = fs.readdirSync('core').filter(f => /\.(cjs|js)$/.test(f)).sort();
const kernel = crypto.createHash('sha256');
for (const name of coreFiles) { kernel.update(name); kernel.update(fs.readFileSync(path.join('core', name))); }
const kernelRevision = kernel.digest('hex');
const expectedRevision = '9ea9e79aebe55061e637b1e137f9836406b6119d0946ce7b622db6aa14db757f';
if (kernelRevision !== expectedRevision) throw Error('Checkpoint 19 core revision mismatch');
let integrityFilesChecked = 0;
for (const line of fs.readFileSync('SHA256SUMS', 'utf8').trim().split('\n')) {
  const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
  if (!match || path.isAbsolute(match[2]) || match[2].split('/').includes('..')) throw Error('Invalid checksum entry');
  if (hash(fs.readFileSync(match[2])) !== match[1]) throw Error('Checksum mismatch: ' + match[2]);
  integrityFilesChecked++;
}
let syntaxFilesChecked = 0;
for (const dir of ['core', 'tests', 'scripts']) for (const file of fs.readdirSync(dir).filter(f => /\.(cjs|js)$/.test(f)).sort()) {
  const name = path.join(dir, file);
  const p = spawnSync(process.execPath, ['--check', name], { encoding: 'utf8' });
  if (p.status !== 0) throw Error('Syntax check failed: ' + name + '\n' + p.stderr);
  syntaxFilesChecked++;
}
const tests = [
  ['worker-reconstruction.cjs'],
  ['baseline.cjs'],
  ['regression.cjs'],
  ['accuracy-contract.cjs'],
  ['candidate-synthetic.cjs'],
  ['exact-sat.cjs'],
  ['checkpoint13-sanity.cjs'],
  ['annulus-light.cjs'],
  ['annulus-mesh-light.cjs'],
  ['physical-clockwise.cjs'],
  ['checkpoint19-input-guards.cjs'],
  ['T-fill-candidate-light.cjs'],
  ['T-fill-worker-light.cjs'],
  ['deposition-multiplicity.cjs'],
  ['T-rounded-prescribed-light.cjs'],
  ['T-open-portals-light.cjs'],
  ['T-open-portals-worker-light.cjs'],
  ['route-transition-ordinary.cjs'],
  ['route-ordered-provenance.cjs'],
  ['return-turn-seam-light.cjs'],
  ['corner-fan-light.cjs'],
  ['helper-transport.cjs'],
];
for (const [name, ...args] of tests) {
  const start = performance.now();
  const p = spawnSync(process.execPath, [path.join('tests', name), ...args], {
    encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024,
  });
  fs.writeFileSync(path.join('evidence', name + '.log'), (p.stdout || '') + (p.stderr || ''));
  const passed = p.status === 0 && !p.error;
  results.push({ test: name, status: passed ? 'PASS' : 'FAIL', elapsedMS: performance.now() - start });
  console.log(results.at(-1).status + ' ' + name);
  if (!passed) { console.error(p.error || p.stderr || p.stdout); break; }
}
const report = {
  status: results.length === tests.length && results.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL',
  node: process.version, kernelRevision, integrityFilesChecked, syntaxFilesChecked,
  tests: results, elapsedMS: performance.now() - started,
  scope: 'Synthetic CPU and Node worker protocol checks for an unintegrated development checkpoint.',
  syntheticOwnerAcceptedLayers: results.some(r => r.test === 'annulus-mesh-light.cjs' && r.status === 'PASS') ? 3 : 0,
  newCompleteTLayersAccepted: 0, wholeTPrescribedRouteResolved: false,
  roundedExterior90MaterialTargetTested: results.some(r => r.test === 'T-rounded-prescribed-light.cjs' && r.status === 'PASS'),
  commandedConvexPolygonMultiplicityTested: results.some(r => r.test === 'deposition-multiplicity.cjs' && r.status === 'PASS'),
  admissibleSpiralsAccepted: 0, physicalVolumeOrExtrusionMultiplicityValidated: false,
  productionIntegrationTested: false, physicalPrintingTested: false,
};
fs.writeFileSync('evidence/public-checks.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (report.status !== 'PASS') process.exitCode = 1;
