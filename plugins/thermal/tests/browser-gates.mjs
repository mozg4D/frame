// Pure acceptance predicates shared by the hardware harness and its CPU negative
// controls. Test helpers only: no authoring/runtime behavior or GPU emulation.
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function isHardwareAdapter(hardware){
 return !!hardware&&typeof hardware==='object'&&hardware.isFallbackAdapter===false&&Object.values(hardware).some(v=>typeof v==='string'&&v)&&!/swiftshader|llvmpipe|lavapipe|software/i.test(JSON.stringify(hardware));
}
export function isDecodedNativeIcon(icon){
 return !!icon&&icon.decoded===true&&icon.complete===true&&icon.width===32&&icon.height===32&&icon.naturalWidth===32&&icon.naturalHeight===32&&icon.rect?.width===32&&icon.rect?.height===32;
}
export function hasBoundedFrameTimings(sample){
 return !!sample&&sample.timestampQueries===true&&Array.isArray(sample.frames)&&sample.frames.length===12&&sample.frames.every(f=>Number.isFinite(f.cpuMs)&&Number.isFinite(f.gpuMs)&&f.cpuMs<50&&f.gpuMs<50);
}
export function restoresAuthoringRows(actual,expected,requiredHashes){
 if(!Array.isArray(actual)||!Array.isArray(expected)||!Array.isArray(requiredHashes)||requiredHashes.length!==3||new Set(requiredHashes).size!==3||requiredHashes.some(h=>typeof h!=='string'||!h)||actual.length!==expected.length)return false;
 if(new Set(actual.map(n=>n.hash)).size!==actual.length||new Set(expected.map(n=>n.hash)).size!==expected.length)return false;
 if(!requiredHashes.every(hash=>actual.some(n=>n.hash===hash)&&expected.some(n=>n.hash===hash)))return false;
 return expected.every(before=>{const after=actual.find(n=>n.hash===before.hash);return !!after&&after.type===before.type&&after.parent===before.parent&&equal(after.matrix,before.matrix)&&equal(after.worldMatrix,before.worldMatrix)&&equal(after.params,before.params);});
}

// Playwright transports thrown Error objects without custom properties. Catch
// inside the page and return only primitive metadata before that boundary.
// Keep this callback self-contained: page.evaluate serializes its source.
export async function captureAuthoringRejection({id,operation,args}){
 try{
  await frameAI.call('plugins.command',{id,operation,args});
  return {resolved:true};
 }catch(error){
  return {resolved:false,code:typeof error?.code==='string'?error.code:null,message:typeof error?.message==='string'?error.message:null};
 }
}
