import {cartesianSolver,gpuScope} from '../../plugin.js';

// Set each physical word independently before the capture, including
// different primary and correction words on the two sides of one face.
export async function verifyCheckpointWords(device){
  const gpu=gpuScope(device),dims=[8,8,8],n=dims.reduce((a,b)=>a*b);
  const f={dims,h:.01,origin:[0,0,0],U:.1,maxSpeed:.1,nu:1.5e-5,period:1,omega:0,laminar:true,modeledShape:true};
  try{
    const wall=gpu.buffer('Stationary test tunnel',16*n),force=gpu.buffer('Wall impulse',4*n);
    const mobility=gpu.buffer('Open faces',new Float32Array(4*n).fill(1)),s=await cartesianSolver(gpu,f,.001,wall,force,mobility);
    const fields=[s.state,s.flux,s.fluxTail,s.pressure],special=[0,0x80000000,1,0x807fffff,0x00800000,0x3f800001,0x7f7fffff,0xff7fffff];
    const words=fields.map((v,b)=>Uint32Array.from({length:v.size/4},(_,i)=>{
      if((b===1||b===2)&&i%4===3)return 0;
      return i%7===0?special[(i+b)%special.length]:((b+1)*0x1f123bb+Math.imul(i,0x3c6ef35f))>>>0;
    }));
    const results=[];
    for(const direct of [true,false]){
      const usage=GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST|(direct?GPUBufferUsage.STORAGE:0);
      const buffer=gpu.buffer('Saved physical time level',s.checkpointSize,usage);
      fields.forEach((v,b)=>device.queue.writeBuffer(v,0,words[b]));
      const e=device.createCommandEncoder();s.capture(e,buffer);
      for(const v of fields)e.clearBuffer(v);
      s.restore(e,buffer);device.queue.submit([e.finish()]);
      const differences=[];
      for(const [b,v] of fields.entries()){
        const values=await gpu.read(v,gpu.staging('Restored physical words',v.size),v.size/4);
        const restored=new Uint32Array(values.buffer);let mismatch=0;
        for(let i=0;i<restored.length;i++)if(restored[i]!==words[b][i])mismatch++;
        differences.push(mismatch);
      }
      results.push({direct,differences});
    }
    return {pass:s.checkpointSize===84*n&&results.every(row=>row.differences.every(v=>v===0)),
      cells:n,fields:['velocity and SST','primary discharge','small discharge correction','pressure'],
      rawBytes:fields.reduce((sum,b)=>sum+b.size,0),checkpointBytes:s.checkpointSize,results};
  }finally{gpu.close();}
}
