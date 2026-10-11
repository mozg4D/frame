'use strict';
// Pure source transformation; returns strings without editing runtime files.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),root=__dirname;
function build(worker,printer,{telemetry=true}={}){
 const prior=require('./build-transport-errors.cjs').build(worker,printer,{telemetry}),anchor='self.onmessage=async({data})=>{';
 const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
 if(digest(prior.worker)!==(telemetry?'e6fedf4666c1a49ba4a8eae3728eacb819c7665bd40329b20e65b65da5b52fdc':'861aa2c445936fc9978126b4218d18af1780055abb4d8e818919ee6a1b43e6dc')||digest(prior.printer)!==(telemetry?'f24e92450854a3d49f8f89579d158261b2cd9a364bd65a7f5cf023495b84c29d':'990bb6aa64b28e794d609859ab84d1e608c0d4b563bcc9e92810972b6a733a9e'))throw Error('Prior two-fixes candidate hash mismatch');
 if(prior.worker.split(anchor).length!==2)throw Error('Unique worker-global receiver anchor required');
 const handler="// A Worker is owned by one Frame task; undecodable control packets cannot supply a runId.\nself.onmessageerror=()=>{self.postMessage({type:'error',message:'Slicer worker control message could not be decoded.',code:'FRAME_SLICE_MESSAGE_ERROR'});};\n";
 return {worker:prior.worker.replace(anchor,handler+anchor),printer:prior.printer};
}
module.exports={build};
