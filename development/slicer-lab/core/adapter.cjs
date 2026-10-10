'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
function load(workerFile='upstream-worker.js'){fs.mkdirSync(path.join(__dirname,'../evidence'),{recursive:true});const c={console,performance,structuredClone,setTimeout,clearTimeout,navigator:{userAgent:'Chrome',appName:'Netscape',hardwareConcurrency:2}};c.self=c;c.postMessage=()=>{};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,workerFile),'utf8'),c);return {placement:(rings,W=1,count=1)=>c.frameAdaptivePlacement(rings,W,count),context:c};}
module.exports={load};


