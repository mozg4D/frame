/** Fresh owner/device/generation-bound cubic startup capabilities.
 * This service borrows an existing owner; it never acquires or destroys one.
 * The scalar profile is measured against a temporary GL oracle, not inferred
 * from adapter names. Material subset validation still runs on each draw.
 */
import {measureFrameCubicDerivativeProfile} from './cubic-derivative-calibration.mjs';
import {assertCubicWindowDerivativeCapability,assertCubicWindowMipDerivativeCapability} from './gpu-cubic-map.mjs';
const abort=message=>new DOMException(message,'AbortError');
const freezeTree=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freezeTree(child);Object.freeze(value);}return value;};
const detached=value=>freezeTree(JSON.parse(JSON.stringify(value)));
export class FrameCubicWindowCapabilities {
 constructor({THREE,measure=measureFrameCubicDerivativeProfile,experimentalMSAA=false,measureTextureLOD=null}={}){
  if(typeof measure!=='function'||measureTextureLOD!==null&&typeof measureTextureLOD!=='function')throw Error('Explicit cubic capability measurement functions required');
  this.THREE=THREE;this.measure=measure;this.measureTextureLOD=measureTextureLOD;this.experimentalMSAA=experimentalMSAA===true;
  this.cache=new WeakMap();this.rows=new Set();this.pending=new Set();this.disposed=false;
 }
 _current(row){return !this.disposed&&row.active&&row.owner.state==='ready'&&row.owner.device===row.device&&Object.is(row.owner.generation,row.generation);}
 async resolve(owner,{isCurrent=()=>true}={}){
  if(typeof isCurrent!=='function')throw Error('Cubic capability caller guard required');
  if(this.disposed||owner?.state!=='ready'||!owner.device?.queue||!isCurrent())throw abort('Cubic startup owner or caller is not current');
  let row=this.cache.get(owner);
  if(row&&!this._current(row)){row.active=false;row.unsubscribe?.();this.rows.delete(row);this.cache.delete(owner);row=null;}
  if(!row){
   row={owner,device:owner.device,generation:owner.generation,active:true};this.rows.add(row);this.cache.set(owner,row);
   row.unsubscribe=owner.onLoss?.(()=>{row.active=false;row.unsubscribe?.();this.rows.delete(row);if(this.cache.get(owner)===row)this.cache.delete(owner);});
   row.promise=(async()=>{
    try{
     const calibration=detached(await this.measure({sharedDevice:owner,THREE:this.THREE}));
     if(!this._current(row))throw abort('Cubic owner changed during scalar calibration');
     // Validate the measured profile at 1x. This dummy policy validates only
     // calibration; encode independently checks the actual texture and height.
     assertCubicWindowDerivativeCapability({calibration,canvasHeight:8,sampleCount:1,texturePolicy:{mipLevelCount:1,sampler:{minFilter:'linear',magFilter:'linear',maxAnisotropy:1}},experimentalMSAA:false});
     const textureLODCalibration=this.measureTextureLOD?detached(await this.measureTextureLOD({sharedDevice:owner,THREE:this.THREE,calibration,isCurrent:()=>this._current(row)})):null;
     if(!this._current(row))throw abort('Cubic owner changed during texture calibration');
     if(textureLODCalibration){if(!Object.is(textureLODCalibration.mipGenerationSelection?.ownerGeneration,row.generation))throw abort('Mip generation receipt belongs to another owner generation');assertCubicWindowMipDerivativeCapability({calibration,textureLODCalibration,canvasHeight:8,sampleCount:this.experimentalMSAA?4:1,experimentalMSAA:this.experimentalMSAA,texturePolicy:{width:2,height:2,mipLevelCount:2,sampler:{minFilter:'linear',magFilter:'linear',mipmapFilter:'linear',lodMinClamp:0,lodMaxClamp:1,maxAnisotropy:1}},sourceTexture:{minFilter:1008,magFilter:1006,generateMipmaps:true,anisotropy:1,mipmaps:[]}});}
     const capability={calibration,experimentalMSAA:this.experimentalMSAA,ownerGeneration:row.generation,isCurrent:()=>this._current(row),...(textureLODCalibration?{textureLODCalibration}:{})};
     Object.defineProperty(capability,'device',{value:row.device});return Object.freeze(capability);
    }catch(error){row.active=false;row.unsubscribe?.();this.rows.delete(row);if(this.cache.get(owner)===row)this.cache.delete(owner);throw error;}
   })();
   this.pending.add(row.promise);row.promise.then(()=>this.pending.delete(row.promise),()=>this.pending.delete(row.promise));
  }
  const capability=await row.promise;
  if(!this._current(row)||!isCurrent())throw abort('Cubic startup completion is stale');return capability;
 }
 async dispose(){
  if(this.disposed)return;this.disposed=true;
  for(const row of this.rows){row.active=false;row.unsubscribe?.();}this.rows.clear();
  await Promise.allSettled([...this.pending]);
 }
}
