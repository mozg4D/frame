import {gridDomain} from './domain-reference.js';
import {prepareResolvedCase} from '../structural-load/resolved-case.js';
const keys=Object.freeze(['Voxel size']);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
const vector=(a,n)=>a&&a.length===n&&Array.from(a).every(Number.isFinite);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const stale=()=>{throw Error('Stale or retired Structural geometry capture');};
function stamp(context){const s=context.fields.authoringStamp();if(typeof s?.epoch!=='string'||!Number.isSafeInteger(s.revision)||s.revision<0)throw Error('Native synchronous authoring stamp unavailable');return {epoch:s.epoch,revision:s.revision};}
/** Native geometry/resource observation and local grid recipe. No voxelization.
 * The current core capture has no structural effective tags. Do not infer them.
 */
export function captureStructuralDomain(context,ownerHash){
 if(!hash(ownerHash))throw Error('Canonical Structural owner hash required');
 if(typeof context?.fields?.authoringStamp!=='function'||typeof context?.scene?.capture!=='function'||typeof context?.scene?.signature!=='function'||typeof context?.document?.world!=='function')throw Error('Current native capture/stamp contract required');
 if(context.scene.transforming)throw Error('Native transform is active');
 const before=stamp(context),node=context.document.nodes.find(n=>n.nativeHash===ownerHash);
 if(node?.type!=='structural')throw Error('Structural owner unavailable');
 const pitch=node.params?.['Voxel size'];if(!Number.isFinite(pitch)||pitch<=0)throw Error('Positive native Voxel size in mm required');
 const world=Array.from(context.document.world(ownerHash)),frame=context.document.frame;
 if(!Number.isFinite(frame))throw Error('Independent native frame required');
 const domain=gridDomain({min:[-50,-50,-50],max:[50,50,50],pitchMetres:pitch*.001,world});
 if(domain.count>4096)throw Error('Resolved-load handoff capacity: 4096 cells');
 let snapshot=context.scene.capture(ownerHash,keys);
 if(!snapshot||snapshot.device!==context.device||typeof snapshot.signature!=='string'||!snapshot.signature||!Array.isArray(snapshot.meshes)||snapshot.meshes.length>100000||snapshot.params?.['Voxel size']!==pitch)throw Error('Inconsistent native geometry capture');
 if(!same(before,stamp(context)))stale();
 const metadata=[],resources=[],seen=new Set();
 for(const mesh of snapshot.meshes){
  if(!hash(mesh?.hash)||!Number.isSafeInteger(mesh.solid)||mesh.solid<0||seen.has(mesh.solid)||!vector(mesh.matrix,16)||mesh.matrix[3]!==0||mesh.matrix[7]!==0||mesh.matrix[11]!==0||mesh.matrix[15]!==1||!Number.isSafeInteger(mesh.vertexCount)||mesh.vertexCount<1||!Number.isSafeInteger(mesh.triangleCount)||mesh.triangleCount<1||!['buffer','texture'].includes(mesh.storage)||!mesh.positions||!mesh.indices)throw Error('Unsupported native mesh occurrence');
  seen.add(mesh.solid);
  const bounds=mesh.bounds;
  if(bounds&&(!vector(bounds.min,3)||!vector(bounds.max,3)||bounds.min.some((v,k)=>v>bounds.max[k])))throw Error('Invalid native broad-phase bounds');
  if(bounds&&bounds.min.some((v,k)=>v>domain.max[k]||bounds.max[k]<domain.min[k]))continue;
  const matrix=Array.from(mesh.matrix),info={hash:mesh.hash,solid:mesh.solid,matrix,bounds:bounds?{min:Array.from(bounds.min),max:Array.from(bounds.max)}:null,storage:mesh.storage,vertexCount:mesh.vertexCount,triangleCount:mesh.triangleCount};
  metadata.push(info);resources.push(Object.freeze({...info,matrix:Object.freeze(matrix),positions:mesh.positions,indices:mesh.indices}));
 }
 const descriptor=freeze({owner:ownerHash,frame,domain,occurrences:metadata,sceneSolved:false,analysisReady:false,occupancy:'unclassified',geometryReadbackBytes:0,effectiveTagsAvailable:false});
 let retired=false;
 function assertCurrent(){
  if(retired)stale();
  try{
   if(context.scene.transforming||context.device!==snapshot.device||context.document.frame!==frame||!same(before,stamp(context))||!same(world,Array.from(context.document.world(ownerHash)))||context.scene.signature(ownerHash,keys)!==snapshot.signature)stale();
  }catch{retired=true;resources.length=0;snapshot=null;stale();}
 }
 assertCurrent();
 return Object.freeze({descriptor,assertCurrent,
  borrowGeometry(){assertCurrent();return Object.freeze(resources.slice());},
  prepareAuthoredBoundaryCase(input){
   assertCurrent();
   if(input?.owner?.source!==ownerHash||input.frame!==frame||!same(input.cells,domain.cells)||!same(input.spacingMetres,domain.spacingMetres))throw Error('Resolved boundary case does not match captured owner/frame/grid');
   // An explicit authored mask is accepted as such, never as native occupancy.
   const prepared=prepareResolvedCase(input);assertCurrent();return {...prepared,geometryClassified:false,occupancyEvidence:'caller-authored resolved cells; not derived from capture'};
  },
  retire(){retired=true;resources.length=0;snapshot=null;}
 });
}
