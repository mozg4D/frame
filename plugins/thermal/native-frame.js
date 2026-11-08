// Exact resource-free physical-frame validator reused from the earlier authoring candidate.
// No Probe sampling, field state or numerical execution is installed in this preview.
const fail = (code, message) => Object.assign(new Error(message), {code});
export function copyPhysicalFrame(frame) {
  if(!frame||frame.kind!=='physical-owner'||!Array.isArray(frame.ownerWorld)||frame.ownerWorld.length!==16||Array.from(frame.ownerWorld).some(x=>!Number.isFinite(x)))throw fail('INVALID_ARGUMENT','Invalid physical field frame.');
  const m=frame.ownerWorld;if(m[3]!==0||m[7]!==0||m[11]!==0||m[15]!==1)throw fail('INVALID_ARGUMENT','Physical field frame must be affine.');
  const axes=[0,4,8].map(i=>m.slice(i,i+3)),lengths=axes.map(a=>Math.hypot(...a));
  if(lengths.some(x=>!Number.isFinite(x)||x<=0))throw fail('INVALID_ARGUMENT','Physical field frame must be invertible.');
  const unit=axes.map((a,i)=>a.map(x=>x/lengths[i]));
  for(let a=0;a<3;a++)for(let b=a+1;b<3;b++)if(Math.abs(unit[a].reduce((s,x,k)=>s+x*unit[b][k],0))>1e-10)throw fail('INVALID_ARGUMENT','Sheared physical field frames are unsupported.');
  return Object.freeze({kind:'physical-owner',ownerWorld:Object.freeze([...m])});
}
