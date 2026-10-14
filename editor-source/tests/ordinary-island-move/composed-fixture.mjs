import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import * as Native from '../../../modules/native.4ec912c8a6f2b4d498f1.js';
import {OrdinaryMoveActor} from '../../../native-source/ordinary-move-actor.mjs';
import {fixture} from './integration-fixture.mjs';
import {device} from './emulated-device.mjs';
globalThis.GPUBufferUsage={STORAGE:128,COPY_DST:8,COPY_SRC:4,INDEX:16,UNIFORM:64};
export const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],delta=x=>{const m=identity.slice();m[12]=x;return m;};
export const tick=()=>new Promise(r=>setTimeout(r,0));
class Actor extends OrdinaryMoveActor {constructor(options){super({...options,WorkerType:Worker});}}
export async function scene({geometry=null}={}){
 const d=device(),pool=new Native.GpuBufferPool(d),q=fixture({ActorType:Actor,device:d,pool});
 if(geometry)q.mesh.geometry=geometry;
 q.ctx.console={error(){}};q.ctx.errors=[];q.ctx.frameNativeSelectionError=e=>q.ctx.errors.push(e);
 q.ctx.pushCmd=c=>q.ctx.undoStack.push(c);q.ctx.frameOrdinaryPrepare=()=>null;
 const r=q.ctx.frameOrdinaryOwner('A');await r.actor.ready;
 return{...q,d,pool,r,a:r.actor};
}
export const context={domain:'vertex',space:'world',world:identity,inverse:identity,ownerFrame:identity,identity};
export async function prepared(a){return a.read({vertices:[0],edges:[],faces:[]},context);}
export async function gesture(a,q,x){const j=a.start(Promise.resolve(q),context);a.pose(j,delta(x),delta(x));await j.display;await j.row.scheduler.whenIdle();return j;}
