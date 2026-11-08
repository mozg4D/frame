// Test-only browser report collection/classification, no browser launch.
import assert from 'node:assert/strict';
import {sceneDataStartupDiagnostics,sceneDataStartupStatus} from './scene-control-data-browser.mjs';
const checks=[];
const dataset={ready:'error',operationError:"Cannot read properties of undefined (reading 'get')",operationStack:'TypeError: exact native stack\n  at reserveObjects'};
const diagnostics=await sceneDataStartupDiagnostics({evaluate:async fn=>{const text=fn.toString();assert.ok(text.includes('canvas.dataset'));return {url:'http://localhost/index.html',canvasPresent:true,dataset};}});
assert.deepEqual(diagnostics.dataset,dataset);checks.push('Native operationError/operationStack retained unchanged');
assert.equal(sceneDataStartupStatus({session:{},diagnostics,startupErrors:[]}), 'failed');checks.push('Native startup exception is failed, not environment blocked');
for(const operationError of ['WebGPU is unavailable in this browser.','No WebGPU adapter found.'])assert.equal(sceneDataStartupStatus({session:{},diagnostics:{dataset:{ready:'error',operationError}},startupErrors:[]}), 'blocked');checks.push('Exact unavailable-browser/adapter diagnostics remain blocked');
assert.equal(sceneDataStartupStatus({session:undefined,diagnostics:null,startupErrors:[]}), 'blocked');checks.push('Helper import/launcher absence remains blocked');
assert.equal(sceneDataStartupStatus({session:{},diagnostics:{dataset:{ready:'error',operationError:'No WebGPU adapter found.'}},startupErrors:['TypeError: unrelated app exception']}), 'failed');checks.push('Actual page errors cannot be masked by unavailable-adapter classification');
const unavailable=await sceneDataStartupDiagnostics({evaluate:async()=>{throw Error('Page closed before capture');}});assert.equal(unavailable.readError.message,'Page closed before capture');assert.equal(sceneDataStartupStatus({session:{},diagnostics:unavailable,startupErrors:[]}), 'failed');checks.push('Diagnostic capture failure is explicit and never converted to pass');
console.log(JSON.stringify({pass:true,checks,browserVerified:false,gpuVerified:false},null,2));
