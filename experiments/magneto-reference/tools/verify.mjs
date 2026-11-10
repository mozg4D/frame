import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const tests=readdirSync('plugins/magneto/tests').filter(p=>p.endsWith('.test.mjs')).sort().map(p=>'plugins/magneto/tests/'+p);
const runtime=['plugins/magneto/physical-state.js','plugins/magneto/direct-kernel.js','plugins/magneto/materials.js','plugins/magneto/reference-solver.js','plugins/magneto/conductor-current.js','plugins/magneto/reference-animation.js','plugins/magneto/finite-body.js'];
const docs=readdirSync('plugins/magneto').filter(p=>p.endsWith('.md')).sort().map(p=>'plugins/magneto/'+p);
const files=[...runtime,...tests,...docs,'package.json','README.md','CHRONOLOGY-HANDOFF.md','FINITE-BODY-HANDOFF.md','preview-contract.json','preview-integration.md','tools/verify.mjs'];
const digest=()=>Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
const before=digest();
const run=spawnSync(process.execPath,['--test','--test-reporter=tap',...tests],{encoding:'utf8'});
const after=digest();
const output=(run.stdout||'')+(run.stderr||'');
const performance=output.split(/\r?\n/).filter(s=>s.startsWith('# {"operation":')).map(s=>JSON.parse(s.slice(2)));
const number=label=>Number(output.match(new RegExp('^# '+label+' (\\d+)$','m'))?.[1]??-1);
const stable=JSON.stringify(before)===JSON.stringify(after);
const report={timestamp:new Date().toISOString(),scope:'Bounded CPU Magneto numerical, quasistatic chronological and prescribed-uniform-M cuboid references; opaque-state lifecycle only',status:run.status===0&&stable?'PASS_CPU_REFERENCE_ONLY':'FAIL',
  tests:number('tests'),pass:number('pass'),fail:number('fail'),skipped:number('skipped'),sourceBefore:before,sourceAfter:after,sourceUnchanged:stable,performance,exitCode:run.status,
  independentReview:['plugins/magneto/numerical-review.md; 9 retained independent numerical cases','plugins/magneto/conductor-review.md; 8 independent explicit-graph cases','plugins/magneto/tests/chronology-review.test.mjs; 7 independent chronological physical/provenance cases','plugins/magneto/finite-body-review.md; 6 independent prescribed-uniform-M cuboid cases'],
  physicalApproximations:['Symmetric Plummer dipole Hessian; no exact finite-body/tiny-gap qualification','Equivalent-sphere -M/3 diagonal; general multi-sample refinement unqualified','Explicit synthetic tanh/vector-play laws; no real calibrated material presets','Explicit graph minimum Joule power with integrated average cut density; no native polygon preprocessing, continuum boundary qualification or source-reaction loads','Optional supplied straight-tube midpoint current quadrature; no general spatial convergence claim','Fixed-moment interaction energy, not complete nonlinear free energy','Fixed-geometry explicit continuous piecewise-linear source history only; local adaptive error indicator is not a global history-error guarantee or transient electromagnetic model'],
  capabilities:{magneticSamplesMax:128,currentSamplesMax:2048,currentBasesMax:16,conductorGraphNodesMax:32,conductorGraphEdgesMax:64,explicitGraphCurrentOracle:true,nativeConductorTopology:false,rigidTransforms:true,nativeGeometry:false,gpu:false,hybridFarField:false,calibratedPresets:false,thisFolderNativePreview:'CONTRACT_ONLY_NOT_INSTALLABLE',solveAnimation:false,quasistaticExplicitScheduleReference:true,chronologyKnotsMax:128,chronologyAcceptedStepsMax:4096,chronologySolveEvaluationsMax:16384,chronologyDepthMax:20,nativeTimelineCurves:false},
  separateNativePreview:{status:'AUTHORING_PREVIEW_PRESENT_SOLVE_DISABLED',evidence:'Coordinator read-only main audit; not a browser/GPU check by this verification',mainAnchor:'649c046723fc2d181e75d234c43ddf73f5165e75',runtimeBlob:'fe2ca2ebe251ed60f57eabc09bce5408135fbf54'},
  publication:'NONE; current Frame batch and main/live not changed',
  candidateRecovery:{prefix:'1f1eb902',fullGitBlobSHA:null,status:'UNKNOWN orphan-blob outcome; no upload retry',
    gitTreeInspection:{scope:'Historical prior inspection only; superseded for current main by separateNativePreview',main:'82b0cc7bc4eadd832f1af535fd21c461c439967c',exchange:'1a05e41062982587b58c668fce6d52a0d14aef03',result:'No Magneto path at that historical inspection time'},
    specification:{bytes:41657,sha256:'4af36eb3073313a02243d5269cb938f9ac88e1f427408d7a65f242b7b91ab77e'}}};
mkdirSync('results',{recursive:true});writeFileSync('results/final-tests.tap',output);writeFileSync('results/verification.json',JSON.stringify(report,null,2)+'\n');
const chronologyReport={timestamp:report.timestamp,status:report.status,scope:'CPU_CHRONOLOGICAL_REFERENCE_ONLY',tests:report.tests,pass:report.pass,fail:report.fail,
  independentChronologyCases:7,implementationChronologyCases:8,sourceUnchanged:stable,sourceBefore:before,sourceAfter:after,
  performance:performance.filter(p=>p.operation.includes('chronological')),limits:{knots:128,acceptedSteps:4096,solveEvaluations:16384,refinementDepth:20},
  guarantees:['Every declared source knot is mandatory','Rejected trial states replay from immutable chronological baselines','Only full success returns final physical state and scalar trace','Cancellation, nonconvergence, exceptions and budget exhaustion expose no partial result'],
  limitations:['Quasistatic rate-independent synthetic materials, not transient Maxwell dynamics','Continuous piecewise-linear uniformH and complete signed current amplitudes; no undeclared pulse detection','Fixed geometry/material/sample layout; no transform interpolation','Local error estimate, not a certified accumulated history-error bound','No native Solve, timeline curves, checkpoint integration, GPU/browser/Frame qualification or publication']};
writeFileSync('results/chronology-report.json',JSON.stringify(chronologyReport,null,2)+'\n');console.log(JSON.stringify(report,null,2));
const finiteBodyReport={timestamp:report.timestamp,status:report.status,scope:'CPU_PRESCRIBED_UNIFORM_MAGNETIZATION_CUBOID_ORACLE_ONLY',tests:report.tests,pass:report.pass,fail:report.fail,implementationFiniteBodyCases:12,independentFiniteBodyCases:6,sourceUnchanged:stable,sourceBefore:before,sourceAfter:after,
  performance:performance.filter(p=>p.operation.startsWith('finite-body-')),
  method:'Analytic six-face magnetic charge integrals: solid angle normal and asinh/log tangential terms; no numerical library, dipole substitution or softened kernel',
  limits:{bodies:32,targets:512,aspectRatio:16,targetLocalCoordinatesInMinHalfSizes:64,surfaceCollarInMaxHalfSizes:1e-10,absoluteCoordinatesInMinHalfSizes:1e6,halfSizeRangeMetres:[1e-100,1e100],nonzeroMagnetizationComponentRangeAm:[1e-100,1e100]},
  guarantees:['Exterior B=mu0 H; interior/overlap B=mu0(H+sum covering prescribed M)','All-or-nothing frozen result; unsupported domain, nonfinite and undefined surface requests reject','Rigid local-to-world XYZW frames; prescribed M and geometry rotate together','No native persistence or JSON scene records in HASH; no existing solver/state/native integration changes'],
  limitations:['Exact mathematical cuboid face integral evaluated in IEEE double precision; no rigorous uniform floating-point error bound','Bounded domain and empirical fixtures, not arbitrary tiny-gap/edge/near-zero relative accuracy qualification','Uniform prescribed M only, not nonlinear soft-body demagnetization or spatial solver refinement','No loads/energy, calibrated presets, native geometry, rendering, GPU, browser, transient model or publication'],
  sources:['https://doi.org/10.1093/rasti/rzag015','https://magpylib.readthedocs.io/en/5.2.0/_pages/user_guide/examples/examples_misc_equivalent.html','https://math.nist.gov/~MDonahue/talks/hmm2007-MBO-03-accurate_demag.pdf']};
writeFileSync('results/finite-body-report.json',JSON.stringify(finiteBodyReport,null,2)+'\n');
if(run.status!==0||!stable)process.exitCode=1;
