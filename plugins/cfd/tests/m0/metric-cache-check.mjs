import {ahmedMesh} from './ahmed.mjs';

export async function verifyNativeMetricReuse(){
  const call=(name,args={})=>frameAI.call(name,args);
  async function scene(speed){
    await call('scene.new');
    const {hash:box}=await call('scene.create',{type:'cfd',params:{Speed:speed}});
    await call('transform.set',{ids:[box],channel:'size',axis:0,value:1800,coordinates:'world'});
    const {hash:body}=await call('mesh.create',ahmedMesh());return {box,body};
  }
  async function first(s,label){
    const op=(operation,args={})=>call('plugins.command',{id:s.box,operation,args});
    const start=performance.now();await op('solve-frame',{warmStart:false});
    try{
      for(;;){
        const status=await op('results'),r=status.result;
        if(r?.steps>0){
          const part=r.surfaceFields.occurrences[0],probe=await op('probe',{occurrence:0,triangle:Math.floor(part.triangles/2)});
          return {label,field:r.validity.distanceField,geometryExtent:r.validity.geometryExtent,cells:r.cells,gridHash:r.validity.gridHash,
            triangles:part.triangles,pressurePa:probe.pressurePa,force:r.forceWorld,steps:r.steps,
            mass:r.validity.maxDivergencePerS,firstFieldMs:performance.now()-start};
        }
        if(!['queued','solving'].includes(status.state)||performance.now()-start>180000)throw Error(label+' '+JSON.stringify(status.job));
        await new Promise(ok=>setTimeout(ok,20));
      }
    }finally{await op('stop');}
  }
  const s=await scene(40),base=await first(s,'original geometry');
  await call('scene.update',{id:s.box,params:{Speed:60}});
  const speed=await first(s,'changed airspeed');
  const independent=await scene(60),cold=await first(independent,'new document at the same airspeed');
  await call('scene.update',{id:independent.box,params:{Altitude:120}});
  const altitude=await first(independent,'changed altitude');
  await call('mesh.edit',{id:independent.body,op:'delete',mode:'polygon',faces:[154]});
  const edited=await first(independent,'edited native mesh with the same extent');
  const runs=[base,speed,cold,altitude,edited];
  const forceError=Math.hypot(...speed.force.map((v,a)=>v-cold.force[a]))/Math.hypot(...cold.force);
  const pressureError=Math.abs(speed.pressurePa-cold.pressurePa)/Math.max(1,Math.abs(cold.pressurePa));
  return {pass:runs.every(r=>r.steps===1&&r.mass<1e-6&&r.field.bytes>0&&Number.isFinite(r.pressurePa))&&
    runs.map(r=>r.field.source).join(',')==='rebuilt,retained,rebuilt,retained,rebuilt'&&
    runs.map(r=>r.geometryExtent.source).join(',')==='evaluated,retained,evaluated,retained,evaluated'&&
    altitude.triangles>edited.triangles&&JSON.stringify(altitude.field.dims)===JSON.stringify(edited.field.dims)&&
    speed.gridHash===cold.gridHash&&forceError<.001&&pressureError<.001,forceError,pressureError,runs};
}
