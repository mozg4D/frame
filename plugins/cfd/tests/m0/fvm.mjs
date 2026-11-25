import {gridWGSL} from './fixtures.mjs';
import {openBoundaries,pressureMultigrid} from './multigrid.mjs';
import {metricBuffer,metricWGSL} from './rectilinear.mjs';
import {wallResistanceWGSL} from './wall-law.mjs';
import {cutGroups} from './cut-groups.mjs';
import {linearCutPressure} from './cut-pressure.mjs';
import {mergedSstWall} from './sst-wall.mjs';
import {cutFaceTransport} from './face-transport.mjs';
import {rotatingLoads} from './rotating-loads.mjs';
import {outerSpinWGSL,outerTransport} from './outer-transport.mjs';

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

// Renormalize after every correction. A large cold-start correction can
// otherwise occupy the second word and lose subsequent small increments.
export const addFlowWGSL=`
  fn twoSum(a:f32,b:f32)->vec2f{let s=a+b;
    return vec2f(s,select((b-s)+a,(a-s)+b,abs(a)>=abs(b)));}
  fn addFlow(high:f32,low:f32,delta:f32)->vec2f{
    let d=twoSum(low,delta);let s=twoSum(high,d.x);return twoSum(s.x,s.y+d.y);}`;

export async function cartesianSolver(gpu,f,dt,wall,force,mobility,groups=null,centers=null){
  const count=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(count/128)];
  const nu=f.nu*dt/f.h**2, cref=f.maxSpeed*dt/f.h, inlet=f.U*dt/f.h;
  const coords=metricBuffer(gpu,f);
  const base=gridWGSL(f)+openBoundaries(f)+metricWGSL(f)+outerSpinWGSL(f)+`
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
  if(f.cutCells)groups??=await cutGroups(gpu,f,mobility,wall);
  const init=await gpu.kernel('CFD initial velocity and face flow',base+decl(0,'s','Cell',true)+decl(1,'flux','Flux',true)+
    (f.cutCells?decl(2,'mu','vec4f')+decl(3,'wall','vec4f'):'')+main(f.cutCells?`
    s[i]=far();let area=faceAreas(cellWidths(p));let relative=vec3f(U,0.,0.)-vec3f(0.,wall[i].yz);
    var hi=vec3f(0);var lo=vec3f(0);for(var a=0u;a<3u;a++){var l=p;l[a]--;var r=p;r[a]++;
      hi[a]=relative[a]*area[a]*select(1.,mu[i][a],inside(r));
      lo[a]=relative[a]*area[a]*select(1.,mu[bounded(l)][a],inside(l));}
    flux[i]=Flux(vec4f(hi,0),vec4f(lo,0));`:'s[i]=far();let q=vec4f(U*faceAreas(cellWidths(p)).x,0.,0.,0.);flux[i]=Flux(q,q);'));
  gpu.run(init,[s0,flux,...f.cutCells?[mobility,wall]:[]],grid,coords);
  const wallBindings=f.wallModeled?[force,loads,mobility]:[];
  const wallFunctions=f.wallModeled?wallResistanceWGSL+
    decl(5,'force','f32',true)+decl(6,'load','vec4f',true)+decl(7,'permeability','vec4f')+`
    fn wallIncrement(relative:vec3f,n:vec3f,d:f32,areaOverVolume:f32)->vec3f{
      let slip=tangentialSlip(relative,n);let rate=areaOverVolume*wallResistance(length(slip),d,NU);
      return (rate/(1.+rate))*slip;}`:'';
  const momentum=await gpu.kernel('CFD finite-volume momentum and SST transport',base+wallFunctions+
    decl(0,'s','Cell')+decl(1,'flux','Flux')+decl(2,'wall','vec4f')+decl(3,'out','Cell',true)+decl(4,'tail','Flux')+main(`
      let a=s[i];let solid=wall[i];let u=a.uk.xyz;let k=max(a.uk.w,1e-12);let omega=max(a.wt.x,1e-8);
      ${f.wallModeled?`if(permeability[i].w==0.){out[i]=Cell(vec4f(0.,solid.yz,1e-12),vec2f(60.*NU/(.075*.25),0.),vec2f(0));return;}`:''}
      let widths=cellWidths(p);let area=faceAreas(widths);let volume=area.x*widths.x;
      let groupRatio=${f.cutCells?'solid.w':'1.'};let share=${f.cutCells?'permeability[i].w/groupRatio':'1.'};
      ${f.wallModeled?'var cutArea=vec3f(0);var normalHint=vec3f(0);var sdfGradient=vec3f(0);':''}
      var adv=vec4f(0);var diff=vec3f(0);var grad:mat3x3f;var gk=vec3f(0);var gw=vec3f(0);
      ${f.sstWall?'var gradientCoverage=vec3f(0);':''}
      var advW=0.;var dk=0.;var dw=0.;var edk=0.;var edw=0.;
      ${f.faceHistory?'var transportDiagonal=0.;':''}
      for(var axis=0u;axis<3u;axis++){var e=vec3i(0);e[axis]=1;
        for(var side=-1;side<=1;side+=2){
          let j=p+side*e;var b=s[bounded(j)];let dir=f32(side);
          let faceFlow=select(flux[i].lo[axis]+tail[i].lo[axis],flux[i].hi[axis]+tail[i].hi[axis],side>0);
          let meshSpeed=${f.rotatingFrame&&!f.cutCells?'vec3f(0.,solid.yz)[axis]':'0.'};
          let q=(faceFlow-area[axis]*meshSpeed)*dir/(volume*groupRatio);
          var invD=1./widths[axis];if(inside(j)){invD=spacingInv(axis,p[axis],side);}
          if(!inside(j)){
            if(floorFace(axis,side)){b.uk=vec4f(vec3f(${f.movingRoad?'2.*U':'0.'},0.,0.)-u,k);b.wt=a.wt;}
            else if(!openFace(axis,side)||q<0.){b=far();}
          }
          var up=select(b.uk,a.uk,q>=0.);
          let behind=select(j+side*e,p-side*e,q>=0.);
          if(inside(j)&&inside(behind)${f.cutCells?'&&permeability[bounded(j)].w>0.&&permeability[bounded(behind)].w>0.&&permeability[bounded(min(behind,select(j,p,q>=0.)))][axis]>0.':''}){
            let upIndex=select(j[axis],p[axis],q>=0.);let backInv=axisMetric(axis,min(upIndex,behind[axis])).z;
            let back=(up-s[index(behind)].uk)*backInv;let forward=(select(a.uk,b.uk,q>=0.)-up)*invD;
            up+=.5*axisMetric(axis,upIndex).y*select(vec4f(0),sign(back)*min(abs(back),abs(forward)),back*forward>vec4f(0));}
          ${f.faceReconstruction?'if(inside(j)){up=vec4f(select(b.uk.xyz,a.uk.xyz,q>=0.),up.w);}':''}
          let explicitRate=${f.implicitRadiusM?'select(q,0.,outerFace(p,j))':'q'};
          adv+=explicitRate*up;advW+=explicitRate*select(b.wt.x,omega,q>=0.);
          let change=b.uk-a.uk;let nut=0.5*(a.wt.y+b.wt.y);
          var lap=invD/(widths[axis]*groupRatio);var gradWeight=.5*dir*invD;${f.sstWall?'var coverage=.5;':''}
          ${f.wallModeled?`if(inside(j)){let k=index(j);let open=permeability[select(k,i,side>0)][axis];
            let blocked=(1.-open)*area[axis];cutArea[axis]+=blocked;normalHint[axis]-=dir*blocked;
            sdfGradient[axis]+=gradWeight*(wall[k].x-solid.x);lap*=open;
            ${f.sstWall?'coverage*=open;gradWeight*=open;':''}
          }else if(floorFace(axis,side)){lap=0.;${f.sstWall?'coverage=0.;gradWeight=0.;':''}}`:''}
          ${f.sstWall?'gradientCoverage[axis]+=coverage;':''}
          diff+=(NU+nut)*lap*change.xyz;grad[axis]+=gradWeight*change.xyz;
          ${f.faceHistory?'transportDiagonal+=max(q,0.)+(NU+nut)*lap;':''}
          gk[axis]+=gradWeight*change.w;gw[axis]+=gradWeight*(b.wt.x-omega);
          dk+=lap*change.w;dw+=lap*(b.wt.x-omega);edk+=nut*lap*change.w;edw+=nut*lap*(b.wt.x-omega);
        }
      }
      ${f.sstWall?`for(var a=0u;a<3u;a++){let d=max(gradientCoverage[a],1e-20);grad[a]/=d;gk[a]/=d;gw[a]/=d;}`:''}
      var kn=share*K0;var wn=share*O0;var nut=0.;var strainLimit=0.;
      if(${!(f.sphere||f.laminar)}){
      let sym=0.5*(grad+transpose(grad));let ss=2.*(dot(sym[0],sym[0])+dot(sym[1],sym[1])+dot(sym[2],sym[2]));
      let dist=max(0.5,select(solid.x,min(solid.x,axisMetric(1u,p.y).x),${f.name==='ahmed'||!!f.movingRoad}));
      let cd=max(2.*0.856*dot(gk,gw)/omega,1e-14);
      let a1=sqrt(k)/(0.09*omega*dist);let a2=500.*NU/(dist*dist*omega);
      let f1=tanh(pow(min(10.,min(max(a1,a2),4.*0.856*k/(cd*dist*dist))),4.));
      let f2=tanh(pow(min(10.,max(2.*a1,a2)),2.));
      let prod=min(a.wt.y*ss,10.*0.09*k*omega);
      let beta=mix(0.0828,0.075,f1);let gamma=mix(0.44,5./9.,f1);
      kn=(share*(k+prod)-adv.w+NU*dk+mix(1.,0.85,f1)*edk)/(1.+0.09*omega);
      wn=(share*omega-advW+NU*dw+mix(0.856,0.5,f1)*edw+share*(gamma*select(0.,prod/max(a.wt.y,1e-10),a.wt.y>0.)+
        (1.-f1)*2.*0.856*dot(gk,gw)/omega))/(1.+beta*omega);
      let damping=1.-exp(-${10*cref}*${f.cutCells?'(1.-smoothstep(-.7,.7,solid.x))':'solid.w'});
      ${f.cutCells?`nut=share*${f.sstWall?'(prod/(1.+.09*omega))':'damping'};strainLimit=share*sqrt(ss)*f2;`:`
      kn=mix(max(1e-12,kn),1e-12,damping);wn=mix(max(1e-8,wn),60.*NU/(0.075*0.25),damping);
      nut=0.31*kn/max(0.31*wn,sqrt(ss)*f2);`}}
      var tentative=share*u-adv.xyz+diff;
      ${f.rotatingFrame?`let transverse=tentative.yz;
        tentative.y=${Math.cos(f.omega*dt)}*transverse.x+${Math.sin(f.omega*dt)}*transverse.y;
        tentative.z=${-Math.sin(f.omega*dt)}*transverse.x+${Math.cos(f.omega*dt)}*transverse.y;`:''}
      if(${f.rotor}){
        let domain=cellCenters(DIMS-1)+.5*cellWidths(DIMS-1);let x=cellCenters(p);
        let depth=min(x,domain-x)/domain;let edge=1.-smoothstep(0.,0.11,min(depth.x,min(depth.y,depth.z)));
        let reservoir=1.-exp(-${cref}*edge);tentative=mix(tentative,share*vec3f(U,0.,0.),reservoir);
        kn=mix(kn,share*K0,reservoir);wn=mix(wn,share*O0,reservoir);}
      ${f.wallModeled?`
      if(permeability[i].w>0.){
        if(any(cutArea>vec3f(0))){
          let gradient=select(normalHint,sdfGradient,length(sdfGradient)>1e-6);
          let n=gradient/max(length(gradient),1e-12);
          let height=max(0.,solid.x);let normalPitch=1./max(length(n/widths),1e-8);
          let arm=vec3f(${f.origin.map(v=>v.toFixed(8)).join(',')})+(cellCenters(p)-height*n)*${f.h};
          let movingWall=${f.rotor?`vec3f(0.,-arm.z,arm.y)*${f.omega*dt/f.h}`:'vec3f(0)'};
          let reaction=wallIncrement(${f.cutCells?'u':'tentative'}-movingWall,n,max(height,.5*normalPitch),
            ${f.cutCells?'length(normalHint)':'dot(cutArea,abs(n))'}/(volume*groupRatio));
          tentative-=reaction;force[i]+=volume*groupRatio*reaction.x;load[i]+=volume*groupRatio*vec4f(0.,cross(arm,reaction).x,reaction.yz);
        }
        if(p.y==0&&floorFace(1u,-1)){
          let road=vec3f(${f.movingRoad?'U':'0.'},0.,0.);
          tentative-=wallIncrement(${f.cutCells?'u':'tentative'}-road,vec3f(0,1,0),.5*widths.y,1./(widths.y*groupRatio));
        }
      }`:''}
      out[i]=Cell(vec4f(tentative,kn),vec2f(wn,nut),vec2f(${f.faceHistory?'transportDiagonal':'0.'},strainLimit));`));
  const pressureRhs=decl(0,'s','Cell')+decl(1,'wall','vec4f')+decl(2,'mu','vec4f')+immersedFaceWGSL+`
    fn body(i:u32)->vec3f{return vec3f(0.,wall[i].yz);}
    fn face(i:u32,p:vec3i,axis:u32,side:i32)->vec3f{var e=vec3i(0);e[axis]=side;let j=p+e;
      if(inside(j)){let other=index(j);let owner=select(other,i,side>0);let right=select(i,other,side>0);
        ${f.axes?`let m=axisMetric(axis,min(p[axis],j[axis]));let v=mix(s[owner].uk[axis],s[right].uk[axis],.5*m.y*m.z);`:'let v=.5*(s[owner].uk[axis]+s[right].uk[axis]);'}
        return ${f.cutCells?'vec3f(v-body(owner)[axis],0.,mu[owner][axis])':'vec3f(v,body(owner)[axis],mu[owner][axis])'};}
      var v=s[i].uk[axis];if(!openFace(axis,side)){v=select(0.,U,axis==0u);}return vec3f(v${f.cutCells?'-body(i)[axis]':''},0.,1.);}`;
  const rhs=await gpu.kernel('CFD immersed flux imbalance',base+pressureRhs+decl(3,'b','f32',true)+main(`
    let area=faceAreas(cellWidths(p));var div=0.;for(var a=0u;a<3u;a++){let hi=face(i,p,a,1);let lo=face(i,p,a,-1);
      div+=area[a]*(projectFace(hi.x,hi.y,hi.z,0.).x-projectFace(lo.x,lo.y,lo.z,0.).x);}b[i]=-div;`));
  const project=await gpu.kernel('CFD coupled wall and pressure projection',base+pressureRhs+decl(3,'pressure','f32')+
    decl(4,'out','Cell',true)+decl(5,'flux','Flux',true)+decl(6,'force','f32',true)+decl(7,'load','vec4f',true)+main(`
    let pi=pressure[i];var t=s[i];var hi=vec3f(0);var lo=vec3f(0);var rawAverage=vec3f(0);
    var impulse=vec3f(0.);var pressureDrag=0.;let widths=cellWidths(p);let area=faceAreas(widths);let volume=widths.x*area.x;
    ${f.wallModeled?'var velocityCorrection=vec3f(0);':''}
    for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
      var e=vec3i(0);e[a]=side;let j=p+e;var delta=0.;
      if(inside(j)){delta=(pressure[index(j)]-pi)*spacingInv(a,p[a],side);}else if(openFace(a,side)){delta=-2.*pi/widths[a];}
      let slope=f32(side)*delta;let data=face(i,p,a,side);let q=projectFace(data.x,data.y,data.z,slope);
      if(side>0){hi[a]=q.x;}else{lo[a]=q.x;}rawAverage[a]+=0.5*data.x;
      ${f.wallModeled?`velocityCorrection[a]-=.5*data.z*slope;
        if(inside(j)&&mu[i].w>0.){impulse[a]+=f32(side)*pi*(1.-data.z)/widths[a];}`:
        'impulse[a]+=0.5*q.y;if(a==0u){pressureDrag-=0.5*(1.-data.z)*slope;}'}
    }}
    ${f.wallModeled?`
    // On an impermeable physical face the Neumann pressure equals the fluid
    // cell pressure. Its traction acts on the body. Its prescribed mass flow
    // already enters the RHS, so it supplies no additional momentum penalty.
    ${f.cutCells?`if(mu[i].w>0.){let weight=mu[i].w/wall[i].w;t.uk=weight*t.uk+vec4f(velocityCorrection/wall[i].w,0.);t.wt*=weight;}`:
      't.uk=vec4f(t.uk.xyz+velocityCorrection,t.uk.w);'}pressureDrag=impulse.x;`:`
    // The cell-to-face average loses a subcell velocity component. Fluid keeps
    // that component. Any part removed inside the solid acts on the body.
    let subcell=t.uk.xyz-rawAverage;let fluidFraction=mu[i].w;
    impulse+=(1.-fluidFraction)*subcell;
    t.uk=vec4f(0.5*(hi+lo)+fluidFraction*subcell,t.uk.w);`}
    let arm=vec3f(${f.origin.map(v=>v.toFixed(8)).join(',')})+cellCenters(p)*${f.h};
    out[i]=t;flux[i]=Flux(vec4f(hi*area,0),vec4f(lo*area,0));force[i]+=volume*impulse.x;
    load[i]+=volume*vec4f(pressureDrag,cross(arm,impulse).x,impulse.yz);`));
  const m=gpu.bind(momentum,[s0,flux,wall,pred,fluxTail,...wallBindings],coords),r=gpu.bind(rhs,[pred,wall,mobility,mg.rhs],coords),c=gpu.bind(project,[pred,wall,mobility,mg.p,s0,flux,force,loads],coords);
  // Refine against the fluxes actually stored in FP32. The smaller correction
  // retains its own word on each face and participates in the next advection.
  const basePressure=gpu.buffer('CFD pressure before flux refinement',4*count);
  const imbalance=await gpu.kernel('CFD stored flux defect',base+faceBalanceWGSL+decl(0,'flux','Flux')+decl(1,'b','f32',true)+decl(2,'tail','Flux')+
    main('b[i]=-(faceBalance(flux[i].hi.xyz,flux[i].lo.xyz)+faceBalance(tail[i].hi.xyz,tail[i].lo.xyz));'));
  const residualGroup=gpu.bind(imbalance,[flux,mg.rhs,fluxTail]);
  const refineFlux=await gpu.kernel('CFD apply low-amplitude flux and pressure reaction',base+addFlowWGSL+decl(0,'mu','vec4f')+decl(1,'pressure','f32')+
    decl(2,'tail','Flux',true)+decl(3,'s','Cell',true)+decl(4,'force','f32',true)+decl(5,'load','vec4f',true)+decl(6,'primary','Flux',true)+(f.cutCells?decl(7,'wall','vec4f'):'')+main(`
      let pi=pressure[i];var hi=vec3f(0);var lo=vec3f(0);var impulse=vec3f(0);let widths=cellWidths(p);let area=faceAreas(widths);
      for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){var e=vec3i(0);e[a]=side;let j=p+e;var slope=0.;var weight=1.;
        if(inside(j)){let k=index(j);weight=mu[select(k,i,side>0)][a];slope=f32(side)*(pressure[k]-pi)*spacingInv(a,p[a],side);}
        else if(openFace(a,side)){slope=-2.*f32(side)*pi/widths[a];}
        let extra=-weight*slope;if(side>0){hi[a]=extra;}else{lo[a]=extra;}
        ${f.wallModeled?'if(inside(j)&&mu[i].w>0.){impulse[a]+=f32(side)*pi*(1.-weight)/widths[a];}':'impulse[a]-=.5*(1.-weight)*slope;'}
      }}
      for(var a=0u;a<3u;a++){
        let plus=addFlow(primary[i].hi[a],tail[i].hi[a],hi[a]*area[a]);let minus=addFlow(primary[i].lo[a],tail[i].lo[a],lo[a]*area[a]);
        primary[i].hi[a]=plus.x;tail[i].hi[a]=plus.y;primary[i].lo[a]=minus.x;tail[i].lo[a]=minus.y;
      }s[i].uk=vec4f(s[i].uk.xyz+.5*(hi+lo)${f.cutCells?'/max(wall[i].w,1e-30)':''},s[i].uk.w);
      let arm=vec3f(${f.origin.map(v=>v.toFixed(8)).join(',')})+cellCenters(p)*${f.h};
      let volume=widths.x*area.x;force[i]+=volume*impulse.x;load[i]+=volume*vec4f(impulse.x,cross(arm,impulse).x,impulse.yz);`));
  const refineGroup=gpu.bind(refineFlux,[mobility,mg.p,fluxTail,s0,force,loads,flux,...f.cutCells?[wall]:[]],coords);
  const accumulate=await gpu.kernel('CFD accumulate physical pressure',decl(0,'first','f32')+decl(1,'p','f32',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u){let i=gid.x;if(i<arrayLength(&p)){p[i]+=first[i];}}`);
  const pressureGroup=gpu.bind(accumulate,[basePressure,mg.p]);
  const [nx,ny,nz]=f.dims,plane=gpu.buffer('CFD time-mean symmetry plane',nx*ny*4);
  const sample=await gpu.kernel('CFD sample planar velocity',decl(0,'s','vec4f')+decl(1,'plane','f32',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i<arrayLength(&plane)){
      let a=(i+${nx*ny*(nz/2-1)}u)*2u;plane[i]+=0.5*(s[a].x+s[a+${nx*ny*2}u].x);}}`);
  const sb=gpu.bind(sample,[s0,plane]);
  const peak=gpu.buffer('CFD maximum stored mass defect',4),stage=gpu.staging('CFD single residual value',4);
  const norm=await gpu.kernel('CFD stored volume flux convergence',base+faceBalanceWGSL+decl(0,'flux','Flux')+decl(1,'tail','Flux')+(f.cutCells?decl(3,'mu','vec4f'):'')+`
    @group(0) @binding(2) var<storage,read_write> globalMax:atomic<u32>;
    var<workgroup> lanes:array<u32,128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_index) j:u32){
      let i=gid.x;var q=0.;if(i<CELLS){let w=cellWidths(point(i));
        q=abs(faceBalance(flux[i].hi.xyz,flux[i].lo.xyz)+faceBalance(tail[i].hi.xyz,tail[i].lo.xyz))/(w.x*w.y*w.z${f.cutCells?'*max(mu[i].w,1e-30)':''});}
      lanes[j]=bitcast<u32>(q);for(var stride=64u;stride>0u;stride/=2u){
        workgroupBarrier();if(j<stride){lanes[j]=max(lanes[j],lanes[j+stride]);}}
      if(j==0u){atomicMax(&globalMax,lanes[0]);}}`);
  const normGroup=gpu.bind(norm,[flux,fluxTail,peak,...f.cutCells?[mobility]:[]],coords);
  const phase=(kind,encode)=>({kind,encode});
  const mergePred=groups?[phase('combine predicted cut-cell momentum',groups.merge(pred))]:[];
  if(f.faceReconstruction){
    const transport=await cutFaceTransport(gpu,f,dt,s0,pred,mobility,centers,wall,flux,fluxTail);
    mergePred.unshift(phase('open velocity gradients',transport.reconstruct),phase('shared momentum transfer',transport.transfer),
      phase('accumulate shared momentum',transport.apply));
  }
  if(f.sstWall){
    mergePred.push(phase('merged SST wall function',await mergedSstWall(gpu,f,dt,groups,wall,mobility,s0,pred)));
  }else if(groups){
    // Internal transport cancels only after the extensive partial increments
    // have been added. Clipping each sliver separately would create turbulent
    // energy even for a uniform field passing through a merged volume.
    const turbulence=await gpu.kernel('CFD turbulence in merged fluid volumes',base+decl(0,'s','Cell',true)+decl(1,'mu','vec4f')+main(`
      if(mu[i].w==0.){return;}var t=s[i];let damping=clamp(t.wt.y,0.,1.);
      let k=mix(max(1e-12,t.uk.w),1e-12,damping);
      let omega=mix(max(1e-8,t.wt.x),60.*NU/(.075*.25),damping);
      t.uk.w=k;t.wt=vec2f(omega,.31*k/max(.31*omega,t.padding.y));s[i]=t;`));
    const group=gpu.bind(turbulence,[pred,mobility]);mergePred.push(phase('merged SST state',e=>gpu.dispatch(e,turbulence,group,grid)));
  }
  const mergeState=groups?[phase('combine projected cut-cell momentum',groups.merge(s0))]:[];
  if(f.linearWallPressure){
    if(!centers||!groups)throw Error('Linear pressure traction requires physical cut-face centroids');
    const linear=await linearCutPressure(gpu,f,mobility,centers,wall,mg.p,s0,force,loads);
    mergeState.unshift(phase('integrate linear wall pressure',linear));
  }
  const spin=f.rotatingFrame?await rotatingLoads(gpu,loads):null;
  if(spin)mergeState.push(phase('integrate fixed-frame transverse reaction',spin.encode));
  const outer=f.implicitRadiusM?await outerTransport(gpu,f,dt,pred,flux,fluxTail):null;
  const predictMomentum=phase('momentum',e=>gpu.dispatch(e,momentum,m,grid));
  let predictStored,prepareStored;
  if(f.faceHistory){
    // Interpolate momentum increments onto the previous corrected face. The
    // transport diagonal relaxes the old face/cell difference on a physical
    // advection/viscosity timescale. Re-interpolating the whole velocity at
    // each time step would make this dissipation proportional to 1/dt.
    const predict=await gpu.kernel('CFD transient face momentum interpolation',base+addFlowWGSL+
      decl(0,'old','Cell')+decl(1,'pred','Cell')+decl(2,'mu','vec4f')+decl(3,'wall','vec4f')+
      decl(4,'primary','Flux',true)+decl(5,'tail','Flux',true)+main(`
      let area=faceAreas(cellWidths(p));
      for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
        var q=p;q[a]+=side;let j=bounded(q);let l=select(j,i,side>0);let r=select(i,j,side>0);
        let insideFace=inside(q);let w=select(1.,mu[l][a],insideFace);
        let m=axisMetric(a,min(p[a],max(0,q[a])));let t=.5*m.y*m.z;
        let un=old[l].uk[a];let vn=old[r].uk[a];
        let moving=vec3f(0.,wall[l].yz)[a];let u=mix(un,vn,t);
        var reference=area[a]*${f.cutCells?'w*(u-moving)':'mix(moving,u,w)'};
        var change=w*area[a]*mix(pred[l].uk[a]-un,pred[r].uk[a]-vn,t);
        let diag=mix(pred[l].padding.x,pred[r].padding.x,t);let relax=diag/(1.+diag);
        if(!insideFace&&!openFace(a,side)){reference=area[a]*select(0.,U,a==0u);change=0.;}
        let high=select(primary[i].lo[a],primary[i].hi[a],side>0);
        let low=select(tail[i].lo[a],tail[i].hi[a],side>0);
        let v=addFlow(high,low,change-relax*((high-reference)+low));
        if(side>0){primary[i].hi[a]=v.x;tail[i].hi[a]=v.y;}
        else{primary[i].lo[a]=v.x;tail[i].lo[a]=v.y;}
      }}`));
    const bind=gpu.bind(predict,[s0,pred,mobility,wall,flux,fluxTail],coords);
    predictStored=e=>{gpu.dispatch(e,predict,bind,grid);gpu.dispatch(e,imbalance,residualGroup,grid);};
    if(f.cutCells){
      const weight=await gpu.kernel('CFD predicted momentum per merged volume',base+decl(0,'pred','Cell')+decl(1,'out','Cell',true)+
        decl(2,'mu','vec4f')+decl(3,'wall','vec4f')+main(`var t=pred[i];if(mu[i].w>0.){let s=mu[i].w/wall[i].w;t.uk*=s;t.wt*=s;}out[i]=t;`));
      const group=gpu.bind(weight,[pred,s0,mobility,wall]);
      prepareStored=e=>gpu.dispatch(e,weight,group,grid);
    }else prepareStored=e=>e.copyBufferToBuffer(pred,0,s0,0,pred.size);
  }
  function projection(n){
    if(mg.refine.prepareStages)return [phase('V-cycle',mg.solve),...mg.refine.prepareStages,
      ...Array.from({length:n-1},()=>mg.refine.innerStages).flat(),...mg.refine.lastStages];
    return [phase('V-cycle',mg.solve),phase('Krylov start',mg.refine.prepare),
      ...Array.from({length:n},(_,i)=>phase('Krylov iteration',e=>mg.refine.iterate(e,i+1===n)))];
  }
  const forecast=[false,true].map(cold=>[
    ...(cold||(f.rotor&&!f.rotatingFrame)?[phase('geometry coarsening',mg.updateGeometry)]:[]),
    ...outer?[]:[predictMomentum],...mergePred,
    phase('flux imbalance',!cold&&predictStored?predictStored:e=>gpu.dispatch(e,rhs,r,grid)),
    ...projection(f.globalPressure?(cold?16:f.rotor?5:3):(cold?24:f.rotor?10:6)),
    phase('pressure reaction',!cold&&prepareStored?e=>{prepareStored(e);gpu.dispatch(e,refineFlux,refineGroup,grid);}:
      e=>{gpu.dispatch(e,project,c,grid);e.clearBuffer(fluxTail);})
  ]);
  function refinement(n){
    return [phase('stored flux defect',e=>{e.copyBufferToBuffer(mg.p,0,basePressure,0,4*count);
      e.clearBuffer(mg.p);gpu.dispatch(e,imbalance,residualGroup,grid);}),
      ...(n?projection(n):[phase('local pressure relaxation',mg.polish)]),
      phase('flux correction',e=>{gpu.dispatch(e,refineFlux,refineGroup,grid);gpu.dispatch(e,accumulate,pressureGroup,grid);})];
  }
  const check=phase('verify volume flow',e=>{e.clearBuffer(peak);gpu.dispatch(e,norm,normGroup,grid);e.copyBufferToBuffer(peak,0,stage,0,4);});
  const samplePlane=phase('sample wake',e=>gpu.dispatch(e,sample,sb,[Math.ceil(nx*ny/128)]));
  const fixed=refinement(f.axes?18:24),first=refinement(f.globalPressure?8:12),extra=refinement(f.globalPressure?8:18);
  const krylovRestarts=[extra,refinement(24),refinement(48),refinement(96)];
  const local=refinement(0),target=7e-7*Math.min(1,f.period);
  const stats={steps:0,additionalPasses:0,localPasses:0,maximumPasses:0,maxRelativeDivergence:0,maxDivergencePerS:0,
    missedSteps:0,initialDefectHistory:[],primaryChecks:0,acceptedPrimary:0,longRestarts:0};
  let checkPrimaryAt=1;
  async function measure(){
    await stage.mapAsync(GPUMapMode.READ);
    try{return new Float32Array(stage.getMappedRange())[0]*f.period/dt;}finally{stage.unmap();}
  }
  stats.exactBoundaryBlocks=mg.cutBlocks;
  return {state:s0,pressure:mg.p,flux,fluxTail,plane,loads,transverseImpulse:spin?.sums,outerTransport:outer?.stats,mobility,fluxConvergence:stats,
    async advance(i,sampling,scheduler,assertCurrent){
      spin?.angle(f.omega*(i+.5)*dt);
      if(outer){await scheduler.perform([predictMomentum],assertCurrent);await outer.solve(scheduler,assertCurrent);}
      const checkPrimary=f.faceHistory&&i>=checkPrimaryAt;
      await scheduler.perform([...forecast[Number(i===0)],...checkPrimary?[]:first,check],assertCurrent);
      let maximum=await measure(),passes=checkPrimary?0:1;
      if(checkPrimary){
        stats.primaryChecks++;
        if(maximum<=target)stats.acceptedPrimary++;
        else checkPrimaryAt=i+64;
      }
      if(i===0)stats.initialDefectHistory.push(maximum);
      let allowLocal=!!f.cutCells,restart=0;
      while(maximum>target&&passes<16){
        const useLocal=allowLocal&&passes>0&&(maximum<=256*target||passes===1);
        const before=maximum;
        const correction=useLocal?local:passes===0?first:krylovRestarts[restart];
        if(!useLocal&&restart>0)stats.longRestarts++;
        await scheduler.perform([...correction,check],assertCurrent);maximum=await measure();passes++;
        if(useLocal){stats.localPasses++;allowLocal=maximum<.35*before;}
        else{
          allowLocal=!!f.cutCells;
          if(maximum>.05*before)restart=Math.min(krylovRestarts.length-1,restart+1);
          else if(maximum<.001*before)restart=0;
        }
        if(i===0)stats.initialDefectHistory.push(maximum);
      }
      if(!Number.isFinite(maximum))throw Error('Nonfinite residual in the stored CFD volume flows');
      stats.steps++;stats.additionalPasses+=Math.max(0,passes-1);stats.maximumPasses=Math.max(stats.maximumPasses,passes);
      stats.maxRelativeDivergence=Math.max(stats.maxRelativeDivergence,maximum);
      stats.maxDivergencePerS=Math.max(stats.maxDivergencePerS,maximum/f.period);
      if(maximum>=1e-6||maximum/f.period>=1e-6)stats.missedSteps++;
      if(mergeState.length||sampling)await scheduler.perform([...mergeState,...sampling?[samplePlane]:[]],assertCurrent);
    },
    step(i,sampling){
      if(outer)throw Error('Implicit outer transport requires the residual-controlled advance');
      spin?.angle(f.omega*(i+.5)*dt);
      const e=gpu.device.createCommandEncoder();for(const op of forecast[Number(i===0)])op.encode(e);
      for(let k=0;k<(f.axes?2:1);k++)for(const op of fixed)op.encode(e);
      for(const op of mergeState)op.encode(e);if(sampling)samplePlane.encode(e);gpu.device.queue.submit([e.finish()]);
    }};
}
