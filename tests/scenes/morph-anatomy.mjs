// Minimal authored cages. Joint poses use native Morph region transforms, never PLA.
export const fingerPoses=['Proximal','Middle','Distal'];
export function anatomyData(elbow=false){
 const xs=elbow?[0,110,225]:[0,30,60,90],width=elbow?19:8,thickness=elbow?16:6.3,vertices={},segments={},sequences=[],sourceCells=[],ids=[],edges=new Set();let next=1;
 for(const x of xs)for(const [y,z]of [[-1,-1],[1,-1],[1,1],[-1,1]]){const id='v'+next++;ids.push(id);vertices[id]=[x,y*thickness,z*width];}
 const face=vs=>{sourceCells.push(vs);for(let i=0;i<4;i++){const a=vs[i],b=vs[(i+1)%4],key=[a,b].sort().join('|');if(edges.has(key))continue;edges.add(key);const id='e'+next++,q='q'+next++,A=vertices[a],B=vertices[b],ha=B.map((v,k)=>(v-A[k])/3);segments[id]={id,a,b,sequence:q,ha,hb:ha.map(v=>-v),soft:false};sequences.push({id:q,first:a,closed:false,segments:[id]});}};
 for(let ring=0;ring<xs.length-1;ring++)for(let j=0;j<4;j++)face([ids[ring*4+j],ids[ring*4+(j+1)%4],ids[(ring+1)*4+(j+1)%4],ids[(ring+1)*4+j]]);
 face(ids.slice(-4)); // Open root: four side quads per phalanx and one tip quad.
 const indices=sourceCells.flatMap(vs=>[0,1,2,0,2,3].map(i=>ids.indexOf(vs[i])));
 return {elbow,data:{version:4,approximation:{angle:10},next,vertices,segments,sequences,sourceCells,freeHandles:{}},ids,vertices:ids.flatMap(id=>vertices[id]),indices,xs};
}
export function anatomyPoint(point,values,elbow=false){
 const weights=Array.isArray(values)?values:[values,values,values],joints=elbow?[{x:110,weight:weights[0],angle:110}]:[2,1,0].map(i=>({x:i*30,weight:weights[i],angle:75}));let p=point.slice();
 // Distal first, then carry the posed chain through each proximal joint.
 for(const joint of joints)if(point[0]>=joint.x){const a=-joint.weight*joint.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),x=p[0]-joint.x,y=p[1];p=[joint.x+c*x-s*y,s*x+c*y,p[2]];}
 return p;
}
export function anatomyRegion(shape,joint,polygon=false){
 const x=shape.xs[joint],controls=[];
 for(const [id,p]of Object.entries(shape.data.vertices))if(p[0]>=x)controls.push(polygon?String(shape.ids.indexOf(id)):'v:'+id);
 if(!polygon)for(const [id,e]of Object.entries(shape.data.segments))for(const side of ['ha','hb'])if(shape.data.vertices[side==='ha'?e.a:e.b][0]>=x)controls.push(side+':'+id);
 return {controls,center:[x,0,0],axis:[0,0,1],angle:shape.elbow?-110:-75};
}
export async function createAnatomy(page){
 const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]),finger=anatomyData(),arm=anatomyData(true),group=await call('scene.create',{type:'group',name:'Morph study - independent finger joints'}),patch=await call('scene.create',{type:'spline_patch',parent:group.hash,name:'Finger - spline patch'});await call('spline.replace',{id:patch.hash,data:finger.data});const mesh=await call('mesh.create',{name:'Finger - polygon',vertices:finger.vertices,indices:finger.indices});await call('scene.update',{id:mesh.hash,parent:group.hash});const elbow=await call('scene.create',{type:'spline_patch',parent:group.hash,name:'Elbow - two segments'});await call('spline.replace',{id:elbow.hash,data:arm.data});
 for(const [owner,shape,y]of [[patch,finger,40],[mesh,finger,5],[elbow,arm,-75]]){
  await call('morph.edit',{id:owner.hash,action:'create'});
  // Distal-first order lets proximal transforms carry all downstream joints.
  for(const joint of shape.elbow?[1]:[2,1,0]){const name=shape.elbow?'Flex':fingerPoses[joint];await call('morph.edit',{id:owner.hash,action:'add',name});await call('morph.edit',{id:owner.hash,action:'set',regions:[anatomyRegion(shape,joint,owner===mesh)],values:{[name]:0}});}
  await call('scene.select',{ids:[owner.hash]});await call('transform.set',{channel:'position',axis:1,value:y,coordinates:'world'});
 }
 const material=await call('material.create',{name:'Morph clay',params:{h:27,s:32,l:61,rough:52}});for(const n of [patch,mesh,elbow])await call('material.assign',{id:n.hash,material:material.uid});await call('scene.select',{ids:[group.hash]});await call('view.set',{index:2,single:true,mode:'object',shading:'solid-isoparms',focus:group.hash});return {group,patch,mesh,elbow};
}
