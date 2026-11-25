import {gridWGSL} from './fixtures.mjs';

// A single packed lattice plus a snapshot of shared brick boundaries. A
// workgroup reads its own complete tile before writing it; foreign boundary
// reads always address the immutable snapshot of the same physical step.
export function momentShell(){
  let size=0;const map=Array.from({length:128},(_,i)=>{const x=i%8,y=(i>>3)%4,z=i>>5;
    return x===0||x===7||y===0||y===3||z===0||z===3?size++:-1;});
  return {size,map};
}
export async function momentSolver(gpu,f,dt,wall,force){
  const count=f.dims.reduce((a,b)=>a*b), groups=[Math.ceil(count/128)];
  const u0=f.U*dt/f.h, tau=0.5+3*f.nu*dt/f.h**2;
  const links=!!f.interpolatedWall;
  if(links&&(f.axes||f.rotor))throw Error('Interpolated lattice links require a stationary geometry on a uniform physical lattice');
  const loads=links?gpu.buffer('CFD link momentum exchange',count*16):null;
  const directions=[];
  for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)
    if(x*x+y*y+z*z<=2)directions.push(`vec3i(${x},${y},${z})`);
  const header=gridWGSL(f)+`
    struct Moments{rho:f32,jx:f32,jy:f32,jz:f32,p0:u32,p1:u32,p2:u32}
    const E=array<vec3i,19>(${directions.join(',')});
    fn far()->Moments{return Moments(0.,${u0},0.,0.,0u,0u,0u);}
    fn distribution(m:Moments,e:vec3f,w:f32)->f32{
      let rho=1.+m.rho;let j=vec3f(m.jx,m.jy,m.jz);let ej=dot(e,j);
      let p0=unpack2x16float(m.p0);let p1=unpack2x16float(m.p1);let p2=unpack2x16float(m.p2);
      let contraction=dot(e*e-vec3f(1./3.),vec3f(p0,p1.x))+2.*dot(vec3f(e.x*e.y,e.x*e.z,e.y*e.z),vec3f(p1.y,p2));
      return w*(m.rho+3.*ej+(4.5*ej*ej-1.5*dot(j,j))/rho+4.5*contraction);
    }`;
  const tiles=f.dims.map((n,k)=>Math.ceil(n/[8,4,4][k])),shell=momentShell();
  const addressing=`const SHELL=array<i32,128>(${shell.map.join(',')});
    fn address(p:vec3i)->vec3i{return ${f.periodicTangents?'vec3i((p.x+DIMS.x)%DIMS.x,clamp(p.y,0,DIMS.y-1),(p.z+DIMS.z)%DIMS.z)':'clamp(p,vec3i(0),DIMS-1)'};}
    fn available(p:vec3i)->bool{return ${f.periodicTangents?'p.y>=0&&p.y<DIMS.y':'inside(p)'};}
    fn brickId(b:vec3i)->u32{return u32(b.x+${tiles[0]}*(b.y+${tiles[1]}*b.z));}
    fn shellId(p:vec3i)->u32{let b=p/vec3i(8,4,4);let l=p%vec3i(8,4,4);
      return brickId(b)*${shell.size}u+u32(SHELL[u32(l.x+8*(l.y+4*l.z))]);}`;
  const a=gpu.buffer('CFD packed lattice',count*28),halo=gpu.buffer('CFD packed inter-brick boundaries',tiles.reduce((a,b)=>a*b)*shell.size*28);
  const init=await gpu.kernel('CFD initial moments',header+`
    @group(0) @binding(0) var<storage,read_write> out:array<Moments>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x<CELLS){out[g.x]=far();}}`);
  gpu.run(init,[a],groups);
  const snapshot=await gpu.kernel('CFD snapshot packed boundary moments',header+addressing+`
    @group(0) @binding(0) var<storage,read> src:array<Moments>;
    @group(0) @binding(1) var<storage,read_write> boundaries:array<Moments>;
    @compute @workgroup_size(8,4,4) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(local_invocation_index) lane:u32){
      let p=vec3i(g);if(inside(p)&&SHELL[lane]>=0){boundaries[shellId(p)]=src[index(p)];}}`);
  const pipe=await gpu.kernel('CFD regularized moment collision and streaming',header+addressing+`
    @group(0) @binding(0) var<storage,read_write> state:array<Moments>;
    @group(0) @binding(1) var<storage,read> boundaries:array<Moments>;
    @group(0) @binding(2) var<storage,read> wall:array<vec4f>;
    @group(0) @binding(3) var<storage,read_write> force:array<f32>;
    ${links?'@group(0) @binding(4) var<storage,read_write> load:array<vec4f>;':''}
    var<workgroup> tile:array<Moments,360>;
    fn localId(p:vec3i)->u32{return u32(p.x+10*(p.y+6*p.z));}
    @compute @workgroup_size(8,4,4) fn main(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
      let origin=vec3i(block)*vec3i(8,4,4);
      for(var k=lane;k<360u;k+=128u){let h=vec3i(vec3u(k%10u,(k/10u)%6u,k/60u));let q=address(origin+h-1);
        if(all(q/vec3i(8,4,4)==vec3i(block))){tile[k]=state[index(q)];}else{tile[k]=boundaries[shellId(q)];}}
      workgroupBarrier();storageBarrier();let p=origin+vec3i(local);if(!inside(p)){return;}let i=index(p);let here=vec3i(local)+1;
      ${links?`let cellWall=wall[i];if(cellWall.x<=0.){return;}
      let localState=tile[localId(here)];var wallImpulse=vec3f(0);var axialMoment=0.;
      let arm=vec3f(${f.origin.join(',')})+(vec3f(p)+.5)*${f.h};`:''}
      var drho=0.;var j=vec3f(0);var diag=vec3f(0);var shear=vec3f(0);var incomingH=0.;
      for(var q=0u;q<19u;q++){
        let d=E[q];let e=vec3f(d);let n=p-d;let d2=dot(e,e);
        let w=select(select(1./36.,1./18.,d2==1.),1./3.,d2==0.);
        var pop=0.;
        if(available(n)){
          ${links?`let other=wall[index(address(n))];
          if(other.x<=0.&&d2>0.){
            let fraction=clamp(cellWall.x/(cellWall.x-other.x),0.,1.);
            let away=p+d;var t=fraction;
            if(!available(away)||wall[index(address(away))].x<=0.){t=max(t,.5);}
            let uw=vec3f(0.,mix(cellWall.yz,other.yz,fraction));
            let outgoing=distribution(localState,-e,w);
            let motion=3.*w*(1.+localState.rho)*dot(e,uw);
            if(t<.5){pop=2.*t*outgoing+(1.-2.*t)*distribution(tile[localId(here+d)],-e,w)+2.*motion;}
            else{let a=.5/t;pop=a*outgoing+(1.-a)*distribution(localState,e,w)+motion/t;}
            // Gauge-subtracted momentum exchange. Opposing equilibrium weights
            // cancel exactly on a closed lattice body. Use the wall rest frame.
            let reaction=-(outgoing+pop)*e+(pop-outgoing)*uw;
            wallImpulse+=reaction;axialMoment+=cross(arm-fraction*e*${f.h},reaction).x;
          }else`:''}{pop=distribution(tile[localId(here-d)],e,w);}
        }
        else if(${f.name==='ahmed'} && n.y<0){pop=distribution(tile[localId(here)],-e,w);}
        else if(${!f.rotor} && n.x>=DIMS.x){
          var exterior=tile[localId(here)];let density=1.+exterior.rho;exterior.rho=0.;
          exterior.jx/=density;exterior.jy/=density;exterior.jz/=density;pop=distribution(exterior,e,w);}
        else {pop=distribution(far(),e,w);}
        let positive=max(w+pop,1e-20);incomingH+=positive*log(positive/w);
        drho+=pop;j+=e*pop;diag+=e*e*pop;shear+=vec3f(e.x*e.y,e.x*e.z,e.y*e.z)*pop;
      }
      let rho=1.+drho;let u=j/rho;
      diag-=vec3f(drho/3.)+j*u;shear-=vec3f(j.x*u.y,j.x*u.z,j.y*u.z);
      // Smagorinsky stress regularization on unresolved scales.
      let stress=sqrt(dot(diag,diag)+2.*dot(shear,shear));
      let tau=0.5*(${tau}+sqrt(${tau*tau}+18.*sqrt(2.)*${f.sphere?0:0.14**2}*stress/rho));
      var relax=1.-1./tau;
      // Test entropy at conserved pre-forcing moments. Only back off an
      // overrelaxed collision that loses positivity or increases discrete H.
      for(var trial=0u;trial<4u;trial++){
        var entropy=0.;var positive=true;
        for(var q=0u;q<19u;q++){
          let e=vec3f(E[q]);let d2=dot(e,e);let w=select(select(1./36.,1./18.,d2==1.),1./3.,d2==0.);
          let eu=dot(e,u);let t=dot(e*e-vec3f(1./3.),diag)+2.*dot(vec3f(e.x*e.y,e.x*e.z,e.y*e.z),shear);
          let pop=w*(rho*(1.+3.*eu+4.5*eu*eu-1.5*dot(u,u))+4.5*relax*t);
          if(pop<=0.){positive=false;}let safe=max(pop,1e-20);entropy+=safe*log(safe/w);
        }
        if(positive && entropy<=incomingH+4e-7){break;}relax*=0.5;
      }
      ${links?`force[i]+=wallImpulse.x;load[i]+=vec4f(0.,axialMoment,wallImpulse.yz);`:`let solid=wall[i];let damping=1.-exp(-${10*f.maxSpeed*dt/f.h}*solid.w);
      let reaction=damping*(j-rho*vec3f(0.,solid.yz));
      j-=reaction;force[i]+=reaction.x;`}
      // Reservoir relaxation occupies the downstream buffer beyond the test body.
      let layer=smoothstep(0.83,1.,(f32(p.x)+0.5)/f32(NX));
      let sponge=select(1.,exp(-${2*f.maxSpeed*dt/f.h}*layer),${!f.rotor&&!f.periodicTangents});
      drho*=sponge;j=mix(vec3f(${u0},0.,0.),j,sponge);relax*=sponge;
      state[i]=Moments(drho,j.x,j.y,j.z,pack2x16float(relax*diag.xy),pack2x16float(relax*vec2f(diag.z,shear.x)),pack2x16float(relax*shear.yz));
    }`);
  const saved=gpu.bind(snapshot,[a,halo]),binding=gpu.bind(pipe,[a,halo,wall,force,...loads?[loads]:[]]);
  const encode=e=>{gpu.dispatch(e,snapshot,saved,tiles);gpu.dispatch(e,pipe,binding,tiles);};
  return {bytesPerStateNode:28,residentStateBytes:a.size,globalHaloBytes:halo.size,tileBytes:360*28,
    moments:a,loads,hasPressureSplit:false,encode,
    step(){const e=gpu.device.createCommandEncoder();encode(e);gpu.device.queue.submit([e.finish()]);}};
}
