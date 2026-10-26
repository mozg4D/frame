// Test-only double-precision STL/plane intersection oracle. Runtime geometry
// stays on GPU; this reads the unchanged reference file independently.
export async function stlOracle(bytes,call,printer,mesh,status){
 const grid=status.result.grid,m=mesh.worldMatrix,results=[];
 const point=o=>[Math.fround(bytes.readFloatLE(o)*Math.fround(m[0])+Math.fround(m[12])),Math.fround(bytes.readFloatLE(o+8)*Math.fround(m[5])+Math.fround(m[13])),Math.fround(-bytes.readFloatLE(o+4)*Math.fround(m[10])+Math.fround(m[14]))];
 const difference=(a,b)=>{const ends=[...a.flat().map((x,i)=>[x,i%2? -1:1]),...b.flat().map((x,i)=>[x,i%2? -2:2])].sort((a,b)=>a[0]-b[0]);let state=0,last=0,error=0;for(const [x,delta]of ends){if(state===1||state===2)error+=x-last;state+=delta;last=x;}return error;};
 for(const layer of [152,300,500]){
  const y=Math.fround(Math.fround(.6)+Math.fround(Math.fround(layer-1-.5)*Math.fround(.3))),axes={};
  for(const axis of ['X','Z']){const k=axis==='X'?1:0;axes[axis]=Array.from({length:grid[axis==='X'?'depth':'width']},(_,i)=>({position:Math.fround(grid.min[k]+Math.fround(Math.fround(i+.5)*Math.fround(grid.pitch[k]))),hits:[]}));}
  for(let t=0;t<bytes.readUInt32LE(80);t++){const o=84+t*50+12,vertices=[point(o),point(o+12),point(o+24)];if(y<Math.min(...vertices.map(p=>p[1]))||y>=Math.max(...vertices.map(p=>p[1])))continue;const ends=[];
   for(let e=0;e<3;e++){const a=vertices[e],b=vertices[(e+1)%3];if((a[1]<=y&&b[1]>y)||(b[1]<=y&&a[1]>y)){const f=(y-a[1])/(b[1]-a[1]);ends.push([a[0]+f*(b[0]-a[0]),a[2]+f*(b[2]-a[2])]);}}if(ends.length!==2)continue;
   for(const axis of ['X','Z']){const k=axis==='X'?1:0,v=1-k,lo=Math.min(ends[0][k],ends[1][k]),hi=Math.max(ends[0][k],ends[1][k]),rays=axes[axis],first=Math.max(0,Math.floor((lo-grid.min[k])/grid.pitch[k]-.5)-1),last=Math.min(rays.length,Math.ceil((hi-grid.min[k])/grid.pitch[k]-.5)+2);
    for(let i=first;i<last;i++){const r=rays[i],p=r.position;if(p>=lo&&p<hi)r.hits.push(ends[0][v]+(ends[1][v]-ends[0][v])*(p-ends[0][k])/(ends[1][k]-ends[0][k]));}}
  }
  for(const axis of ['X','Z']){let maxDifference=0,compared=0,odd=0;const rays=axes[axis];for(let offset=0;offset<rays.length;offset+=32){const part=await call('plugins.command',{id:printer.hash,operation:'inspect',args:{layer,axis,offset,count:32}});for(const actual of part.layer.rays){const hits=rays[actual.column].hits.sort((a,b)=>a-b);odd+=hits.length%2;const expected=[];for(let i=0;i+1<hits.length;i+=2){const a=Math.max(-500,hits[i]),b=Math.min(500,hits[i+1]);if(b>a)expected.push([a,b]);}maxDifference=Math.max(maxDifference,difference(expected,actual.intervals));compared++;}}
   results.push({layer,axis,compared,odd,maxDifference,limit:.04,pass:odd===0&&maxDifference<.04});}
 }
 return {pass:results.every(r=>r.pass),results};
}
