import {gpuScope,nativeLoadProfiles,rotatingLoads,regionalWallLoads} from '../../plugin.js';
import {verifyLiveRotating,verifyLiveRegions} from './live-solve-check.mjs';

function totals(p){
  const linear=rows=>rows.reduce((s,row)=>s+row.value*(row.upperM-row.lowerM),0);
  const sum=key=>p.rotorRadial?.reduce((s,row)=>s+row[key]*(row.outerRadiusM-row.innerRadiusM),0);
  return {drag:linear(p.dDragDx),lift:linear(p.dLiftDy),thrust:sum('dTdr'),torque:sum('dQdr')};
}
export async function verifyLoadProfiles(device){
  const errors=[],tests=[];
  for(const rotor of [false,true])for(const regional of [false,true]){
    const gpu=gpuScope(device),n=512,p=[4,5,3],index=p[0]+8*p[1]+64*p[2];
    const f={dims:[8,8,8],origin:[-1,-1,-1],h:.25,omega:3,rotor,rotatingFrame:rotor,regionalLoads:regional,
      axes:[0,1,2].map(()=>Float64Array.from({length:9},(_,i)=>-.9999+i*.25))};
    const center=p.map((j,a)=>(f.axes[a][j]+f.axes[a][j+1])/2),b={min:[-1,-1,-1],max:[1,1,1]};
    try{
      const profile=await nativeLoadProfiles(gpu,f,{box:b,bodies:b},1.8),force=gpu.buffer('Cell axial load',4*n),loads=gpu.buffer('Cell wrench',32*n);
      const mask=gpu.buffer('Test coverage',4*n);
      const reg=regional?await regionalWallLoads(gpu,f,force,loads,{mask,angle(){}},profile):null;
      const spin=rotor&&!reg?await rotatingLoads(gpu,loads,profile):null;profile.bind(force,reg?.sum??loads);
      function clear(){
        const e=device.createCommandEncoder();e.clearBuffer(force);e.clearBuffer(loads);if(spin)e.clearBuffer(spin.sums);reg?.begin(e);profile.begin(e);
        device.queue.submit([e.finish()]);
      }
      function write(step){
        const {drag,torque,lift,side,phase,weight}=step;
        device.queue.writeBuffer(force,4*index,new Float32Array([drag]));
        device.queue.writeBuffer(loads,16*index,new Float32Array([0,torque,lift,side]));
        device.queue.writeBuffer(mask,4*index,new Float32Array([weight]));
        spin?.angle(phase);reg?.angle(rotor?phase:0);const e=device.createCommandEncoder();spin?.encode(e);reg?.encode(e);device.queue.submit([e.finish()]);
      }
      const first={drag:2,torque:-.5,lift:3,side:4,phase:0,weight:.4},second={drag:-1,torque:.25,lift:7,side:-2,phase:Math.PI/2,weight:.75};
      clear();write(first);await profile.measure(1,true,1);
      clear();write(second);const out=await profile.measure(1,true,1),values=totals(out);
      const w=regional?first.weight:1,v=regional?second.weight:1;
      const expected={drag:(w*2-v)/2,lift:(3*w+(rotor?2:7)*v)/2,torque:(-.5*w+.25*v)/2};
      errors.push(Math.abs(values.drag-expected.drag),Math.abs(values.lift-expected.lift));
      if(rotor)errors.push(Math.abs(values.thrust-expected.drag),Math.abs(values.torque-expected.torque));
      for(const row of out.dLiftDy){
        let target=0;if(row.lowerM<=center[1]&&center[1]<row.upperM)target+=1.5*w;
        const height=rotor?-center[2]:center[1];if(row.lowerM<=height&&height<row.upperM)target+=(rotor?1:3.5)*v;
        errors.push(Math.abs(row.forceN-target));
      }
      tests.push({rotor,regional,values,expected});
    }finally{gpu.close();}
  }
  return {pass:Math.max(...errors)<1e-6,maxError:Math.max(...errors),tests};
}
function verify(r){
  const p=r.profiles,v=totals(p),ref=Math.max(1e-20,r.forceLocal.magnitude);
  const forceError=Math.max(Math.abs(v.drag-r.forceLocal.drag),Math.abs(v.lift-r.forceLocal.lift))/ref;
  const torque=r.rotorMetrics?.shaftTorqueNm,torqueError=torque==null?0:Math.abs(v.torque-torque)/Math.max(1e-20,Math.abs(torque));
  const power=p.rotorRadial?.reduce((s,row)=>s+row.shaftPowerToFluidW,0),powerError=power==null?0:Math.abs(power-r.powerW)/Math.max(1e-20,Math.abs(r.powerW));
  return {pass:p.originWorldM.length===3&&p.axesWorld.length===3&&Math.max(forceError,torqueError,powerError)<3e-5,
    forceError,torqueError,powerError,forceN:r.forceLocal,shaftTorqueNm:torque,powerW:r.powerW,profiles:p};
}
export async function verifyRotorProfiles(device){const run=await verifyLiveRotating(device),report=verify(run.result);return {...report,pass:run.pass&&report.pass};}
export async function verifyRegionalProfiles(){
  const result=await verifyLiveRegions(),reports=result.regions.map(({force,profiles})=>{
    const local=profiles.axesWorld.map(axis=>axis.reduce((s,v,k)=>s+v*force[k],0));
    return verify({profiles,forceLocal:{drag:local[0],lift:local[1],magnitude:Math.hypot(...force)}});
  });
  return {pass:result.pass&&reports.every(r=>r.pass),complementaryForceError:result.forceError,reports};
}
