import {gpuScope} from './gpu.mjs';
import {cellCenter,cellWidth} from './rectilinear.mjs';
import {pressureBarriers} from './pressure-barrier.mjs';

// Compare displaced, non-axis-aligned pressure links against exact halfspace
// tests. The quad spans the whole domain, so a finite-thickness sheet must
// also close a link whose two endpoints lie outside on opposing sides.
export async function verifySheetLinks(device,graded){
  const gpu=gpuScope(device),dims=[26,16,12],h=.001,n=dims.reduce((a,b)=>a*b);
  const axes=graded?dims.map(d=>Float64Array.from({length:d+1},(_,i)=>h*i*(.65+.45*i/d))):undefined;
  const f={dims,h,axes,origin:[0,0,0]},points=new Float32Array(4*n);
  for(let i=0;i<n;i++){
    const xyz=[i%26,Math.floor(i/26)%16,Math.floor(i/(26*16))];
    for(let a=0;a<3;a++)points[4*i+a]=cellCenter(f,a,xyz[a])/h+.42*Math.sin(.73*i+2*a)*cellWidth(f,a,xyz[a]);
    points[4*i+3]=1;
  }
  try{
    const rep=gpu.buffer('CFD displaced pressure sites',points);
    const phase=gpu.buffer('CFD sheet phase',new Float32Array([1,0,0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    const stage=gpu.staging('CFD independent sheet link certificate',4*n);
    let checked=0,crossings=0,leaks=0,falseClosures=0,doublyCrossed=0;
    for(const shift of [.19,.57])for(const thickness of [0,.13,1.7]){
      const mid=10+shift,vertices=[],indices=[];
      for(const cut of thickness?[mid-.5*thickness,mid+.5*thickness]:[mid]){
        const base=vertices.length/3;
        for(const [y,z] of [[-5,-5],[35,-5],[35,35],[-5,35]])vertices.push((cut+.41*y-.22*z)*h,y*h,z*h);
        indices.push(base,base+1,base+2,base,base+2,base+3);
      }
      const mesh={vertices:Float32Array.from(vertices),indices:Uint32Array.from(indices)};
      const barrier=await pressureBarriers(gpu,f,mesh,phase,rep),encoder=device.createCommandEncoder();barrier.encode(encoder);device.queue.submit([encoder.finish()]);
      const flags=new Uint32Array((await gpu.read(barrier.mask,stage,n)).buffer);
      const distance=i=>points[4*i]-.41*points[4*i+1]+.22*points[4*i+2]-mid;
      for(let i=0;i<n;i++){
        const xyz=[i%26,Math.floor(i/26)%16,Math.floor(i/(26*16))],d=distance(i);
        for(let a=0;a<3;a++){if(xyz[a]+1===dims[a])continue;
          const v=distance(i+[1,26,26*16][a]),lo=Math.min(d,v),hi=Math.max(d,v);
          const atLow=lo<=-.5*thickness&&hi>=-.5*thickness,atHigh=lo<=.5*thickness&&hi>=.5*thickness;
          const actual=Boolean(flags[i]&(1<<a)),expected=atLow||atHigh;
          checked++;crossings+=Number(expected);doublyCrossed+=Number(thickness>0&&atLow&&atHigh);
          if(expected&&!actual)leaks++;if(!expected&&actual)falseClosures++;
        }
      }
    }
    return {checked,crossings,doublyCrossed,leaks,falseClosures,pass:crossings>0&&doublyCrossed>0&&leaks===0&&falseClosures===0};
  }finally{gpu.close();}
}
