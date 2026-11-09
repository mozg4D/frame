// Compact authoring validation only. References are native hashes, never names.
export const roles=Object.freeze(['subject','sensor','source','target']);
export const fail=(code,message)=>Object.assign(new Error(message),{code});
export const roleOf=n=>roles.find(role=>n?.type==='optics_'+role)||null;
export const isOptics=n=>n?.type==='optics'||!!roleOf(n);
export function validateRelations(nodes,n,params){
  if(!isOptics(n))return null;
  const find=h=>nodes.find(q=>q.nativeHash===h);
  if(n.type==='optics')return {};
  if(typeof params.Optics!=='string'||params.Optics&&find(params.Optics)?.type!=='optics')throw fail('INVALID_ARGUMENT','Optics must reference an existing native Design Space.');
  const key=n.type==='optics_subject'?'Sensor':n.type==='optics_source'?'Target':null;
  if(key){const h=params[key],target=find(h);if(typeof h!=='string'||h&&(!params.Optics||target?.type!=='optics_'+key.toLowerCase()||target.params.Optics!==params.Optics))throw fail('INVALID_ARGUMENT',key+' must belong to the same Optics task.');}
  if(n.type==='optics_subject'&&params.Distance==='Finite'&&params['Depth min']>params['Depth max'])throw fail('INVALID_ARGUMENT','Depth min must not exceed Depth max.');
  // Owner reassignment cannot silently leave inbound relationships crossing tasks.
  if(params.Optics!==n.params.Optics&&nodes.some(q=>['optics_source','optics_subject'].includes(q.type)&&(q.params.Target===n.nativeHash||q.params.Sensor===n.nativeHash)&&q.params.Optics!==params.Optics))throw fail('OPTICS_LINKED_PLANE','Clear incoming links before moving this plane to another task.');
  return {};
}
export function helper(type){
  const out=[],line=(a,b)=>out.push(...a,...b);
  if(type==='optics'){
    for(let axis=0;axis<3;axis++)for(let a=0;a<2;a++)for(let b=0;b<2;b++){const p=[-50,-50,-50],q=[-50,-50,-50];p[(axis+1)%3]=q[(axis+1)%3]=a?50:-50;p[(axis+2)%3]=q[(axis+2)%3]=b?50:-50;q[axis]=50;line(p,q);}
  }else{
    const p=[[-50,-50,0],[50,-50,0],[50,50,0],[-50,50,0]];for(let i=0;i<4;i++)line(p[i],p[(i+1)%4]);
    // Local +Z marker defines the directed plane frame, not a simulated ray.
    line([0,0,0],[0,0,10]);line([0,0,10],[2,0,7]);line([0,0,10],[-2,0,7]);
  }
  return new Float32Array(out);
}
export const bounds=type=>type==='optics'?{min:[-50,-50,-50],max:[50,50,50]}:{min:[-50,-50,0],max:[50,50,10]};
