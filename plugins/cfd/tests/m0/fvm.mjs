import {gridWGSL} from './fixtures.mjs';
import {openBoundaries,pressureMultigrid} from './multigrid.mjs';
import {metricBuffer,metricWGSL} from './rectilinear.mjs';

export const immersedFaceWGSL=`
  fn projectFace(raw:f32,body:f32,mu:f32,pressureSlope:f32)->vec2f{
    let free=raw-pressureSlope;
    if(mu==1.){return vec2f(free,0.);}if(mu==0.){return vec2f(body,free-body);}
    // Solid receives the equal and opposite constraint impulse. Including
    // the pressure jump here is essential for a thin accelerating boundary.
    return vec2f(mix(body,free,mu),(1.-mu)*(free-body));
  }`;

// Accumulate the six signed face values before combining the correction.
// Differencing three component pairs first can lose their cancellation.
export const faceBalanceWGSL=`
  fn faceBalance(hi:vec3f,lo:vec3f)->f32{
    var sum=0.;var tail=0.;for(var k=0u;k<6u;k++){
      let a=k%3u;let x=select(hi[a],-lo[a],k>=3u);let t=sum+x;
      tail+=select((x-t)+sum,(sum-t)+x,abs(sum)>=abs(x));sum=t;}return sum+tail;}`;

export async function cartesianSolver(gpu,f,dt,wall,force,mobility){
  const count=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(count/128)];
  const nu=f.nu*dt/f.h**2, cref=f.maxSpeed*dt/f.h, inlet=f.U*dt/f.h;
  const coords=metricBuffer(gpu,f);
  const base=gridWGSL(f)+openBoundaries(f)+metricWGSL(f)+`
    const NU=${nu};const U=${inlet.toFixed(10)};const K0=${1.5*(.005*cref)**2};
    const O0=${1.5*(.005*cref)**2/(5*nu)};
    struct Cell {uk:vec4f,wt:vec2f,padding:vec2f}
    struct Flux {hi:vec4f,lo:vec4f}
    fn far()->Cell{return Cell(vec4f(U,0.,0.,K0),vec2f(O0,0.),vec2f(0));}
    fn floorFace(axis:u32,side:i32)->bool{return ${f.name==='ahmed'||!!f.movingRoad} && axis==1u && side<0;}
  `;
  const s0=gpu.buffer('CFD momentum and SST',count*32), pred=gpu.buffer('CFD predicted state',count*32);
  const flux=gpu.buffer('CFD conservative corrected face flux',count*32);
  const fluxTail=gpu.buffer('CFD conservative face flux correction',count*32);
  const loads=gpu.buffer('CFD wall pressure impulse and axial moment',count*16);
  const mg=await pressureMultigrid(gpu,f,mobility);
  const decl=(b,name,type,write=false)=>`@group(0) @binding(${b}) var<storage,${write?'read_write':'read'}> ${name}:array<${type}>;`;
  const main=body=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}let p=point(i);${body}}`;
  const init=await gpu.kernel('CFD uniform initial flow',base+decl(0,'s','Cell',true)+decl(1,'flux','Flux',true)+main('s[i]=far();let q=vec4f(U*faceAreas(cellWidths(p)).x,0.,0.,0.);flux[i]=Flux(q,q);'));
  gpu.run(init,[s0,flux],grid,coords);
  const momentum=await gpu.kernel('CFD finite-volume momentum and SST transport',base+
    decl(0,'s','Cell')+decl(1,'flux','Flux')+decl(2,'wall','vec4f')+decl(3,'out','Cell',true)+decl(4,'tail','Flux')+main(`
      let a=s[i];let solid=wall[i];let u=a.uk.xyz;let k=max(a.uk.w,1e-12);let omega=max(a.wt.x,1e-8);
      let widths=cellWidths(p);let area=faceAreas(widths);let volume=area.x*widths.x;
      var adv=vec4f(0);var diff=vec3f(0);var grad:mat3x3f;var gk=vec3f(0);var gw=vec3f(0);
      var advW=0.;var dk=0.;var dw=0.;var edk=0.;var edw=0.;
      for(var axis=0u;axis<3u;axis++){var e=vec3i(0);e[axis]=1;
        for(var side=-1;side<=1;side+=2){
          let j=p+side*e;var b=s[bounded(j)];let dir=f32(side);
          let faceFlow=select(flux[i].lo[axis]+tail[i].lo[axis],flux[i].hi[axis]+tail[i].hi[axis],side>0);
          let meshSpeed=${f.rotatingFrame?'vec3f(0.,solid.yz)[axis]':'0.'};
          let q=(faceFlow-area[axis]*meshSpeed)*dir/volume;
          var invD=1./widths[axis];if(inside(j)){invD=spacingInv(axis,p[axis],side);}
          if(!inside(j)){
            if(floorFace(axis,side)){b.uk=vec4f(vec3f(${f.movingRoad?'2.*U':'0.'},0.,0.)-u,k);b.wt=a.wt;}
            else if(!openFace(axis,side)||q<0.){b=far();}
          }
          var up=select(b.uk,a.uk,q>=0.);
          let behind=select(j+side*e,p-side*e,q>=0.);
          if(inside(j)&&inside(behind)){
            let upIndex=select(j[axis],p[axis],q>=0.);let backInv=axisMetric(axis,min(upIndex,behind[axis])).z;
            let back=(up-s[index(behind)].uk)*backInv;let forward=(select(a.uk,b.uk,q>=0.)-up)*invD;
            up+=.5*axisMetric(axis,upIndex).y*select(vec4f(0),sign(back)*min(abs(back),abs(forward)),back*forward>vec4f(0));}
          adv+=q*up;advW+=q*select(b.wt.x,omega,q>=0.);
          let change=b.uk-a.uk;let nut=0.5*(a.wt.y+b.wt.y);
          let lap=invD/widths[axis];let gradWeight=.5*dir*invD;
          diff+=(NU+nut)*lap*change.xyz;grad[axis]+=gradWeight*change.xyz;
          gk[axis]+=gradWeight*change.w;gw[axis]+=gradWeight*(b.wt.x-omega);
          dk+=lap*change.w;dw+=lap*(b.wt.x-omega);edk+=nut*lap*change.w;edw+=nut*lap*(b.wt.x-omega);
        }
      }
      let sym=0.5*(grad+transpose(grad));let ss=2.*(dot(sym[0],sym[0])+dot(sym[1],sym[1])+dot(sym[2],sym[2]));
      let dist=max(0.5,select(solid.x,min(solid.x,axisMetric(1u,p.y).x),${f.name==='ahmed'||!!f.movingRoad}));
      let cd=max(2.*0.856*dot(gk,gw)/omega,1e-14);
      let a1=sqrt(k)/(0.09*omega*dist);let a2=500.*NU/(dist*dist*omega);
      let f1=tanh(pow(min(10.,min(max(a1,a2),4.*0.856*k/(cd*dist*dist))),4.));
      let f2=tanh(pow(min(10.,max(2.*a1,a2)),2.));
      let prod=min(a.wt.y*ss,10.*0.09*k*omega);
      let beta=mix(0.0828,0.075,f1);let gamma=mix(0.44,5./9.,f1);
      var kn=max(1e-12,(k+prod-adv.w+NU*dk+mix(1.,0.85,f1)*edk)/(1.+0.09*omega));
      var wn=max(1e-8,(omega-advW+NU*dw+mix(0.856,0.5,f1)*edw+gamma*select(0.,prod/max(a.wt.y,1e-10),a.wt.y>0.)+
        (1.-f1)*2.*0.856*dot(gk,gw)/omega)/(1.+beta*omega));
      let damping=1.-exp(-${10*cref}*solid.w);
      kn=mix(kn,1e-12,damping);wn=mix(wn,60.*NU/(0.075*0.25),damping);
      let nut=select(0.31*kn/max(0.31*wn,sqrt(ss)*f2),0.,${!!(f.sphere||f.laminar)});
      var tentative=u-adv.xyz+diff;
      ${f.rotatingFrame?`let transverse=tentative.yz;
        tentative.y=${Math.cos(f.omega*dt)}*transverse.x+${Math.sin(f.omega*dt)}*transverse.y;
        tentative.z=${-Math.sin(f.omega*dt)}*transverse.x+${Math.cos(f.omega*dt)}*transverse.y;`:''}
      if(${f.rotor}){
        let domain=cellCenters(DIMS-1)+.5*cellWidths(DIMS-1);let x=cellCenters(p);
        let depth=min(x,domain-x)/domain;let edge=1.-smoothstep(0.,0.11,min(depth.x,min(depth.y,depth.z)));
        let reservoir=1.-exp(-${cref}*edge);tentative=mix(tentative,vec3f(0),reservoir);
        kn=mix(kn,K0,reservoir);wn=mix(wn,O0,reservoir);}
      out[i]=Cell(vec4f(tentative,kn),vec2f(wn,nut),vec2f(0));`));
  const pressureRhs=decl(0,'s','Cell')+decl(1,'wall','vec4f')+decl(2,'mu','vec4f')+immersedFaceWGSL+`
    fn body(i:u32)->vec3f{return vec3f(0.,wall[i].yz);}
    fn face(i:u32,p:vec3i,axis:u32,side:i32)->vec3f{var e=vec3i(0);e[axis]=side;let j=p+e;
      if(inside(j)){let other=index(j);let owner=select(other,i,side>0);let right=select(i,other,side>0);
        ${f.axes?`let m=axisMetric(axis,min(p[axis],j[axis]));let v=mix(s[owner].uk[axis],s[right].uk[axis],.5*m.y*m.z);`:'let v=.5*(s[owner].uk[axis]+s[right].uk[axis]);'}
        return vec3f(v,body(owner)[axis],mu[owner][axis]);}
      var v=s[i].uk[axis];if(!openFace(axis,side)){v=select(0.,U,axis==0u);}return vec3f(v,0.,1.);}`;
  const rhs=await gpu.kernel('CFD immersed flux imbalance',base+pressureRhs+decl(3,'b','f32',true)+main(`
    let area=faceAreas(cellWidths(p));var div=0.;for(var a=0u;a<3u;a++){let hi=face(i,p,a,1);let lo=face(i,p,a,-1);
      div+=area[a]*(projectFace(hi.x,hi.y,hi.z,0.).x-projectFace(lo.x,lo.y,lo.z,0.).x);}b[i]=-div;`));
  const project=await gpu.kernel('CFD coupled wall and pressure projection',base+pressureRhs+decl(3,'pressure','f32')+
    decl(4,'out','Cell',true)+decl(5,'flux','Flux',true)+decl(6,'force','f32',true)+decl(7,'load','vec4f',true)+main(`
    let pi=pressure[i];var t=s[i];var hi=vec3f(0);var lo=vec3f(0);var rawAverage=vec3f(0);
    var impulse=vec3f(0.);var pressureDrag=0.;let widths=cellWidths(p);let area=faceAreas(widths);let volume=widths.x*area.x;
    for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
      var e=vec3i(0);e[a]=side;let j=p+e;var delta=0.;
      if(inside(j)){delta=(pressure[index(j)]-pi)*spacingInv(a,p[a],side);}else if(openFace(a,side)){delta=-2.*pi/widths[a];}
      let slope=f32(side)*delta;let data=face(i,p,a,side);let q=projectFace(data.x,data.y,data.z,slope);
      if(side>0){hi[a]=q.x;}else{lo[a]=q.x;}rawAverage[a]+=0.5*data.x;
      impulse[a]+=0.5*q.y;if(a==0u){pressureDrag-=0.5*(1.-data.z)*slope;}
    }}
    // The cell-to-face average loses a subcell velocity component. Fluid keeps
    // that component. Any part removed inside the solid acts on the body.
    let subcell=t.uk.xyz-rawAverage;let fluidFraction=mu[i].w;
    impulse+=(1.-fluidFraction)*subcell;
    t.uk=vec4f(0.5*(hi+lo)+fluidFraction*subcell,t.uk.w);
    let arm=vec3f(${f.origin.map(v=>v.toFixed(8)).join(',')})+cellCenters(p)*${f.h};
    out[i]=t;flux[i]=Flux(vec4f(hi*area,0),vec4f(lo*area,0));force[i]+=volume*impulse.x;
    load[i]+=volume*vec4f(pressureDrag,cross(arm,impulse).x,impulse.yz);`));
  const m=gpu.bind(momentum,[s0,flux,wall,pred,fluxTail],coords),r=gpu.bind(rhs,[pred,wall,mobility,mg.rhs],coords),c=gpu.bind(project,[pred,wall,mobility,mg.p,s0,flux,force,loads],coords);
  // Refine against the fluxes actually stored in FP32. The smaller correction
  // retains its own word on each face and participates in the next advection.
  const basePressure=gpu.buffer('CFD pressure before flux refinement',4*count);
  const imbalance=await gpu.kernel('CFD stored flux defect',base+faceBalanceWGSL+decl(0,'flux','Flux')+decl(1,'b','f32',true)+decl(2,'tail','Flux')+
    main('b[i]=-(faceBalance(flux[i].hi.xyz,flux[i].lo.xyz)+faceBalance(tail[i].hi.xyz,tail[i].lo.xyz));'));
  const residualGroup=gpu.bind(imbalance,[flux,mg.rhs,fluxTail]);
  const refineFlux=await gpu.kernel('CFD apply low-amplitude flux and pressure reaction',base+decl(0,'mu','vec4f')+decl(1,'pressure','f32')+
    decl(2,'tail','Flux',true)+decl(3,'s','Cell',true)+decl(4,'force','f32',true)+decl(5,'load','vec4f',true)+main(`
      let pi=pressure[i];var hi=vec3f(0);var lo=vec3f(0);var impulse=vec3f(0);let widths=cellWidths(p);let area=faceAreas(widths);
      for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){var e=vec3i(0);e[a]=side;let j=p+e;var slope=0.;var weight=1.;
        if(inside(j)){let k=index(j);weight=mu[select(k,i,side>0)][a];slope=f32(side)*(pressure[k]-pi)*spacingInv(a,p[a],side);}
        else if(openFace(a,side)){slope=-2.*f32(side)*pi/widths[a];}
        let extra=-weight*slope;if(side>0){hi[a]=extra;}else{lo[a]=extra;}impulse[a]-=.5*(1.-weight)*slope;
      }}tail[i].hi+=vec4f(hi*area,0);tail[i].lo+=vec4f(lo*area,0);s[i].uk=vec4f(s[i].uk.xyz+.5*(hi+lo),s[i].uk.w);
      let arm=vec3f(${f.origin.map(v=>v.toFixed(8)).join(',')})+cellCenters(p)*${f.h};
      let volume=widths.x*area.x;force[i]+=volume*impulse.x;load[i]+=volume*vec4f(impulse.x,cross(arm,impulse).x,impulse.yz);`));
  const refineGroup=gpu.bind(refineFlux,[mobility,mg.p,fluxTail,s0,force,loads],coords);
  const accumulate=await gpu.kernel('CFD accumulate physical pressure',decl(0,'first','f32')+decl(1,'p','f32',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u){let i=gid.x;if(i<arrayLength(&p)){p[i]+=first[i];}}`);
  const pressureGroup=gpu.bind(accumulate,[basePressure,mg.p]);
  const [nx,ny,nz]=f.dims,plane=gpu.buffer('CFD time-mean symmetry plane',nx*ny*4);
  const sample=await gpu.kernel('CFD sample planar velocity',decl(0,'s','vec4f')+decl(1,'plane','f32',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i<arrayLength(&plane)){
      let a=(i+${nx*ny*(nz/2-1)}u)*2u;plane[i]+=0.5*(s[a].x+s[a+${nx*ny*2}u].x);}}`);
  const sb=gpu.bind(sample,[s0,plane]);
  // Different command-buffer boundaries leave the numerical iteration order
  // intact. The interactive path can give the viewport the queue between them.
  const phases=new Map();
  function work(cold,sampling){
    const key=Number(cold)+2*Number(sampling);if(phases.has(key))return phases.get(key);
    const list=[],phase=(kind,encode)=>list.push({kind,encode});
    function correct(iterations){
      phase('V-cycle',mg.solve);phase('Krylov start',mg.refine.prepare);
      for(let i=0;i<iterations;i++)phase('Krylov iteration',e=>mg.refine.iterate(e,i+1===iterations));
    }
    if(cold||(f.rotor&&!f.rotatingFrame))phase('geometry coarsening',mg.updateGeometry);
    phase('momentum',e=>gpu.dispatch(e,momentum,m,grid));phase('flux imbalance',e=>gpu.dispatch(e,rhs,r,grid));
    correct(cold?24:f.rotor?10:6);
    function actualDefect(e){e.copyBufferToBuffer(mg.p,0,basePressure,0,4*count);e.clearBuffer(mg.p);gpu.dispatch(e,imbalance,residualGroup,grid);}
    phase('pressure reaction',e=>{gpu.dispatch(e,project,c,grid);e.clearBuffer(fluxTail);actualDefect(e);});
    // A stretched far field can leave a slow error mode after the first Krylov
    // solve. Restart from the measured defect of the updated two-word flows.
    const passes=f.axes?[18,18]:[24];
    for(const [j,n] of passes.entries()){
      correct(n);phase('flux correction',e=>{gpu.dispatch(e,refineFlux,refineGroup,grid);gpu.dispatch(e,accumulate,pressureGroup,grid);
        if(j+1<passes.length)actualDefect(e);else if(sampling)gpu.dispatch(e,sample,sb,[Math.ceil(nx*ny/128)]);});
    }
    phases.set(key,list);return list;
  }
  return {state:s0,pressure:mg.p,flux,fluxTail,plane,loads,phases:(i,sampling)=>work(i===0,sampling),step(i,sampling){
    const e=gpu.device.createCommandEncoder();for(const op of work(i===0,sampling))op.encode(e);gpu.device.queue.submit([e.finish()]);
  }};
}
