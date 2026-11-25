import {gpuScope} from './gpu.mjs';
import {references,surfaceBand} from './fixtures.mjs';
import {graphWakeSampler} from './wake.mjs';
import {fixtureMetric} from './metric.mjs';
import {graphPressure} from './graph-pressure.mjs';
import {graphWeights} from './graph-weights.mjs';
import {viewportMonitor,sumForce,settledPeriods,caseBudgetMs} from './flow.mjs';
import {wallResistanceWGSL} from './wall-law.mjs';
import {viewportBudget} from './viewport-budget.mjs';
import {addFlowWGSL} from './fvm.mjs';
import {nativeGraphMetric} from './native-volume.mjs';
import {sealNativeGraph} from './graph-contact.mjs';
import {fitNativeGraphAnchors} from './graph-anchors.mjs';

async function build(device,f,field,capture){
  const worker=new Worker(new URL('./graph-build.mjs',import.meta.url),{type:'module'});
  let wallFit;
  try{return await new Promise((ok,no)=>{worker.onmessage=async({data})=>{try{
    if(data.error)throw Error(data.error);
    if(data.seeds){const fitted=await fitNativeGraphAnchors(device,data.seeds,data.layers,capture);
      wallFit=fitted.stats;worker.postMessage({anchors:fitted.anchors});return;}
    if(wallFit)data.stats.wallFit=wallFit;ok(data);
  }catch(error){no(error);}};
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
  const node=buf('nodes',new Uint8Array(nb)),tag=buf('oriented incidence',incidence),coef=buf('unique face metric',g.faceMetric);
  const edges=g.owners.length/2,edgeGrid=[Math.ceil(edges/128)],ends=buf('face endpoints',g.owners);
  const state=buf('velocity',n*16),pred=buf('predictor',n*16),flows=buf('staggered face flows and corrections',edges*8),force=buf('wall impulse',n*4),nut=buf('eddy viscosity',n*4);
  const slopes=buf('limited velocity gradients',n*48),normalInverse=buf('least-squares inverse metric',n*48);
  const mg=await graphPressure(gpu,g.levels),sum=await sumForce(gpu,force,n);
  const common=wallResistanceWGSL+`struct Node {pv:vec4f,start:u32,end:u32,d:f32,pad:u32}
    const U=vec3f(${f.U.toFixed(8)},0.,0.);const DT=${dt};const NU=${f.nu};
    fn solid(k:u32)->bool{return k==7u||(${f.name==='ahmed'}&&k==3u);}
    fn inlet(k:u32)->bool{return k==1u;}
    fn wallNu(v:vec3f,A:vec3f,c:f32)->f32{
      if(${f.sphere}){return NU;}let u=length(tangentialSlip(v,normalize(A)));let d=length(A)/c;
      return wallResistance(u,d,NU)*d;}
    `+decl(0,'node','Node')+decl(1,'tags','vec2u')+decl(2,'coeff','vec4f');
  const main=s=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=arrayLength(&node)){return;}let cell=node[i];${s}}`;
  const oriented='let id=bitcast<i32>(tags[e].y);let faceId=u32(select(id,~id,id<0));let sign=select(1.,-1.,id<0);';
  const walk=s=>`for(var e=cell.start;e<cell.end;e++){let k=tags[e].x>>28u;let j=tags[e].x&0xfffffffu;${oriented}
    let link=coeff[2u*faceId];let center=coeff[2u*faceId+1u].xyz;let A=sign*link.xyz;let c=link.w;if(c<=0.){continue;}${s}}`;
  const init=await gpu.kernel('CFD graph initialize',decl(0,'v','vec4f',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x<arrayLength(&v)){v[g.x]=vec4f(${f.U.toFixed(8)},0.,0.,0.);}}`);
  gpu.run(init,[state],grid);
  const stencil=`let len=length(A);var dx=node[j].pv.xyz-cell.pv.xyz;
    if(solid(k)||inlet(k)){dx=center-cell.pv.xyz;}else if(k!=0u){dx=A/c;}let w=len/max(dot(dx,dx),1e-30);`;
  const metrics=await gpu.kernel('CFD graph affine reconstruction metric',common+decl(3,'inv','mat3x3f',true)+
    main('var m:mat3x3f;'+walk(stencil+'for(var a=0u;a<3u;a++){m[a]+=dx*(w*dx[a]);}')+`
      let u=cross(m[1],m[2]);let v=cross(m[2],m[0]);let w=cross(m[0],m[1]);
      inv[i]=mat3x3f(u,v,w)*(1./max(dot(m[0],u),1e-30));`));
  gpu.run(metrics,[node,tag,coef,normalInverse],grid);
  const visc=await gpu.kernel('CFD graph velocity gradient',common+decl(3,'v','vec4f')+decl(4,'nuT','f32',true)+decl(5,'slopes','mat3x3f',true)+decl(6,'inv','mat3x3f')+
    main('var h:mat3x3f;let u=v[i].xyz;var low=u;var high=u;'+walk(stencil+`var neighbor=v[j].xyz;
      if(solid(k)){neighbor=vec3f(0);}else if(inlet(k)){neighbor=U;}else if(k!=0u){neighbor=u;}
      low=min(low,neighbor);high=max(high,neighbor);
      for(var a=0u;a<3u;a++){h[a]+=(neighbor-u)*(w*dx[a]);}`)+`let grad=h*inv[i];
      let s=0.5*(grad+transpose(grad));let strain=sqrt(2.*(dot(s[0],s[0])+dot(s[1],s[1])+dot(s[2],s[2])));
      let l=min(0.14*pow(cell.pv.w,1./3.),0.41*cell.d);nuT[i]=select(l*l*strain,0.,${f.sphere});var limiter=vec3f(1);`+walk(`
      if(k==0u){let du=grad*(center-cell.pv.xyz);
        for(var a=0u;a<3u;a++){if(abs(du[a])>1e-10){limiter[a]=min(limiter[a],select(low[a]-u[a],high[a]-u[a],du[a]>0.)/du[a]);}}}`)+
      'slopes[i]=mat3x3f(grad[0]*limiter,grad[1]*limiter,grad[2]*limiter);'));
  const m=await gpu.kernel('CFD graph conservative momentum',common+decl(3,'v','vec4f')+decl(4,'q','vec2f')+decl(5,'nuT','f32')+decl(6,'out','vec4f',true)+decl(7,'slopes','mat3x3f')+
    main('let u=v[i].xyz;var rhs=vec3f(0);var skin=0.;'+walk(`
      if(solid(k)){let tangent=tangentialSlip(u,normalize(A));
        let shear=wallNu(u,A,c)*c*tangent;rhs-=shear;if(k==7u){skin+=shear.x;}continue;}
      var vj=v[j].xyz;let viscosity=NU+0.5*(nuT[i]+nuT[j]);let flux=sign*(q[faceId].x+q[faceId].y);
      if(inlet(k)|| (k!=0u&&flux<0.)){vj=U;}
      var transported=select(vj,u,flux>=0.);
      if(k==0u){let source=select(j,i,flux>=0.);
        transported+=slopes[source]*(center-node[source].pv.xyz);}
      rhs+=viscosity*c*(vj-u)-flux*transported;`)+
      'out[i]=vec4f(u+DT*rhs/cell.pv.w,skin);'));
  const faceCode=decl(0,'ends','vec2u')+decl(1,'coeff','vec4f')+decl(3,'q','vec2f',true);
  const edgeMain=s=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
    let e=g.x;if(e>=arrayLength(&q)){return;}let a=ends[e];let i=a.x;let j=a.y&0xfffffffu;let k=a.y>>28u;
    let link=coeff[2u*e];let wall=k==7u||(${f.name==='ahmed'}&&k==3u);${s}}`;
  const forecast=await gpu.kernel('CFD staggered predicted face flow',faceCode+decl(2,'v','vec4f')+decl(4,'node','vec4f')+decl(5,'slope','mat3x3f')+edgeMain(`
    var speed=.5*(v[i].xyz+v[j].xyz);if(k==0u){
      let dx=coeff[2u*e+1u].xyz-.5*(node[2u*i].xyz+node[2u*j].xyz);speed+=.5*((slope[i]+slope[j])*dx);}
    var value=dot(speed,link.xyz);
    if(k==1u){value=${f.U.toFixed(8)}*link.x;}if(wall||link.w==0.){value=0.;}q[e]=vec2f(value,0.);`));
  let advanceFace=null,faceBinding=null;
  if(f.faceHistory){
    advanceFace=await gpu.kernel('CFD transport projected graph face momentum',addFlowWGSL+faceCode+decl(2,'star','vec4f')+
      decl(4,'node','vec4f')+decl(5,'slope','mat3x3f')+decl(6,'old','vec4f')+decl(7,'nut','f32')+edgeMain(`
        if(wall||link.w==0.){q[e]=vec2f(0);return;}
        if(k==1u){q[e]=vec2f(${f.U}*link.x,0);return;}
        let cell=node[2u*i];let other=node[2u*j];let stored=q[e];
        let oldVelocity=.5*(old[i].xyz+old[j].xyz);
        var reconstructed=oldVelocity;
        if(k==0u){
          let offset=coeff[2u*e+1u].xyz-.5*(cell.xyz+other.xyz);
          reconstructed+=.5*((slope[i]+slope[j])*offset);
        }
        let increment=.5*((star[i].xyz-old[i].xyz)+(star[j].xyz-old[j].xyz));
        let mobility=${f.nu}+.5*(nut[i]+nut[j]);
        let rate=.5*${dt}*(1./cell.w+1./other.w)*(.5*abs(stored.x+stored.y)+link.w*mobility);
        let relax=rate/(1.+rate);
        let change=dot(link.xyz,increment)-relax*((stored.x-dot(link.xyz,reconstructed))+stored.y);
        q[e]=addFlow(stored.x,stored.y,change);`));
    faceBinding=gpu.bind(advanceFace,[ends,coef,pred,flows,node,slopes,state,nut]);
  }
  const project=await gpu.kernel('CFD minimum energy face correction',addFlowWGSL+faceCode+decl(2,'p','f32')+edgeMain(`
    if(!wall&&k!=1u&&link.w>0.){let old=q[e];q[e]=addFlow(old.x,old.y,link.w*(p[i]-select(0.,p[j],k==0u)));}`));
  const rhs=await gpu.kernel('CFD signed face imbalance',common+decl(3,'q','vec2f')+decl(4,'b','f32',true)+main(`
    var d=vec2f(0);var carry=vec2f(0);for(var e=cell.start;e<cell.end;e++){${oriented}
      let v=sign*q[faceId];let t=d+v;carry+=select((v-t)+d,(d-t)+v,abs(d)>=abs(v));d=t;}
    let balance=d+carry;b[i]=-(balance.x+balance.y);`));
  const correction=await gpu.kernel('CFD nodal momentum correction and wall force',common+decl(3,'v','vec4f')+decl(4,'p','f32')+
    decl(5,'out','vec4f',true)+decl(6,'force','f32',true)+main(`
    let u=v[i];let pi=p[i];var grad=vec3f(0);var wallPressure=0.;`+walk(`
      let pj=select(0.,p[j],k==0u||solid(k)||inlet(k));let dp=pi-pj;
      grad-=select(1.,0.5,k==0u)*dp*A;
      if(k==7u){wallPressure+=pi/DT*A.x;}`)+
      `out[i]=vec4f(u.xyz-grad/cell.pv.w,0.);force[i]+=${f.rho}*(wallPressure+u.w);`));
  const geom=[node,tag,coef];
  const vb=gpu.bind(visc,[...geom,state,nut,slopes,normalInverse]),mb=gpu.bind(m,[...geom,state,flows,nut,pred,slopes]),cb=gpu.bind(correction,[...geom,pred,mg.p,state,force]);
  const rb=gpu.device.createBindGroup({layout:rhs.getBindGroupLayout(0),entries:[[0,node],[1,tag],[3,flows],[4,mg.b]].map(([binding,buffer])=>({binding,resource:{buffer}}))});
  const fb=gpu.bind(forecast,[ends,coef,pred,flows,node,slopes]),pb=gpu.bind(project,[ends,coef,mg.p,flows]);
  gpu.run(forecast,[ends,coef,state,flows,node,slopes],edgeGrid);
  const firstPressure=buf('pressure before defect correction',n*4);
  const addPressure=await gpu.kernel('CFD accumulate projected pressure',decl(0,'base','f32')+decl(1,'p','f32',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x<arrayLength(&p)){p[g.x]+=base[g.x];}}`);
  const addBinding=gpu.bind(addPressure,[firstPressure,mg.p]);
  const stage=gpu.staging('CFD graph field diagnostics',Math.max(n*16,edges*8));
  const mean=buf('time averaged axial velocity',n*4);
  const sample=await gpu.kernel('CFD graph average',decl(0,'v','vec4f')+decl(1,'s','f32',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x<arrayLength(&s)){s[g.x]+=v[g.x].x;}}`);
  const sb=gpu.bind(sample,[state,mean]);
  const maximum=buf('maximum node divergence',4),peakStage=gpu.staging('CFD graph convergence scalar',4);
  const norm=await gpu.kernel('CFD graph relative mass defect',decl(0,'node','vec4f')+decl(1,'b','f32')+`
    @group(0) @binding(2) var<storage,read_write> peak:atomic<u32>;var<workgroup> local:array<u32,128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(local_invocation_index) k:u32){
      var d=0.;if(g.x<arrayLength(&b)){d=abs(b[g.x])*(${f.period}/node[2u*g.x].w);}local[k]=bitcast<u32>(d);
      for(var h=64u;h>0u;h/=2u){workgroupBarrier();if(k<h){local[k]=max(local[k],local[k+h]);}}
      if(k==0u){atomicMax(&peak,local[0]);}}`);
  const normBind=gpu.bind(norm,[node,mg.b,maximum]);
  const phase=(kind,encode)=>({kind,encode});
  function pressure(iterations){
    return [phase('graph V-cycle',mg.cycle),phase('graph initial direction',mg.krylov.prepare),
      ...Array.from({length:iterations},(_,k)=>phase('graph Krylov iteration',e=>mg.krylov.iterate(e,k+1===iterations)))];
  }
  const start=[4,16].map((k,cold)=>[phase('graph momentum',e=>{gpu.dispatch(e,visc,vb,grid);gpu.dispatch(e,m,mb,grid);}),
    phase('graph face predictor',e=>{if(!cold&&advanceFace)gpu.dispatch(e,advanceFace,faceBinding,edgeGrid);
      else gpu.dispatch(e,forecast,fb,edgeGrid);gpu.dispatch(e,rhs,rb,grid);}),...pressure(k),
    phase('graph face projection',e=>{gpu.dispatch(e,project,pb,edgeGrid);gpu.dispatch(e,rhs,rb,grid);})]);
  function refinement(stages){return [phase('graph restart pressure',e=>{e.copyBufferToBuffer(mg.p,0,firstPressure,0,n*4);e.clearBuffer(mg.p);}),
    ...stages,phase('graph refine stored flows',e=>{
      gpu.dispatch(e,project,pb,edgeGrid);gpu.dispatch(e,addPressure,addBinding,grid);gpu.dispatch(e,rhs,rb,grid);
      e.clearBuffer(maximum);gpu.dispatch(e,norm,normBind,grid);e.copyBufferToBuffer(maximum,0,peakStage,0,4);
    })];}
  const restarts=[8,24,48,96].map(n=>refinement(pressure(n))),local=refinement([phase('graph local pressure smoothing',mg.smooth)]);
  const wallSample=buf('area and y+ at each side of a solid face',g.nbr.length*8);
  const wallStage=gpu.staging('CFD wall-resolution diagnostics',wallSample.size);
  const wallDiagnostic=await gpu.kernel('CFD graph physical wall resolution',common+
    decl(3,'v','vec4f')+decl(4,'sample','vec2f',true)+main(walk(`
      if(k==7u){let area=length(A);let d=area/c;let slip=length(tangentialSlip(v[i].xyz,A/area));
        let resistance=wallNu(v[i].xyz,A,c)/d;sample[e]=vec2f(area,d*sqrt(slip*resistance)/NU);}`)));
  const correct=phase('graph wall force and velocity',e=>gpu.dispatch(e,correction,cb,grid)),samplePlane=phase('graph wake sample',e=>gpu.dispatch(e,sample,sb,grid));
  const target=7e-7*Math.min(1,f.period);
  const convergence={steps:0,additionalPasses:0,localPasses:0,longRestarts:0,maximumPasses:0,maxRelativeDivergence:0,maxDivergencePerS:0,missedSteps:0,firstStepDivergencePerS:[]};
  return {dt,state,force,sum,mean,convergence,readMean:()=>gpu.read(mean,stage,n),
    async step(sampling,scheduler,assertCurrent){
      await scheduler.perform([...start[Number(convergence.steps===0)],...restarts[0]],assertCurrent);
      let passes=1,peak,previous=null,usedLocal=false,allowLocal=true,restart=0;
      for(;;){
        await peakStage.mapAsync(GPUMapMode.READ);
        try{peak=new Float32Array(peakStage.getMappedRange())[0];}finally{peakStage.unmap();}
        if(!Number.isFinite(peak))throw Error('Nonfinite stored SDF-graph flux');
        if(!convergence.steps)convergence.firstStepDivergencePerS.push(peak/f.period);
        if(peak<=target||passes>=16)break;
        if(previous!==null){
          if(usedLocal){allowLocal=peak<.35*previous;}
          else if(peak>.05*previous){restart=Math.min(restarts.length-1,restart+1);}
          else if(peak<.001*previous){restart=0;}
        }
        usedLocal=allowLocal&&peak<=256*target;previous=peak;
        if(usedLocal)convergence.localPasses++;else if(restart>0)convergence.longRestarts++;
        await scheduler.perform(usedLocal?local:restarts[restart],assertCurrent);passes++;
      }
      convergence.steps++;convergence.additionalPasses+=passes-1;
      convergence.lastRelativeDivergence=peak;
      convergence.maxDivergencePerS=Math.max(convergence.maxDivergencePerS,peak/f.period);
      if(peak>=1e-6||peak/f.period>=1e-6)convergence.missedSteps++;
      convergence.maximumPasses=Math.max(convergence.maximumPasses,passes);convergence.maxRelativeDivergence=Math.max(convergence.maxRelativeDivergence,peak);
      await scheduler.perform(sampling?[correct,samplePlane]:[correct],assertCurrent);
    },
    async diagnostics(wakeLengthM){
      const v=await gpu.read(state,stage,n*4),q=await gpu.read(flows,stage,2*edges);
      gpu.run(wallDiagnostic,[...geom,state,wallSample],grid);
      const samples=await gpu.read(wallSample,wallStage,2*g.nbr.length),body=[];let areaM2=0,belowOne=0,belowThirty=0;
      for(let e=0;e<g.nbr.length;e++){const area=samples[2*e],y=samples[2*e+1];if(!area)continue;
        if(!Number.isFinite(area+y)||y<0)throw Error('Invalid graph wall resolution');body.push([y,area]);areaM2+=area;
        if(y<=1)belowOne+=area;if(y<=30)belowThirty+=area;
      }body.sort((a,b)=>a[0]-b[0]);
      const quantile=q=>{let sum=0;for(const [y,area] of body){sum+=area;if(sum>=q*areaM2)return y;}return null;};
      let max=0,net=0,exterior=0,sealedMax=0;const yplus=[];
      for(let i=0;i<n;i++){
        let imbalance=0;
        for(let e=g.offset[i];e<g.offset[i+1];e++){
          const id=g.linkFace[e],face=id<0?~id:id,flux=(id<0?-1:1)*(q[2*face]+q[2*face+1]),kind=g.kind[e];imbalance+=flux;
          if(kind!==0)exterior+=flux;
          if(kind===7||(f.name==='ahmed'&&kind===3))sealedMax=Math.max(sealedMax,Math.abs(flux));
          if(kind===7&&g.coeff[4*e+3]>0){const d=Math.hypot(...g.coeff.subarray(4*e,4*e+3))/g.coeff[4*e+3];yplus.push(d*Math.sqrt(f.nu*Math.hypot(...v.subarray(4*i,4*i+3))/d)/f.nu);}
        }
        net+=imbalance;max=Math.max(max,Math.abs(imbalance)/g.pos[4*i+3]);
      }
      yplus.sort((a,b)=>a-b);
      return {maxDivergencePerS:max,relativeDivergenceMax:max*f.period,wakeLengthM,netBoundaryFlowM3PerS:exterior,
        bodyWallResolution:areaM2>0?{areaM2,wallFaces:body.length,yPlusP10:quantile(.1),yPlusP50:quantile(.5),yPlusP90:quantile(.9),
          fractionOfAreaAtMost1:belowOne/areaM2,fractionOfAreaAtMost30:belowThirty/areaM2}:null,
        internalCancellationErrorM3PerS:Math.abs(net-exterior),maxImpermeableFaceFlowM3PerS:sealedMax,faceFlowDegreesOfFreedom:edges,storedFaceScalars:2*edges,
        wallYPlusViscousEstimateP50:yplus[Math.floor(yplus.length*.5)]};
    }};
}

export async function benchmarkGraph(device,f,progress,capture=null){
  const start=performance.now(),gpu=gpuScope(device),budget=f.budgetMs??caseBudgetMs;let stop=null;
  try{
    stop=viewportMonitor();
    const sm=capture?null:surfaceBand(f),metric=capture?await nativeGraphMetric(device,f,capture):await fixtureMetric(device,sm);
    const band=metric.sm??sm;
    const {packed,stats}=await build(device,band,metric.field,capture);capture?.assertCurrent();
    if(capture){stats.triangleCrossings=await sealNativeGraph(device,packed,capture);
      stats.edges-=stats.triangleCrossings.closed;stats.blockedEdges+=stats.triangleCrossings.closed;}
    stats.gpuWeights=await graphWeights(device,f,packed);
    stats.components=packed.components;stats.gauges=packed.gauges;
    const graphGenerationMs=performance.now()-start;
    progress(f.name+' SDF graph '+stats.sites+' nodes, '+stats.edges+' faces, '+graphGenerationMs.toFixed(0)+' ms');
    const s=await solver(gpu,f,packed);await device.queue.onSubmittedWorkDone();
    const scheduler=viewportBudget(device,stop.lastFrame),sampleWake=graphWakeSampler(f,packed);
    const setupMs=performance.now()-start,windows=[];let step=0,diverged=false;
    let budgetExhausted=false,lastWindow=null,wakeLengthM=null;
    const requireWake=f.sphere||f.id==='ahmed-wake';
    periods: for(let window=1;window<=32;window++){
      const e=device.createCommandEncoder();e.clearBuffer(s.force);e.clearBuffer(s.mean);device.queue.submit([e.finish()]);
      const end=Math.round(window*f.period/s.dt),first=step;
      while(step<end){
        if(performance.now()-start>=budget){budgetExhausted=true;break periods;}
        await s.step(window>=4,scheduler,capture?.assertCurrent);step++;
      }
      const forceN=await s.sum()/(step-first),coefficient=forceN/f.normalization;
      let windowWake=null;
      if(window>=4){const mean=await s.readMean(),steps=step-first;
        windowWake=sampleWake(mean,steps);
        wakeLengthM=lastWindow?sampleWake(mean,steps,lastWindow):windowWake;
        lastWindow={mean,steps};
      }
      windows.push({period:window,forceN,coefficient,wakeLengthM:windowWake,physicalTimeS:step*s.dt,elapsedMs:performance.now()-start});
      progress(f.id+' sdf-graph period '+window+' CD '+coefficient.toFixed(4));if(!Number.isFinite(coefficient)){diverged=true;break;}if(settledPeriods(windows,requireWake))break;
    }
    const viewport=stop();stop=null;
    const field=diverged||!step?null:await s.diagnostics(wakeLengthM),samples=windows.slice(-2).map(w=>w.coefficient),mean=samples.reduce((a,b)=>a+b,0)/samples.length,ref=references[f.id];
    const stable=!diverged&&settledPeriods(windows,requireWake),relativeError=ref.value?Math.abs(mean/ref.value-1):null;
    const forcePassed=!!ref.value&&stable&&samples.every(v=>Math.abs(v/ref.value-1)<=.05);
    const expectedWake=ref.wakeM??(ref.wakeDiameters??0)*.08;
    const wakePassed=expectedWake?Number.isFinite(field?.wakeLengthM)&&Math.abs(field.wakeLengthM/expectedWake-1)<=.05:null;
    const totalMs=performance.now()-start;capture?.assertCurrent();
    return {fixture:f.id,kind:'sdf-graph',dtS:s.dt,windows,mean,relativeError,forcePassed,stable,field,viewport,stats,wakePassed,diverged,
      faceMomentum:f.faceHistory?'transported staggered face flow':'interpolated predictor',
      metric:{source:metric.source,dims:band.dims,pitchM:band.h,ms:metric.ms,peakGpuBytes:metric.peakGpuBytes},
      graphGenerationMs,setupMs,totalMs,caseBudgetMs:budget,budgetExhausted,completedSteps:step,timeToStationaryMs:stable?windows.at(-1).elapsedMs:null,
      ownedBufferBytes:Math.max(metric.peakGpuBytes,stats.wallFit?.peakGpuBytes??0,stats.triangleCrossings?.peakGpuBytes??0,stats.gpuWeights.peakGpuBytes,gpu.allocatedBytes),solverBufferBytes:gpu.allocatedBytes,
      fluxConvergence:s.convergence,scheduling:scheduler.measure(),
      timeToTargetMs:stable&&(!ref.value||forcePassed)&&wakePassed!==false&&viewport.qualified&&field?.relativeDivergenceMax<1e-6&&field?.maxDivergencePerS<1e-6&&
        s.convergence.maxRelativeDivergence<1e-6&&s.convergence.maxDivergencePerS<1e-6?totalMs:null};
  }finally{stop?.();gpu.close();}
}
