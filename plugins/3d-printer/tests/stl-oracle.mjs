// Test-only double-precision STL/plane intersection oracle. Runtime geometry
// stays on GPU; this reads the unchanged reference file independently.
export async function stlOracle(bytes,call,printer,mesh,status){
 const grid=status.result.grid,m=mesh.worldMatrix,results=[];
 // Independent exact-coordinate STL connectivity, used only by this oracle.
 const count=bytes.readUInt32LE(80),parents=new Uint32Array(count*3),faceShell=new Uint32Array(count);let vertices=new Map(),next=0;
 const root=v=>{while(parents[v]!==v){parents[v]=parents[parents[v]];v=parents[v];}return v;};
 for(let t=0;t<count;t++){const ids=[];for(let k=0;k<3;k++){const at=96+t*50+k*12,key=[0,4,8].map(d=>bytes.readFloatLE(at+d)).join(',');let id=vertices.get(key);if(id===undefined){id=next++;vertices.set(key,id);parents[id]=id;}ids.push(id);}faceShell[t]=ids[0];for(let k=1;k<3;k++){const a=root(ids[0]),b=root(ids[k]);parents[Math.max(a,b)]=Math.min(a,b);}}
 for(let t=0;t<count;t++)faceShell[t]=root(faceShell[t]);const shells=new Set(faceShell).size;vertices=null;
 const point=o=>[Math.fround(bytes.readFloatLE(o)*Math.fround(m[0])+Math.fround(m[12])),Math.fround(bytes.readFloatLE(o+8)*Math.fround(m[5])+Math.fround(m[13])),Math.fround(-bytes.readFloatLE(o+4)*Math.fround(m[10])+Math.fround(m[14]))];
 const difference=(a,b)=>{const ends=[...a.flat().map((x,i)=>[x,i%2? -1:1]),...b.flat().map((x,i)=>[x,i%2? -2:2])].sort((a,b)=>a[0]-b[0]);let state=0,last=0,error=0;for(const [x,delta]of ends){if(state===1||state===2)error+=x-last;state+=delta;last=x;}return error;};
 for(const layer of [152,300,438,500]){
   const y=Math.fround(Math.fround(.6)+Math.fround(Math.fround(layer-1-.5)*Math.fround(.3))),axes={};
  for(const axis of ['X','Z']){const k=axis==='X'?1:0;axes[axis]=Array.from({length:grid[axis==='X'?'depth':'width']},(_,i)=>({position:Math.fround(grid.min[k]+Math.fround(Math.fround(i+.5)*Math.fround(grid.pitch[k]))),hits:[]}));}
  for(let t=0;t<bytes.readUInt32LE(80);t++){const o=84+t*50+12,vertices=[point(o),point(o+12),point(o+24)];if(y<Math.min(...vertices.map(p=>p[1]))||y>=Math.max(...vertices.map(p=>p[1])))continue;const ends=[];
   for(let e=0;e<3;e++){const a=vertices[e],b=vertices[(e+1)%3];if((a[1]<=y&&b[1]>y)||(b[1]<=y&&a[1]>y)){const f=(y-a[1])/(b[1]-a[1]);ends.push([a[0]+f*(b[0]-a[0]),a[2]+f*(b[2]-a[2])]);}}if(ends.length!==2)continue;const ab=vertices[1].map((x,k)=>x-vertices[0][k]),ac=vertices[2].map((x,k)=>x-vertices[0][k]),normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
   for(const axis of ['X','Z']){const k=axis==='X'?1:0,v=1-k,lo=Math.min(ends[0][k],ends[1][k]),hi=Math.max(ends[0][k],ends[1][k]),rays=axes[axis],first=Math.max(0,Math.floor((lo-grid.min[k])/grid.pitch[k]-.5)-1),last=Math.min(rays.length,Math.ceil((hi-grid.min[k])/grid.pitch[k]-.5)+2);
    for(let i=first;i<last;i++){const r=rays[i],p=r.position;if(p>=lo&&p<hi)r.hits.push([ends[0][v]+(ends[1][v]-ends[0][v])*(p-ends[0][k])/(ends[1][k]-ends[0][k]),faceShell[t],Math.sign(normal[axis==='X'?0:2])]);}}
  }
  for(const axis of ['X','Z']){let maxDifference=0,compared=0,odd=0,repairedRays=0,repairedDepth=0;const rays=axes[axis];for(let offset=0;offset<rays.length;offset+=32){const part=await call('plugins.command',{id:printer.hash,operation:'inspect',args:{layer,axis,offset,count:32}});for(const actual of part.layer.rays){const hits=rays[actual.column].hits.sort((a,b)=>a[0]-b[0]);odd+=hits.length%2;const groups=new Map();for(const h of hits){if(!groups.has(h[1]))groups.set(h[1],[]);groups.get(h[1]).push(h);}const boundaries=[];for(const group of groups.values()){const balance=group.reduce((n,h)=>n+h[2],0);let winding=0,parity=false;for(const [depth,,sign]of group){const before=balance===0?winding!==0:parity;winding+=sign;parity=!parity;if(before!==(balance===0?winding!==0:parity))boundaries.push(depth);}}boundaries.sort((a,b)=>a-b);const expected=[],parityExpected=[];for(let i=0;i+1<boundaries.length;i+=2){const a=Math.max(-500,boundaries[i]),b=Math.min(500,boundaries[i+1]);if(b>a)expected.push([a,b]);}for(let i=0;i+1<hits.length;i+=2){const a=Math.max(-500,hits[i][0]),b=Math.min(500,hits[i+1][0]);if(b>a)parityExpected.push([a,b]);}const repair=difference(expected,parityExpected);if(repair>1e-4){repairedRays++;repairedDepth+=repair;}maxDifference=Math.max(maxDifference,difference(expected,actual.intervals));compared++;}}
   results.push({layer,axis,compared,odd,shells,repairedRays,repairedDepth,maxDifference,limit:.04,pass:odd===0&&maxDifference<.04});}
 }
 return {pass:results.every(r=>r.pass),results};
}
