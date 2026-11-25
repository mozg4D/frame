import {gpuScope,streamlinePaths} from '../../plugin.js';

export async function verifyNativeFlowLines(){
  const call=(name,params={})=>frameAI.call(name,params);await call('scene.new');
  const {hash:id}=await call('scene.create',{type:'cfd',params:{Speed:.018258982159215297}});
  const body=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':5}});
  await call('transform.set',{ids:[body.hash],channel:'position',axis:1,value:100,coordinates:'world'});
  await call('view.set',{index:0,single:true,focus:body.hash,shading:'solid'});
  await call('scene.create',{type:'render',params:{renderer:'Viewport',realtime:'off','resolution x':192,'resolution y':192}});
  await call('scene.select',{ids:[id]});document.querySelector('#tabAttributes').click();
  const op=(operation,args={})=>call('plugins.command',{id,operation,args}),image=()=>call('render.export',{kind:'image',download:false});
  const control=()=>document.querySelector('[data-plugin-number="flow-lines"]');
  if(control()?.getClientRects().length)throw Error('Streamline display control visible before a physical field exists.');
  async function edit(value,cancel=false){
    const input=control();if(!input?.getClientRects().length)throw Error('Missing Flow lines numeric control');
    input.focus();input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keydown',{key:cancel?'Escape':'Enter',bubbles:true}));input.blur();
    await call('diagnostics.frame',{frames:1});return Number(control().value);
  }
  await image();const solved=await op('results'),saved=solved.job.id;
  if(solved.state!=='ready'||!solved.result.surfaceFields.available.includes('Shape')||Number(control().value)!==0)
    throw Error('Missing stationary three-dimensional fields: '+JSON.stringify(solved));
  const points=Array.from({length:1024},(_,i)=>[(6*(i%32)+2.5)/192,(6*Math.floor(i/32)+2.5)/192]);
  const pixels=async()=>{const colors=[];for(let i=0;i<points.length;i+=64)colors.push(...(await call('render.pixels',{points:points.slice(i,i+64)})).colors);return colors;};
  const difference=(a,b)=>Math.max(...a.slice(0,3).map((v,k)=>Math.abs(v-b[k])));
  const sets={},palettes={},changedPixels={};
  for(const mode of ['Pressure','Separation','Shape','Drag']){
    await op(mode.toLowerCase()+'-map');await edit(0);await image();const off=await pixels();
    if(await edit(96)!==96)throw Error('Native numeric edit did not set the requested density');
    await image();const on=await pixels();sets[mode]=on.map((v,k)=>difference(v,off[k])>10);palettes[mode]=on;
    changedPixels[mode]=sets[mode].filter(Boolean).length;
  }
  const recolored={};for(const mode of ['Separation','Shape','Drag']){
    recolored[mode]=sets[mode].filter((hit,k)=>hit&&sets.Pressure[k]&&difference(palettes[mode][k],palettes.Pressure[k])>10).length;
  }
  let samples=0,longest=0,minRadius=Infinity,loss=0,adjoint=0,pMin=Infinity,pMax=-Infinity,invalid=0;
  for(let seed=0;seed<48;seed++)for(const backward of [false,true]){
    const line=await op('flow-line',{seed,backward});longest=Math.max(longest,line.points.length);
    for(const v of line.points){
      samples++;const [x,y,z]=v.worldM;minRadius=Math.min(minRadius,Math.hypot(x,y-.1,z));loss=Math.max(loss,v.dissipationWPerM3);
      adjoint=Math.max(adjoint,v.adjointMagnitude);pMin=Math.min(pMin,v.pressurePa);pMax=Math.max(pMax,v.pressurePa);
      if(![...v.worldM,v.pressurePa,v.dissipationWPerM3,v.adjointMagnitude].every(Number.isFinite)||v.dissipationWPerM3<0||
        v.adjointMagnitude<0||v.gammaRev!==null&&(v.gammaRev<0||v.gammaRev>1))invalid++;
    }
  }
  const cancelled=await edit(17,true),same=(await op('results')).job.id;
  await call('transform.set',{ids:[body.hash],channel:'position',axis:1,value:101,coordinates:'world'});
  await call('diagnostics.frame',{frames:2});const hidden=!control()?.getClientRects().length;
  return {pass:samples>1000&&minRadius>.038&&longest>=30&&loss>0&&adjoint>0&&pMin<0&&pMax>0&&invalid===0&&
    Object.values(changedPixels).every(n=>n>2)&&Object.values(recolored).every(n=>n>0)&&same===saved&&cancelled===96&&hidden,
    changedPixels,recolored,samples,longest,minRadiusM:minRadius,maxDissipationWPerM3:loss,maxAdjointMagnitude:adjoint,
    pressurePa:[pMin,pMax],invalid,job:saved,afterDisplayEdits:same,cancelled,hiddenAfterEdit:hidden};
}

export async function verifyStreamlines(device){
  const check=async circular=>{
    const gpu=gpuScope(device),dims=[24,24,24],n=dims.reduce((a,b)=>a*b),h=1/24,origin=[-.5,0,-.5];
    try{
      const axis=(a,i)=>origin[a]+i/24+.045*Math.sin(2*Math.PI*i/24),axes=origin.map((_,a)=>Array.from({length:25},(_,i)=>axis(a,i)));
      const f={origin,axes,dims,h,rho:1,U:circular?0:1,maxSpeed:1};
      const region={center:[0,.5,0],halfAxes:[[.5,0,0],[0,.5,0],[0,0,.5]],inverse:[1000,0,0,0,0,1000,0,0,0,0,1000,0,0,0,0,1]};
      const macro=new Float32Array(4*n),obs=new Float32Array(4*n);
      for(let i=0;i<n;i++){
        const p=[i%24,Math.floor(i/24)%24,Math.floor(i/576)],v=p.map((k,a)=>(axis(a,k)+axis(a,k+1))*.5);
        const [x,y,z]=v;macro.set([...(circular?[.5-y,x,0]:[1,0,0]),2*x+.3*y-z],4*i);
        obs.set([1+z,.25,2,circular||p[0]!==11?15:14],4*i);
      }
      const flow=await streamlinePaths(gpu,f,{region,bodies:{min:[-.16,.35,-.1],max:[.16,.65,.1]},scale:.4},
        gpu.buffer('Analytical flow',macro),gpu.buffer('Sealed sheet and analytical scalars',obs));
      flow.set(24);let points=0,compared=0,faceCrossings=0,maxError=0,fieldError=0,nearSheet=0,directionError=0;
      for(let id=0;id<24;id++)for(const backward of [false,true]){
        const line=await flow.read(id,backward);if(!line.length)continue;points+=line.length;
        const [x0,y0,z0]=line[0].pointM,r0=Math.hypot(x0,y0-.5);
        for(let i=0;i<line.length;i++){
          const {pointM:[x,y,z],pressurePa,dissipationWPerM3,gammaRev,adjointMagnitude}=line[i];
          if(circular&&r0>.32)continue;
          if(circular){maxError=Math.max(maxError,Math.abs(Math.hypot(x,y-.5)-r0),Math.abs(z-z0));}
          else{
            maxError=Math.max(maxError,Math.abs(y-y0),Math.abs(z-z0));
            if(x*x0<0)faceCrossings++;
            if(i){const dx=x-line[i-1].pointM[0];directionError=Math.max(directionError,backward?dx:-dx);}
            if(Math.abs(x)<.012)nearSheet++;
          }
          if(Math.abs(x)<.42&&Math.abs(y-.5)<.42&&Math.abs(z)<.42&&(circular||Math.abs(x)>.06)){
            compared++;fieldError=Math.max(fieldError,Math.abs(pressurePa-(2*x+.3*y-z)),Math.abs(dissipationWPerM3-1-z),
              Math.abs(gammaRev-.25),Math.abs(adjointMagnitude-2));}
        }
      }
      flow.set(0);return {points,compared,faceCrossings,nearSheet,maxError,fieldError,directionError,disabled:flow.density===0};
    }finally{gpu.close();}
  };
  const straight=await check(false),circular=await check(true);
  return {pass:straight.points>250&&straight.compared>100&&straight.nearSheet>15&&!straight.faceCrossings&&straight.maxError<1e-6&&
    straight.directionError<1e-6&&circular.points>900&&circular.compared>400&&circular.maxError<.006&&
    straight.fieldError<3e-6&&circular.fieldError<3e-6&&straight.disabled&&circular.disabled,straight,circular};
}
