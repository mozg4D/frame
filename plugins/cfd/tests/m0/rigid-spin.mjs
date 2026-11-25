import {sweptDiameter,frozenWallMotion} from '../../plugin.js';


export async function nativeAxialSpin(device,ctx,owner,options){
  const result=frozenWallMotion(device,ctx,owner,options);
  if(result.motion)result.motion.diameterM=await sweptDiameter(device,result.capture);
  result.assertCurrent();return result;
}
