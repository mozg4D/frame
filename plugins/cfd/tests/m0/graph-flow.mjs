import {gpuScope} from './gpu.mjs';
import {references,surfaceBand} from './fixtures.mjs';
import {graphPlane} from './wake.mjs';
import {fixtureMetric} from './metric.mjs';
import {graphPressure} from './graph-pressure.mjs';
import {graphWeights} from './graph-weights.mjs';
import {viewportMonitor,sumForce,settledPeriods,caseBudgetMs} from './flow.mjs';

async function build(f,field){
  const worker=new Worker(new URL('./graph-build.mjs',import.meta.url),{type:'module'});
  try{return await new Promise((ok,no)=>{worker.onmessage=e=>e.data.error?no(Error(e.data.error)):ok(e.data);
    worker.onerror=e=>no(Error(e.message));worker.postMessage({f,field},[field.buffer]);});}
  finally{worker.terminate();}
}
const decl=(b,n,t,w=false)=>`@group(0) @binding(${b}) var<storage,${w?'read_write':'read'}> ${n}:array<${t}>;`;
async function solver(gpu,f,g){
  const n=g.pos.length/4,dt=g.dt,grid=[Math.ceil(n/128)],buf=(name,data)=>gpu.buffer('CFD graph '+name,data);
  const nb=new ArrayBuffer(n*32),ints=new Uint32Array(nb),vals=new Float32Array(nb);
  for(let i=0;i<n;i++){vals.set(g.pos.subarray(4*i,4*i+4),8*i);ints.set([g.offset[i],g.offset[i+1]],8*i+4);vals[8*i+6]=g.wallDist[i];}
  const incidence=new Uint32Array(2*g.nbr.length);
  for(let e=0;e<g.nbr.length;e++){incidence[2*e]=g.nbr[e]|(g.kind[e]<<28);incidence[2*e+1]=g.linkFace[e];}
  const node=buf('nodes',new Uint8Array(nb)),tag=buf('oriented incidence',incidence),coef=buf('unique face weights',g.faceCoeff);
  const edges=g.owners.length/2,edgeGrid=[Math.ceil(edges/128)],ends=buf('face endpoints',g.owners);
  const state=buf('velocity',n*16),pred=buf('predictor',n*16),flows=buf('staggered face flows',edges*4),force=buf('wall impulse',n*4),nut=buf('eddy viscosity',n*4);
  const slopes=buf('limited velocity gradients',n*48);
  const mg=await graphPressure(gpu,g.levels),sum=await sumForce(gpu,force,n);
  const common=`struct Node {pv:vec4f,start:u32,end:u32,d:f32,pad:u32}
    const U=vec3f(${f.U.toFixed(8)},0.,0.);const DT=${dt};const NU=${f.nu};
    fn solid(k:u32)->bool{return k==7u||(${f.name==='ahmed'}&&k==3u);}
    fn inlet(k:u32)->bool{return k==1u;}
    fn wallNu(v:vec3f,A:vec3f,c:f32)->f32{
      if(${f.sphere}){return NU;}let normal=normalize(A);let u=length(v-dot(v,normal)*normal);let d=length(A)/c;
      var ut=sqrt(NU*u/max(d,1e-12));for(var k=0u;k<6u;k++){
        let yp=ut*d/NU;let uplus=select(log(1.+9.8*yp)/0.41,yp,yp<11.);
        ut=0.5*(ut+u/max(uplus,1e-6));}
      return max(NU,ut*ut*d/max(u,1e-6));}
    `+decl(0,'node','Node')+decl(1,'tags','vec2u')+decl(2,'coeff','vec4f');
  const main=s=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=arrayLength(&node)){return;}let cell=node[i];${s}}`;
  const oriented='let id=bitcast<i32>(tags[e].y);let faceId=u32(select(id,~id,id<0));let sign=select(1.,-1.,id<0);';
  const walk=s=>`for(var e=cell.start;e<cell.end;e++){let k=tags[e].x>>28u;let j=tags[e].x&0xfffffffu;${oriented}let link=coeff[faceId];let A=sign*link.xyz;let c=link.w;if(c<=0.){continue;}${s}}`;
  const init=await gpu.kernel('CFD graph initialize',decl(0,'v','vec4f',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x<arrayLength(&v)){v[g.x]=vec4f(${f.U.toFixed(8)},0.,0.,0.);}}`);
  gpu.run(init,[state],grid);
  const visc=await gpu.kernel('CFD graph velocity gradient',common+decl(3,'v','vec4f')+decl(4,'nuT','f32',true)+decl(5,'slopes','mat3x3f',true)+
    main('var grad:mat3x3f;let u=v[i].xyz;var low=u;var high=u;'+walk(`var uf=0.5*(u+v[j].xyz);if(solid(k)){uf=vec3f(0);}if(inlet(k)){uf=U;}
      let neighbor=select(v[j].xyz,uf,k!=0u);low=min(low,neighbor);high=max(high,neighbor);
      for(var a=0u;a<3u;a++){grad[a]+=uf*A[a]/cell.pv.w;}`)+`
      let s=0.5*(grad+transpose(grad));let strain=sqrt(2.*(dot(s[0],s[0])+dot(s[1],s[1])+dot(s[2],s[2])));
      let l=min(0.14*pow(cell.pv.w,1./3.),0.41*cell.d);nuT[i]=select(l*l*strain,0.,${f.sphere});var limiter=vec3f(1);`+walk(`
      if(k==0u){let du=grad*(0.5*(node[j].pv.xyz-cell.pv.xyz));
        for(var a=0u;a<3u;a++){if(abs(du[a])>1e-10){limiter[a]=min(limiter[a],select(low[a]-u[a],high[a]-u[a],du[a]>0.)/du[a]);}}}`)+
      'slopes[i]=mat3x3f(grad[0]*limiter,grad[1]*limiter,grad[2]*limiter);'));
  const m=await gpu.kernel('CFD graph conservative momentum',common+decl(3,'v','vec4f')+decl(4,'q','f32')+decl(5,'nuT','f32')+decl(6,'out','vec4f',true)+decl(7,'slopes','mat3x3f')+
    main('let u=v[i].xyz;var rhs=vec3f(0);'+walk(`
      var vj=v[j].xyz;var viscosity=NU+0.5*(nuT[i]+nuT[j]);let flux=sign*q[faceId];
      if(solid(k)){vj=vec3f(0);viscosity=wallNu(u,A,c);}else if(inlet(k)|| (k!=0u&&flux<0.)){vj=U;}
      var transported=select(vj,u,flux>=0.);
      if(k==0u){let source=select(j,i,flux>=0.);let dx=0.5*(node[j].pv.xyz-cell.pv.xyz);
        transported+=slopes[source]*select(-dx,dx,flux>=0.);}
      rhs+=viscosity*c*(vj-u)-flux*transported;`)+
      'out[i]=vec4f(u+DT*rhs/cell.pv.w,0.);'));
  const faceCode=decl(0,'ends','vec2u')+decl(1,'coeff','vec4f')+decl(3,'q','f32',true);
  const edgeMain=s=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
    let e=g.x;if(e>=arrayLength(&q)){return;}let a=ends[e];let i=a.x;let j=a.y&0xfffffffu;let k=a.y>>28u;
    let link=coeff[e];let wall=k==7u||(${f.name==='ahmed'}&&k==3u);${s}}`;
  const forecast=await gpu.kernel('CFD staggered predicted face flow',faceCode+decl(2,'v','vec4f')+edgeMain(`
    var value=dot(0.5*(v[i].xyz+v[j].xyz),link.xyz);
    if(k==1u){value=${f.U.toFixed(8)}*link.x;}if(wall||link.w==0.){value=0.;}q[e]=value;`));
  const project=await gpu.kernel('CFD minimum energy face correction',faceCode+decl(2,'p','f32')+edgeMain(`
    if(!wall&&k!=1u&&link.w>0.){q[e]+=link.w*(p[i]-select(0.,p[j],k==0u));}`));
  const rhs=await gpu.kernel('CFD signed face imbalance',common+decl(3,'q','f32')+decl(4,'b','f32',true)+main(`
    var d=0.;var carry=0.;for(var e=cell.start;e<cell.end;e++){${oriented}
      let v=sign*q[faceId];let t=d+v;carry+=select((v-t)+d,(d-t)+v,abs(d)>=abs(v));d=t;}b[i]=-(d+carry);`));
  const correction=await gpu.kernel('CFD nodal momentum correction and wall force',common+decl(3,'v','vec4f')+decl(4,'p','f32')+
    decl(5,'out','vec4f',true)+decl(6,'force','f32',true)+main(`
    let u=v[i].xyz;let pi=p[i];var grad=vec3f(0);var wallForce=0.;`+walk(`
      let pj=select(0.,p[j],k==0u||solid(k)||inlet(k));let dp=pi-pj;
      grad-=select(1.,0.5,k==0u)*dp*A;
      if(k==7u){wallForce+=${f.rho}*(pi/DT*A.x+wallNu(u,A,c)*c*u.x);}`)+
      'out[i]=vec4f(u-grad/cell.pv.w,0.);force[i]+=wallForce;'));
  const geom=[node,tag,coef];
  const vb=gpu.bind(visc,[...geom,state,nut,slopes]),mb=gpu.bind(m,[...geom,state,flows,nut,pred,slopes]),cb=gpu.bind(correction,[...geom,pred,mg.p,state,force]);
  const rb=gpu.device.createBindGroup({layout:rhs.getBindGroupLayout(0),entries:[[0,node],[1,tag],[3,flows],[4,mg.b]].map(([binding,buffer])=>({binding,resource:{buffer}}))});
  const fb=gpu.bind(forecast,[ends,coef,pred,flows]),pb=gpu.bind(project,[ends,coef,mg.p,flows]);
  gpu.run(forecast,[ends,coef,state,flows],edgeGrid);
  const firstPressure=buf('pressure before defect correction',n*4);
  const addPressure=await gpu.kernel('CFD accumulate projected pressure',decl(0,'base','f32')+decl(1,'p','f32',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x<arrayLength(&p)){p[g.x]+=base[g.x];}}`);
  const addBinding=gpu.bind(addPressure,[firstPressure,mg.p]);
  const stage=gpu.staging('CFD graph field diagnostics',Math.max(n*16,edges*4));
  const mean=buf('time averaged axial velocity',n*4);
  const sample=await gpu.kernel('CFD graph average',decl(0,'v','vec4f')+decl(1,'s','f32',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x<arrayLength(&s)){s[g.x]+=v[g.x].x;}}`);
  const sb=gpu.bind(sample,[state,mean]);
  return {dt,state,force,sum,
    step(sampling){
      const e=gpu.device.createCommandEncoder();
      gpu.dispatch(e,visc,vb,grid);gpu.dispatch(e,m,mb,grid);gpu.dispatch(e,forecast,fb,edgeGrid);
      gpu.dispatch(e,rhs,rb,grid);mg.cycle(e);mg.cycle(e);gpu.dispatch(e,project,pb,edgeGrid);
      // Refine against Bq formed from the stored fluxes, including FP32 rounding.
      e.copyBufferToBuffer(mg.p,0,firstPressure,0,n*4);e.clearBuffer(mg.p);
      gpu.dispatch(e,rhs,rb,grid);mg.cycle(e);gpu.dispatch(e,project,pb,edgeGrid);
      gpu.dispatch(e,addPressure,addBinding,grid);gpu.dispatch(e,correction,cb,grid);
      if(sampling)gpu.dispatch(e,sample,sb,grid);gpu.device.queue.submit([e.finish()]);
    },
    async diagnostics(samplesTaken){
      const v=await gpu.read(state,stage,n*4),q=await gpu.read(flows,stage,edges);
      let max=0,net=0,exterior=0,sealedMax=0;const yplus=[];
      for(let i=0;i<n;i++){
        let imbalance=0;
        for(let e=g.offset[i];e<g.offset[i+1];e++){
          const id=g.linkFace[e],flux=id<0?-q[~id]:q[id],kind=g.kind[e];imbalance+=flux;
          if(kind!==0)exterior+=flux;
          if(kind===7||(f.name==='ahmed'&&kind===3))sealedMax=Math.max(sealedMax,Math.abs(flux));
          if(kind===7&&g.coeff[4*e+3]>0){const d=Math.hypot(...g.coeff.subarray(4*e,4*e+3))/g.coeff[4*e+3];yplus.push(d*Math.sqrt(f.nu*Math.hypot(...v.subarray(4*i,4*i+3))/d)/f.nu);}
        }
        net+=imbalance;max=Math.max(max,Math.abs(imbalance)/g.pos[4*i+3]);
      }
      const averaged=await gpu.read(mean,stage,n);
      const wakeLengthM=graphPlane(f,g,averaged.map(x=>x/samplesTaken));
      yplus.sort((a,b)=>a-b);
      return {maxDivergencePerS:max,relativeDivergenceMax:max*f.period,wakeLengthM,netBoundaryFlowM3PerS:exterior,
        internalCancellationErrorM3PerS:Math.abs(net-exterior),maxImpermeableFaceFlowM3PerS:sealedMax,storedFaceScalars:edges,
        wallYPlusViscousEstimateP50:yplus[Math.floor(yplus.length*.5)]};
    }};
}

export async function benchmarkGraph(device,f,progress){
  const start=performance.now(),gpu=gpuScope(device);let stop=null;
  try{
    stop=viewportMonitor();
    const sm=surfaceBand(f),metric=await fixtureMetric(device,sm);
    const {packed,stats}=await build(sm,metric.field);
    stats.gpuWeights=await graphWeights(device,f,packed);
    const graphGenerationMs=performance.now()-start;
    progress(f.name+' SDF graph '+stats.sites+' nodes, '+stats.edges+' faces, '+graphGenerationMs.toFixed(0)+' ms');
    const s=await solver(gpu,f,packed);await device.queue.onSubmittedWorkDone();
    const setupMs=performance.now()-start,windows=[];let step=0,diverged=false,samplesTaken=0;
    let budgetExhausted=false;
    periods: for(let window=1;window<=12;window++){
      const e=device.createCommandEncoder();e.clearBuffer(s.force);device.queue.submit([e.finish()]);
      const end=Math.round(window*f.period/s.dt),first=step;
      while(step<end){
        if(performance.now()-start>=caseBudgetMs){budgetExhausted=true;break periods;}
        const stop=Math.min(end,step+4);while(step<stop){s.step(window>=4);step++;if(window>=4)samplesTaken++;}
        await device.queue.onSubmittedWorkDone();
      }
      const forceN=await s.sum()/(step-first),coefficient=forceN/f.normalization;
      windows.push({period:window,forceN,coefficient,physicalTimeS:step*s.dt,elapsedMs:performance.now()-start});
      progress(f.id+' sdf-graph period '+window+' CD '+coefficient.toFixed(4));if(!Number.isFinite(coefficient)){diverged=true;break;}if(settledPeriods(windows))break;
    }
    const field=diverged||!samplesTaken?null:await s.diagnostics(samplesTaken),samples=windows.slice(-2).map(w=>w.coefficient),mean=samples.reduce((a,b)=>a+b,0)/samples.length,ref=references[f.id];
    const viewport=stop();stop=null;
    const stable=!diverged&&settledPeriods(windows),relativeError=ref.value?Math.abs(mean/ref.value-1):null;
    const forcePassed=!!ref.value&&stable&&samples.every(v=>Math.abs(v/ref.value-1)<=.05);
    const expectedWake=ref.wakeM??(ref.wakeDiameters??0)*.08;
    const wakePassed=expectedWake?Number.isFinite(field?.wakeLengthM)&&Math.abs(field.wakeLengthM/expectedWake-1)<=.05:null;
    const totalMs=performance.now()-start;
    return {fixture:f.id,kind:'sdf-graph',dtS:s.dt,windows,mean,relativeError,forcePassed,stable,field,viewport,stats,wakePassed,diverged,
      metric:{source:metric.source,dims:sm.dims,pitchM:sm.h,ms:metric.ms,peakGpuBytes:metric.peakGpuBytes},
      graphGenerationMs,setupMs,totalMs,caseBudgetMs,budgetExhausted,completedSteps:step,timeToStationaryMs:stable?windows.at(-1).elapsedMs:null,
      ownedBufferBytes:Math.max(metric.peakGpuBytes,stats.gpuWeights.peakGpuBytes,gpu.allocatedBytes),solverBufferBytes:gpu.allocatedBytes,
      timeToTargetMs:stable&&(!ref.value||forcePassed)&&wakePassed!==false&&viewport.qualified&&field?.relativeDivergenceMax<1e-6?totalMs:null};
  }finally{stop?.();gpu.close();}
}
