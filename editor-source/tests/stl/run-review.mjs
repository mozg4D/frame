import { sourceResult } from './source-loader.mjs';
import candidate from './candidate-oracles.mjs';
import independent from './independent-oracles.mjs';
import collision from './collision-and-negatives.mjs';
import edge from './edge-oracles.mjs';
import { runActualWorker } from './actual-worker.mjs';
const worker=await runActualWorker();
console.log(JSON.stringify({pass:true,source:sourceResult,candidate,independent,collision,edge,worker,scope:'Portable source and real Node workers; no browser, private model, physical-frame or hardware performance claim.'},null,2));
