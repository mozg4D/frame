// Fail closed on any change to the reviewed selection, dependency graph or runtime.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve, posix} from 'node:path';
const root = new URL('../', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const prohibited = /geometry\.unite|prepareVolume|prepare-volume|uniteMeshes|uniteWorker|unitePrepare|uniteSplit|uniteFinish|volumeReconstruct|unite-[a-z]/i;
export async function auditNonUnite() {
  const profile = JSON.parse(await readFile(new URL('tests/release-non-unite-profile.json', root)));
  const sources = {}, edges = {}, external = new Set();
  for (const [path, expected] of Object.entries(profile.sources)) {
    const bytes = await readFile(new URL(path, root));
    sources[path] = sha(bytes);
    assert.equal(sources[path], expected, 'Reviewed source changed: ' + path);
  }
  // These files have been reviewed in full, not accepted merely by a token scan.
  // Hashes fence dynamic calls, fixture loads and browser-evaluated callbacks too.
  for (const path of profile.modules) {
    const text = await readFile(new URL(path, root), 'utf8');
    assert.ok(!prohibited.test(text), 'Forbidden execution route: ' + path);
    const imports = [...text.matchAll(/\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1] || m[2]);
    edges[path] = [];
    for (const specifier of imports) {
      if (specifier.startsWith('.')) {
        const dependency = posix.normalize(posix.join(posix.dirname(path), specifier));
        assert.ok(profile.modules.includes(dependency), path + ' has an unaudited dependency: ' + dependency);
        edges[path].push(dependency);
      } else {
        assert.ok(specifier.startsWith('node:') || specifier === 'playwright', 'Unaudited external import: ' + specifier);
        external.add(specifier);
      }
    }
    assert.equal((text.match(/\bimport\s*\(/g) || []).length, [...text.matchAll(/\bimport\s*\(\s*['"][^'"]+['"]\s*\)/g)].length, 'Nonliteral dynamic import: ' + path);
  }
  // Spawned child is not an ES import; include its full dependency closure.
  assert.ok(profile.modules.includes('tools/mcp.mjs'));
  assert.match(await readFile(new URL('tests/mcp.spec.mjs', root), 'utf8'), /join\(root,'tools\/mcp\.mjs'\)/);
  edges['tests/mcp.spec.mjs'].push('tools/mcp.mjs');
  assert.deepEqual(edges, profile.edges, 'Reviewed transitive execution graph changed');
  const html = await readFile(new URL('index.html', root), 'utf8');
  const start = html.indexOf('    async function evaluateBoolean(n,state){'), end = html.indexOf('\n    let pathtracer=', start);
  assert.ok(start >= 0 && end > start);
  const booleanRoute = html.slice(start, end);
  assert.ok(!prohibited.test(booleanRoute), 'Legacy Boolean routes into Unite');
  assert.match(booleanRoute, /cmd:'run'/);
  assert.match(booleanRoute, /cmd:'planar'/);
  assert.ok(html.includes('if(String(data.cmd).startsWith("unite")||String(data.cmd).startsWith("volume")){const result=await uniteWorker(data)'));
  const shared = await readFile(new URL('tests/suite.js', root), 'utf8');
  assert.match(shared, /n\.spline\.cells===2304/);
  assert.match(shared, /g\.triangles===190291/);
  assert.ok(profile.modules.includes('tests/heavy-live.mjs') && profile.modules.includes('tests/viewport-status.mjs'));
  const standard = await readFile(new URL('tests/run.mjs', root), 'utf8');
  const stages = [...new Set([...standard.matchAll(/report\.(\w+)\s*=await\s+(?:isolated|runStage|viewLiveChecks|mcpChecks)/g)].map(m => m[1]))].sort();
  assert.deepEqual([...profile.selectedStandardStages, ...profile.excludedStandardStages.map(x => x.stage)].sort(), stages, 'Every original standard stage must be selected or explicitly excluded');
  assert.ok(profile.excludedStandardStages.some(x => x.stage === 'handWorkflow'));
  assert.ok(profile.excludedStandardStages.some(x => x.stage === 'uniteIntegration'));
  return {pass:true, profile:profile.name, sources, edges, external:[...external].sort(), selected:profile.selectedStandardStages, excluded:profile.excludedStandardStages, limits:profile.limits};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await auditNonUnite();
  console.log(JSON.stringify({pass:report.pass, profile:report.profile, boundSources:Object.keys(report.sources).length, auditedModules:Object.keys(report.edges).length, selected:report.selected, excluded:report.excluded, limits:report.limits}, null, 2));
}
