'use strict';
// Worker_threads provides real message ports and structured clones for the exact
// retained Worker source. This is CPU/protocol QA, not browser/PWA/GPU acceptance.
const {parentPort,workerData}=require('worker_threads'),vm=require('vm'),fs=require('fs');
globalThis.self=globalThis;globalThis.postMessage=(data,transfer)=>parentPort.postMessage(data,transfer);
Object.defineProperty(globalThis,'navigator',{value:{hardwareConcurrency:4,userAgent:'Chrome',appName:'Netscape'},configurable:true});
vm.runInThisContext(fs.readFileSync(workerData.source,'utf8'),{filename:workerData.source});
parentPort.on('message',data=>Promise.resolve(self.onmessage({data})).catch(e=>parentPort.postMessage({type:'error',message:e.stack,code:e.code})));
