import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const tests=readdirSync('plugins/magneto/tests').filter(p=>p.endsWith('.test.mjs')).sort().map(p=>'plugins/magneto/tests/'+p);
const runtime=['plugins/magneto/physical-state.js','plugins/magneto/direct-kernel.js','plugins/magneto/materials.js','plugins/magneto/reference-solver.js','plugins/magneto/conductor-current.js'];
const docs=readdirSync('plugins/magneto').filter(p=>p.endsWith('.md')).sort().map(p=>'plugins/magneto/'+p);
const files=[...runtime,...tests,...docs,'package.json','README.md','preview-contract.json','preview-integration.md','tools/verify.mjs'];
const digest=()=>Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
const before=digest();
const run=spawnSync(process.execPath,['--test',...tests],{encoding:'utf8'});
const after=digest();
const output=(run.stdout||'')+(run.stderr||'');
const performance=output.split(/\r?\n/).filter(s=>s.startsWith('# {"operation":')).map(s=>JSON.parse(s.slice(2)));
const number=label=>Number(output.match(new RegExp('^# '+label+' (\\d+)$','m'))?.[1]??-1);
const stable=JSON.stringify(before)===JSON.stringify(after);
const report={timestamp:new Date().toISOString(),scope:'Bounded CPU Magneto numerical reference and opaque-state lifecycle only',status:run.status===0&&stable?'PASS_CPU_REFERENCE_ONLY':'FAIL',
  tests:number('tests'),pass:number('pass'),fail:number('fail'),skipped:number('skipped'),sourceBefore:before,sourceAfter:after,sourceUnchanged:stable,performance,exitCode:run.status,
  independentReview:['plugins/magneto/numerical-review.md; 9 retained independent numerical cases','plugins/magneto/conductor-review.md; 8 independent explicit-graph cases'],
  physicalApproximations:['Symmetric Plummer dipole Hessian; no exact finite-body/tiny-gap qualification','Equivalent-sphere -M/3 diagonal; general multi-sample refinement unqualified','Explicit synthetic tanh/vector-play laws; no real calibrated material presets','Explicit graph minimum Joule power with integrated average cut density; no native polygon preprocessing, continuum boundary qualification or source-reaction loads','Optional supplied straight-tube midpoint current quadrature; no general spatial convergence claim','Fixed-moment interaction energy, not complete nonlinear free energy'],
  capabilities:{magneticSamplesMax:128,currentSamplesMax:2048,currentBasesMax:16,conductorGraphNodesMax:32,conductorGraphEdgesMax:64,explicitGraphCurrentOracle:true,nativeConductorTopology:false,rigidTransforms:true,nativeGeometry:false,gpu:false,hybridFarField:false,calibratedPresets:false,thisFolderNativePreview:'CONTRACT_ONLY_NOT_INSTALLABLE',solveAnimation:false},
  separateNativePreview:{status:'AUTHORING_PREVIEW_PRESENT_SOLVE_DISABLED',evidence:'Coordinator read-only main audit; not a browser/GPU check by this verification',mainAnchor:'649c046723fc2d181e75d234c43ddf73f5165e75',runtimeBlob:'fe2ca2ebe251ed60f57eabc09bce5408135fbf54'},
  publication:'NONE; current Frame batch and main/live not changed',
  candidateRecovery:{prefix:'1f1eb902',fullGitBlobSHA:null,status:'UNKNOWN orphan-blob outcome; no upload retry',
    gitTreeInspection:{scope:'Historical prior inspection only; superseded for current main by separateNativePreview',main:'82b0cc7bc4eadd832f1af535fd21c461c439967c',exchange:'1a05e41062982587b58c668fce6d52a0d14aef03',result:'No Magneto path at that historical inspection time'},
    specification:{bytes:41657,sha256:'4af36eb3073313a02243d5269cb938f9ac88e1f427408d7a65f242b7b91ab77e'}}};
mkdirSync('results',{recursive:true});writeFileSync('results/final-tests.tap',output);writeFileSync('results/verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
if(run.status!==0||!stable)process.exitCode=1;
