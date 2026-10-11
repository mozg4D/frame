'use strict';
// Current loaded worker is checked before all controls. Reports stay outside the checkout.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),core=require('../../build-cache.cjs'),loaded=require('../../rebuild.cjs').loadSources(),stages=core.build(loaded.workerBeforeCache,loaded.printerCurrent),repo=path.resolve(__dirname,'../../..');
assert.equal(stages.candidate,loaded.workerCurrent);const root=process.env.FRAME_CACHE_REPORT_ROOT?path.resolve(process.env.FRAME_CACHE_REPORT_ROOT):fs.mkdtempSync(path.join(os.tmpdir(),'frame-r242-cache-'));
assert(root!==repo&&!root.startsWith(repo+path.sep),'Reports must stay outside the checkout');fs.mkdirSync(root,{recursive:true});
fs.writeFileSync(path.join(root,'cache-template.js'),core.template);fs.copyFileSync(path.join(__dirname,'prior-clearances.json'),path.join(root,'prior-clearances.json'));
module.exports={...core,...stages,root,repo,fs,path,P0:stages.base};
