/** Per-view numeric coordinates. Authored matrices and local geometry stay absolute.
 * Translate in Float64 before the final GPU conversion; never rebase a derived array.
 */
import {IDENTITY,multiply4} from './gpu-selection.mjs';
const zero=Object.freeze([0,0,0]),rows=new WeakMap();
export function frameOrigin(value=zero){
 const o=Array.from(value);if(o.length!==3||!o.every(Number.isFinite))throw Error('Finite frame origin required');return o;
}
export function relativeWorldMatrix(world,origin){
 const o=frameOrigin(origin),m=new Float64Array(world);if(m.length!==16||!m.every(Number.isFinite))throw Error('Finite absolute world matrix required');
 if(m[3]!==0||m[7]!==0||m[11]!==0||m[15]!==1)throw Error('Camera-relative world transform must be affine');
 for(let k=0;k<3;k++)m[12+k]-=o[k];if(!m.every(Number.isFinite))throw Error('Relative world transform overflow');return m;
}
export function relativeViewMatrix(view,origin){
 const t=new Float64Array(IDENTITY),o=frameOrigin(origin);t.set(o,12);const m=multiply4(view,t);
 if(!m.every(Number.isFinite))throw Error('Relative view transform overflow');return m;
}
export function relativeInstances(instances,origin=zero){
 const o=frameOrigin(origin);if(instances.worldOrigin?.every((x,i)=>Object.is(x,o[i])))return instances;
 if(!instances.worldOrigin&&o.every(x=>x===0))return instances;
 const absolute=instances.absoluteInstances??instances,key=JSON.stringify(o);let cache=rows.get(absolute);if(!cache)rows.set(absolute,cache=new Map());if(cache.has(key))return cache.get(key);
 const {count,data,worldMatrices}=absolute;if(!Number.isSafeInteger(count)||count<0||data.length!==count*36||worldMatrices&&worldMatrices.length!==count*16)throw Error('Relative instance snapshot layout mismatch');
 const copy=new Float32Array(data);for(let i=0;i<count;i++)copy.set(relativeWorldMatrix(worldMatrices?.subarray(i*16,i*16+16)??data.subarray(i*36,i*36+16),o),i*36);
 if(!copy.every(Number.isFinite))throw Error('Relative display matrix Float32 overflow');
 const row={...absolute,data:copy,worldOrigin:Object.freeze(o),absoluteInstances:absolute};cache.set(key,row);if(cache.size>8)cache.delete(cache.keys().next().value);return row;
}
/** Printer-local warning coordinates use inverse*T(origin), while direction vectors
 * and local segment/instance positions keep their original values. */
export function relativeDisplayPacket(packet,origin=zero){
 if(!packet.kind.startsWith('printer-'))return {...packet,instances:relativeInstances(packet.instances,origin)};
 packet=packet.absolutePacket??packet;
 const o=frameOrigin(origin),t=new Float64Array(IDENTITY);t.set(o,12);
 const world=relativeWorldMatrix(packet.uniforms.world,o),inverse=multiply4(packet.uniforms.printerInverse,t);
 if(!inverse.every(Number.isFinite))throw Error('Relative printer inverse overflow');
 const data=new Float32Array(packet.instances.data);data.set(world);
 return {...packet,absolutePacket:packet,worldOrigin:Object.freeze(o),instances:{...packet.instances,data},uniforms:{...packet.uniforms,world:Array.from(world),printerInverse:Array.from(inverse)}};
}
export function relativeDisplaySnapshot(snapshot,origin=zero){return {...snapshot,packets:snapshot.packets.map(p=>relativeDisplayPacket(p,origin))};}
/** Depth/ribbon/selection combine the captured Float64 projection/view/model first.
 * Source Float32 instance attributes retain their existing precision limitation. */
export function relativeClipMatrices(instances,camera){
 const o=frameOrigin(camera.worldOrigin),absolute=instances.absoluteInstances??instances,view=camera.viewProjection64??camera.viewProjection,out=new Float32Array(instances.count*16);
 for(let i=0;i<instances.count;i++){
  const world=absolute.worldMatrices?.subarray(i*16,i*16+16)??absolute.data.subarray(i*36,i*36+16);
  out.set(multiply4(view,relativeWorldMatrix(world,o)),i*16);
 }
 if(!out.every(Number.isFinite))throw Error('Relative picker clip matrix Float32 overflow');return out;
}
