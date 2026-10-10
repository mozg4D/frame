/** Persistent authoring identity and immutable dirty-page history.
 * GPU indices and coordinate-derived aliases are deliberately not identities.
 * Initial arrays are adopted exclusively; callers must never mutate/detach them.
 */
let authoringOwnerSerial=0;
const ownerTag='frame-authoring-v1';
const invalid=m=>{throw Error(m);};
const abort=()=>new DOMException('Authoring source changed','AbortError');
const pageVertices=2048;
export function authoringJobTag(mesh,jobId){
  if(!mesh.live)throw abort();
  return Object.freeze({sceneEpoch:mesh.sceneEpoch,objectIdentity:mesh.identity,
    geometryRevision:mesh.geometryRevision,topologyRevision:mesh.topologyRevision,
    policyRevision:mesh.policyRevision,jobId});
}
export function authoringTagEqual(a,b){
  return !!a&&!!b&&['sceneEpoch','objectIdentity','geometryRevision','topologyRevision','policyRevision','jobId'].every(k=>a[k]===b[k]);
}
export class AuthoringMesh {
  constructor({positions,indices=null,sceneEpoch=0,policyRevision=1,isSourceCurrent=()=>true}={}){
    if(!(positions instanceof Float32Array||positions instanceof Float64Array)||positions.length%3||indices===null&&positions.length%9)invalid('Triangle xyz authoring positions required');
    if(indices!==null&&(!(indices instanceof Uint16Array||indices instanceof Uint32Array)||indices.length%3))invalid('Triangle unsigned authoring index required');
    if(!Number.isSafeInteger(sceneEpoch)||sceneEpoch<0||!Number.isSafeInteger(policyRevision)||policyRevision<1)invalid('Invalid authoring revision');
    this.identity=ownerTag+':'+(++authoringOwnerSerial);this.sceneEpoch=sceneEpoch;
    this.geometryRevision=1;this.topologyRevision=1;this.policyRevision=policyRevision;
    this.positions=positions;this.indices=indices;this.vertexCount=positions.length/3;
    this.faceCount=(indices?.length??this.vertexCount)/3;
    this.pages=new Map();this.graph=null;this.graphRevision=0;this.operations=new Set();
    this.live=true;this.isSourceCurrent=isSourceCurrent;this.deletedVertices=new Set();this.deletedFaces=new Set();
    this.nextVertexId=this.vertexCount+1;this.nextFaceId=this.faceCount+1;
  }
  current(){return this.live&&this.isSourceCurrent();}
  matches(tag){return this.current()&&tag.sceneEpoch===this.sceneEpoch&&tag.objectIdentity===this.identity&&
    tag.geometryRevision===this.geometryRevision&&tag.topologyRevision===this.topologyRevision&&tag.policyRevision===this.policyRevision;}
  vertexId(slot){return Number.isInteger(slot)&&slot>=0&&slot<this.vertexCount&&!this.deletedVertices.has(slot+1)?slot+1:invalid('Unknown vertex slot');}
  vertexSlot(id){return Number.isInteger(id)&&id>0&&id<this.nextVertexId&&id<=this.vertexCount&&!this.deletedVertices.has(id)?id-1:invalid('Unknown authoring vertex ID');}
  faceId(slot){return Number.isInteger(slot)&&slot>=0&&slot<this.faceCount&&!this.deletedFaces.has(slot+1)?slot+1:invalid('Unknown face slot');}
  faceSlot(id){return Number.isInteger(id)&&id>0&&id<this.nextFaceId&&id<=this.faceCount&&!this.deletedFaces.has(id)?id-1:invalid('Unknown authoring face ID');}
  cornerVertexId(faceId,corner){const face=this.faceSlot(faceId);if(!Number.isInteger(corner)||corner<0||corner>2)invalid('Invalid corner ordinal');return this.vertexId(this.indices?this.indices[face*3+corner]:face*3+corner);}
  coordinate(slot,axis){if(!Number.isInteger(slot)||slot<0||slot>=this.vertexCount||!Number.isInteger(axis)||axis<0||axis>2)invalid('Invalid authoring coordinate');const page=Math.floor(slot/pageVertices),values=this.pages.get(page);return values?values[(slot%pageVertices)*3+axis]:this.positions[slot*3+axis];}
  /** Private bounded transfer view: copy contiguous immutable runs, never live buffers. */
  captureRange(offset,length){
    if(!Number.isInteger(offset)||!Number.isInteger(length)||offset<0||length<0||length>16384||offset+length>this.positions.length)invalid('Invalid bounded authoring capture');
    const values=new this.positions.constructor(length),pageWords=pageVertices*3;
    for(let at=offset;at<offset+length;){const page=Math.floor(at/pageWords),local=at-page*pageWords,end=Math.min(offset+length,(page+1)*pageWords),source=this.pages.get(page);values.set(source?source.subarray(local,local+end-at):this.positions.subarray(at,end),at-offset);at=end;}return values;
  }
  beginOperation(){
    if(!this.current())throw abort();
    const op={owner:this.identity,revision:this.geometryRevision,topology:this.topologyRevision,graph:this.graph,closed:false};
    this.operations.add(op);return op;
  }
  endOperation(op){if(op?.owner!==this.identity||!this.operations.has(op))invalid('Foreign operation');op.closed=true;this.operations.delete(op);}
  installGraph(tag,graph){
    if(!this.matches(tag)||this.operations.size)return false;
    if(!graph||graph.vertexCount!==this.vertexCount||graph.faceCount!==this.faceCount)invalid('Wrong derived graph shape');
    this.graph=Object.freeze({tag,topology:graph});this.graphRevision++;return true;
  }
  invalidate({topology=false,policy=false}={}){
    if(!this.live)return;this.geometryRevision++;if(topology)this.topologyRevision++;if(policy)this.policyRevision++;
    this.graph=null;
  }
  dispose(){if(!this.live)return;this.live=false;this.sceneEpoch++;this.geometryRevision++;this.graph=null;for(const op of this.operations)op.closed=true;this.operations.clear();}
  /** Prepare coordinates and exact deltas without mutating the visible/current store. */
  *prepareTransform(ids,transform,{operation=null,batch=512}={}){
    if(typeof transform!=='function'||!Number.isInteger(batch)||batch<1)invalid('Transform and positive batch required');
    const tag=authoringJobTag(this,0),beforePages=this.pages,afterPages=new Map(beforePages),seen=new Set(),affected=[],before=[],after=[];
    const valid=()=>this.matches(tag)&&this.pages===beforePages&&(!operation||this.operations.has(operation)&&!operation.closed&&operation.revision===this.geometryRevision);
    let work=0;const check=()=>{if(!valid())throw abort();};check();
    for(const id of ids){
      const slot=this.vertexSlot(id);if(seen.has(id))continue;seen.add(id);
      const page=Math.floor(slot/pageVertices),offset=(slot%pageVertices)*3;
      if(afterPages.get(page)===beforePages.get(page)){
        const start=page*pageVertices,count=Math.min(pageVertices,this.vertexCount-start),values=new this.positions.constructor(count*3);
        for(let v=0;v<count;v++){values[v*3]=this.coordinate(start+v,0);values[v*3+1]=this.coordinate(start+v,1);values[v*3+2]=this.coordinate(start+v,2);if((++work%batch)===0){yield;check();}}
        afterPages.set(page,values);
      }
      const old=[this.coordinate(slot,0),this.coordinate(slot,1),this.coordinate(slot,2)],result=transform(old,id);
      if(!result||result.length!==3||!result.every(Number.isFinite))invalid('Finite transformed xyz required');
      const values=afterPages.get(page);values[offset]=result[0];values[offset+1]=result[1];values[offset+2]=result[2];
      if(!Number.isFinite(values[offset])||!Number.isFinite(values[offset+1])||!Number.isFinite(values[offset+2]))invalid('Authoring precision overflow');
      affected.push(id);before.push(...old);after.push(values[offset],values[offset+1],values[offset+2]);
      if((++work%batch)===0){yield;check();}
    }
    check();
    return {owner:this.identity,tag,beforePages,afterPages,ids:Uint32Array.from(affected),before:new this.positions.constructor(before),after:new this.positions.constructor(after),state:'prepared'};
  }
  commit(command){
    if(command.owner!==this.identity||command.state!=='prepared'||!this.matches(command.tag)||this.pages!==command.beforePages)throw abort();
    this.pages=command.afterPages;command.state='applied';this.invalidate();return command;
  }
  undo(command){if(!this.current()||command.owner!==this.identity||command.state!=='applied'||this.pages!==command.afterPages)throw abort();this.pages=command.beforePages;command.state='undone';this.invalidate();}
  redo(command){if(!this.current()||command.owner!==this.identity||command.state!=='undone'||this.pages!==command.beforePages)throw abort();this.pages=command.afterPages;command.state='applied';this.invalidate();}
  /** Save/clone consume a consistent applied version, never optional cache state. */
  *snapshotWork({batch=4096}={}){
    if(!Number.isInteger(batch)||batch<1)invalid('Positive snapshot batch required');
    const tag=authoringJobTag(this,0),pages=this.pages,positions=new this.positions.constructor(this.positions.length),indices=this.indices?new this.indices.constructor(this.indices.length):null;
    const check=()=>{if(!this.matches(tag)||this.pages!==pages)throw abort();};check();
    for(let i=0;i<this.vertexCount;i++){for(let axis=0;axis<3;axis++)positions[i*3+axis]=this.coordinate(i,axis);if((i+1)%batch===0){yield;check();}}
    if(indices)for(let i=0;i<indices.length;i++){indices[i]=this.indices[i];if((i+1)%batch===0){yield;check();}}
    check();return {version:1,identity:this.identity,sceneEpoch:this.sceneEpoch,geometryRevision:this.geometryRevision,topologyRevision:this.topologyRevision,policyRevision:this.policyRevision,positions,indices,nextVertexId:this.nextVertexId,nextFaceId:this.nextFaceId};
  }
  *cloneWork(options={}){const snapshot=yield* this.snapshotWork(options);return new AuthoringMesh({positions:snapshot.positions,indices:snapshot.indices,sceneEpoch:this.sceneEpoch,policyRevision:this.policyRevision});}
}
