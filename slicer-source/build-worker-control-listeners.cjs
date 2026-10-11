'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),root=__dirname;
function build(worker,printer,{telemetry=true}={}){
 const prior=require('./build-worker-global-errors.cjs').build(worker,printer,{telemetry});let p=prior.printer;
 for(const [name,role]of [['child','helper'],['owner','owner']]){
  const a=`${name}.onmessageerror=()=>finish(Object.assign(Error('Slicer ${role} control message could not be decoded.'),{code:'FRAME_SLICE_MESSAGE_ERROR'}));`;
  const b=`${name}.addEventListener('messageerror',()=>finish(Object.assign(Error('Slicer ${role} control message could not be decoded.'),{code:'FRAME_SLICE_MESSAGE_ERROR'})));`;
  if(p.split(a).length!==2)throw Error('Unique parent listener anchor '+name);p=p.replace(a,b);
 }
 return {worker:prior.worker,printer:p};
}
module.exports={build};
