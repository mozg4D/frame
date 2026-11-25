import test from 'node:test';
import assert from 'node:assert/strict';
import {blockBasis} from './m0/blocks.mjs';
import {schurGeometry} from './m0/schur.mjs';
import {verifyShape,verifyGoalRefinement} from './m0/shape.mjs';
import {winningBackend} from './m0/pressure.mjs';
import {verifyThinWalls} from './m0/graph-checks.mjs';
import {crossesMetric} from './m0/metric.mjs';
import {momentShell} from './m0/mr-lbm.mjs';
import {scoreContests,settledPeriods} from './m0/flow.mjs';
import {faceOwners} from './m0/graph-weights.mjs';
import {bladeStation,rotorParts} from './m0/rotor.mjs';
import {axialTrackRate} from './m0/rigid-spin.mjs';
import {boxMetric} from './m0/native-geometry.mjs';
import {mediumProperties} from './m0/fluid.mjs';
import {gradedAxis,surfaceGradedAxis,rectilinearDomain,cellCenter,cellWidth} from './m0/rectilinear.mjs';
import {pressureAxis} from './m0/separable-pressure.mjs';
import {coarseGraphInverse} from './m0/graph-pressure.mjs';
import {ahmedMesh} from './m0/ahmed.mjs';
import {cutBlockInverse} from './m0/cut-block-factor.mjs';
test('native rotor components are closed and the shaft bore retains its design volume',()=>{
  const parts=rotorParts(),volumes=[];
  for(const {vertices:v,indices:t} of parts){
    const incidence=new Map();let volume=0;
    for(let k=0;k<t.length;k+=3){
      const ids=t.subarray(k,k+3),[a,b,c]=Array.from(ids,i=>v.subarray(3*i,3*i+3));
      volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
      for(let j=0;j<3;j++){
        const start=ids[j],end=ids[(j+1)%3],key=[Math.min(start,end),Math.max(start,end)].join('/');
        const row=incidence.get(key)??[0,0];row[0]++;row[1]+=Math.sign(end-start);incidence.set(key,row);
      }
    }
    assert.ok([...incidence.values()].every(([n,sign])=>n===2&&sign===0));assert.ok(volume>0);volumes.push(volume);
  }
  assert.ok(Math.abs(volumes[0]/volumes[1]-1)<1e-7);
  assert.ok(Math.abs(volumes[2]/(Math.PI*(.01016**2-.003175**2)*.01016)-1)<.001);
});
test('unwrapped axial rates distinguish multiple full turns between native frames',()=>{
  const keys=[0,6,12].map(t=>[t,{v:[5011*t/10,0,0],interp:'hard',axes:[0,1,2]}]);
  assert.ok(Math.abs(axialTrackRate({keys},60).omega*60/(2*Math.PI)-5011)<1e-9);
  assert.equal(axialTrackRate({keys:keys.map(([t,k])=>[t,{...k,axes:[0]}])},60).omega,axialTrackRate({keys},60).omega);
  assert.equal(axialTrackRate({keys:[keys[0],[6,{...keys[1][1],interp:'soft'}]]},60),null);
  assert.equal(axialTrackRate({keys:[keys[0],keys[1],[12,{v:[3100,0,0]}]]},60),null);
});
test('cut-brick inverse resolves a weakly connected fluid region and preserves pressure differences in a sealed pocket',()=>{
  const rows=new Float32Array(256),p=Float64Array.from({length:64},(_,i)=>Math.sin(i*.65)),rhs=new Float64Array(64),diag=new Float64Array(64);
  for(let i=0;i<64;i++){
    const x=i%4,y=(i>>2)%4,z=i>>4;const sealed=x>=2&&y>=2&&z>=2;
    for(const [a,coord] of [x,y,z].entries()){
      if(coord===3)continue;const next=[x,y,z];next[a]++;
      if(next.every(v=>v>=2)!==sealed)continue;
      rows[4*i+a]=a===1&&y===1?1e-3:1+.01*(i+a);
    }
    if(x===0)rows[4*i+3]=1;
  }
  for(let i=0;i<64;i++){
    diag[i]+=rows[4*i+3];rhs[i]+=rows[4*i+3]*p[i];
    for(const [a,step] of [1,4,16].entries()){
      const c=rows[4*i+a];if(!c)continue;const j=i+step;diag[i]+=c;diag[j]+=c;
      const q=c*(p[i]-p[j]);rhs[i]+=q;rhs[j]-=q;
    }
  }
  const inv=cutBlockInverse(rows),s=diag.map(d=>Math.sqrt(6/d));
  const recovered=p.map((_,i)=>s[i]*rhs.reduce((sum,r,j)=>sum+inv[64*i+j]*s[j]*r,0));
  for(let i=0;i<64;i++){
    const x=i%4,y=(i>>2)%4,z=i>>4;
    assert.ok(Math.abs(recovered[i]-(p[i]-(x>=2&&y>=2&&z>=2?p[42]:0)))<1e-5);
  }
});
test('surface-focused axes preserve the box extent and refine both geometric extrema',()=>{
  const axis=surfaceGradedAxis(-2,4,-.2,2,0,1,.04,.01),widths=axis.slice(1).map((v,i)=>v-axis[i]);
  const pitch=x=>widths[axis.findIndex((v,i)=>i>0&&v>=x)-1];
  assert.equal(axis[0],-2);assert.equal(axis.at(-1),4);assert.equal(widths.length%8,0);
  assert.ok(widths.every(v=>v>0));assert.ok(pitch(0)<.012&&pitch(1)<.012&&pitch(.5)>.035);
  assert.ok(widths.every((v,i)=>!i||Math.max(v/widths[i-1],widths[i-1]/v)<1.2));
});
test('authored Ahmed polygons enclose the analytic nose, body and slant with outward winding',()=>{
  const {vertices:v,indices:t}=ahmedMesh(),edges=new Map();let volume=0;
  for(let k=0;k<t.length;k+=3){
    const ids=t.slice(k,k+3),[a,b,c]=ids.map(i=>v.slice(3*i,3*i+3));
    volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for(let j=0;j<3;j++){
      const i=ids[j],h=ids[(j+1)%3],key=[Math.min(i,h),Math.max(i,h)].join('/');
      edges.set(key,(edges.get(key)??0)+Math.sign(h-i));}
  }
  const radius=100,angle=25*Math.PI/180,nose=4*radius*(44*94.5+(44+94.5)*radius*Math.PI/4+2*radius**2/3);
  const expected=nose+(1044-radius)*288*389-.5*389*222**2*Math.cos(angle)*Math.sin(angle);
  assert.ok([...edges.values()].every(x=>x===0));assert.ok(Math.abs(volume/expected-1)<.0001);
});
test('the coarse graph inverse solves an irregular grounded resistance network',()=>{
  const l={offset:[0,2,4,7,8],nbr:[1,2,0,2,0,1,3,2],c:[1,.2,1,3,.2,3,.04,.04],diag:[1.9,4,3.24,.04],boundary:[.7,0,0,0]};
  const inv=coarseGraphInverse(l);
  for(let col=0;col<4;col++)for(let i=0;i<4;i++){
    const v=inv[4*i+col];let row=l.boundary[i]*v;
    for(let e=l.offset[i];e<l.offset[i+1];e++)row+=l.c[e]*(v-inv[4*l.nbr[e]+col]);
    assert.ok(Math.abs(row-Number(i===col))<5e-6);assert.equal(v,inv[4*col+i]);
  }
});
test('whole-domain pressure modes satisfy the variable-width boundary stencil and mass normalization',()=>{
  const w=[.35,.5,.8,1,1.2,1.9,3,4];
  for(const [left,right] of [[true,false],[false,false],[true,true]]){
    const {eig,forward,backward}=pressureAxis(w,left,right),n=w.length;
    assert.equal(eig[0]===0,!left&&!right);
    for(let k=0;k<n;k++){
      let norm=0;
      for(let i=0;i<n;i++){
        const v=backward[n*i+k];norm+=v*v*w[i];assert.equal(v,forward[n*k+i]);
        let lap=i?2*(v-backward[n*(i-1)+k])/(w[i-1]+w[i]):left?2*v/w[i]:0;
        lap+=i+1<n?2*(v-backward[n*(i+1)+k])/(w[i+1]+w[i]):right?2*v/w[i]:0;
        assert.ok(Math.abs(lap-eig[k]*w[i]*v)<2e-6);
      }assert.ok(Math.abs(norm-1)<1e-6);
    }
  }
});
test('graded orthogonal cells partition the same domain and integrate a linear pressure gradient',()=>{
  const f={dims:[80,40,40],h:.01,origin:[-.2,-.2,-.2]};
  const m=rectilinearDomain(f,{min:[0,-.03,-.08],max:[.07,.04,.08]},[.004,.003,.006],350000);
  assert.ok(m.dims.every(d=>d%8===0)&&m.dims.reduce((a,b)=>a*b)<=350000);
  let domainVolume=1;
  for(const [k,axis] of m.axes.entries()){
    assert.equal(axis[0],f.origin[k]);assert.equal(axis.at(-1),f.origin[k]+f.dims[k]*f.h);
    let length=0,previous=null;
    for(let i=0;i+1<axis.length;i++){
      const w=cellWidth(m,k,i)*m.h;assert.ok(w>0);
      if(previous)assert.ok(Math.max(w/previous,previous/w)<Math.exp(.16)+1e-12);
      if(i+2<axis.length){
        const x=cellCenter(m,k,i),next=cellCenter(m,k,i+1),right=axis[i+2]-axis[i+1];
        assert.ok(Math.abs((next-x)-.5*(w+right))<1e-14);
        const atFace=(right*x+w*next)/(w+right);assert.ok(Math.abs(atFace-axis[i+1])<1e-14);
      }
      previous=w;length+=w;
    }domainVolume*=length;
  }
  assert.ok(Math.abs(domainVolume-.128)<1e-12);
  assert.throws(()=>gradedAxis(0,1,0,1,0));
});
test('scene air uses geometric elevation and water uses its own material properties',()=>{
  const sea=mediumProperties('Air',0),tropopause=mediumProperties('Air',11019.1),water=mediumProperties('Water',8800);
  assert.ok(Math.abs(sea.rho-1.225)<.0001&&Math.abs(sea.nu-1.46e-5)<1e-7);
  assert.ok(Math.abs(tropopause.temperatureK-216.65)<.01&&Math.abs(tropopause.pressurePa-22632)<2);
  assert.ok(water.rho>998&&water.nu>1e-6&&water.nu<1.01e-6);
  assert.equal(mediumProperties('Air',100000).atmosphereInRange,false);
});
test('a slowly drifting force or developing wake cannot stop a native flow study',()=>{
  const trace=Array.from({length:10},(_,i)=>({coefficient:1-.005*i,wakeLengthM:1}));
  assert.equal(settledPeriods(trace),false);
  trace.forEach((w,i)=>{w.coefficient=1;w.wakeLengthM=.1+i*.01;});assert.equal(settledPeriods(trace,true),false);
  trace.forEach(w=>{w.wakeLengthM=.18;});assert.equal(settledPeriods(trace,true),true);
});
test('physical mesh lengths preserve owner shear, nonuniform scale and reflections in SI',()=>{
  const axes=[0,2,0,0, -3,.5,0,0, -1,0,-4,0, 100,-200,800,1];
  const frame=boxMetric(axes),source=[3,-4,5];
  const delta=(m,i)=>source.reduce((v,a,k)=>v+m[4*k+i]*a,0);
  assert.ok(Math.abs(Math.hypot(...[0,1,2].map(i=>delta(frame,i)))-.001*Math.hypot(...[0,1,2].map(i=>delta(axes,i))))<1e-14);
  assert.ok(Math.abs(frame[0]-.002)<1e-14&&frame[10]<0);
  assert.ok(Math.abs(frame[1])+Math.abs(frame[9])<1e-14);
  assert.deepEqual(frame.slice(12),[0,0,0,1]);
  assert.throws(()=>boxMetric(new Array(16).fill(0)),/Degenerate/);
});
test('APC design stations reproduce the independently tabulated projected blade area',()=>{
  let area=0;const strips=2048;
  for(let i=0;i<strips;i++){
    const s=bladeStation((i+.5)/strips);area+=2*.127/strips*s.chord*Math.cos(s.twist);
  }
  assert.ok(Math.abs(area/(6.8742*.0254**2)-1)<.005);
  assert.equal(bladeStation(.22).blend,0);assert.equal(bladeStation(.732).blend,1);
  assert.ok(bladeStation(.75).thickness<.11);
});
test('a shared staggered face projects a circulation in the inverse-conductance norm',()=>{
  // Three fluid cells form a cycle; the last two incidences are a sealed sheet.
  const graph={offset:[0,3,5,8],linkFace:[0,~2,3,~0,1,~1,2,~3],nbr:[1,2,0,0,2,1,0,2],kind:[0,0,7,0,0,0,0,7]};
  assert.deepEqual([...faceOwners(graph,4)],[0,1,1,2,2,0,0,7<<28]);
  const c=[2,3,7],circulation=1,p=[.25,-.8,0];
  const incidence=(q,i)=>graph.linkFace.slice(graph.offset[i],graph.offset[i+1]).reduce((sum,id)=>sum+(id<0?-q[~id]:q[id]),0);
  // Add and remove the same weighted potential gradient to a balanced cycle.
  const qStar=c.map((v,i)=>circulation-v*(p[i]-p[(i+1)%3]));
  const q=c.map((v,i)=>qStar[i]+v*(p[i]-p[(i+1)%3]));q.push(0);
  for(let i=0;i<3;i++)assert.ok(Math.abs(incidence(q,i))<1e-14);
  const energy=shift=>c.reduce((sum,v,i)=>sum+(q[i]+shift-qStar[i])**2/v,0);
  for(const shift of [-3,-.01,.02,4])assert.ok(energy(shift)>energy(0));
});
test('each D3Q19 pull from an adjacent brick has a unique packed boundary address',()=>{
  const {size,map}=momentShell(),occupied=map.filter(k=>k>=0);
  assert.equal(size,104);assert.deepEqual(occupied,[...Array(size).keys()]);
  const extent=[8,4,4];
  for(let i=0;i<128;i++){
    const dst=[i%8,(i>>3)%4,i>>5];
    for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
      if(x*x+y*y+z*z>2)continue;
      const src=[x,y,z].map((d,k)=>dst[k]-d);
      if(src.every((v,k)=>v>=0&&v<extent[k]))continue;
      const [a,b,c]=src.map((v,k)=>(v+extent[k])%extent[k]);
      assert.ok(map[a+8*(b+4*c)]>=0);
    }
  }
});
test('a moving-body win alone cannot qualify the static graph comparison',()=>{
  const run=(kind,fixture,timeToTargetMs)=>({kind,fixture,timeToTargetMs});
  const cases=[run('mr-lbm','ahmed',3),run('mr-lbm','propeller',6)];
  assert.equal(scoreContests(cases).qualified,false);
  cases.push(...['ahmed','sphere','ahmed-wake'].map(f=>run('sdf-graph',f,5)));
  assert.deepEqual(scoreContests(cases),{bodyAndRotor:{kind:'mr-lbm',totalMs:9},staticBodies:{kind:'sdf-graph',totalMs:15},qualified:true});
  cases.at(-1).timeToTargetMs=null;assert.equal(scoreContests(cases).qualified,false);
});
test('Dirichlet sine transform is orthonormal and diagonalizes the original stencil',()=>{
  for(const n of [6,8,14,16]){
    const {q,eigen}=blockBasis(n);
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){
      const v=q[i*n+j],lap=2*v-(j?q[i*n+j-1]:0)-(j+1<n?q[i*n+j+1]:0);
      assert.ok(Math.abs(lap-eigen[i]*v)<2e-7);
      let product=0;for(let l=0;l<n;l++)product+=q[i*n+l]*q[j*n+l];
      assert.ok(Math.abs(product-Number(i===j))<2e-7);
    }
  }
});
test('Schur response and its restricted Green inverse recover independent interface vectors',()=>{
  for(const n of [8,16]){
    const {s,green,m}=schurGeometry(n);assert.equal(m,n**3-(n-2)**3);
    const x=Float64Array.from({length:m},(_,i)=>Math.sin(i*.53)+Math.cos(i*.973));
    const multiply=(a,v)=>Float64Array.from(v,(_,i)=>{let sum=0;for(let j=0;j<m;j++)sum+=a[i*m+j]*v[j];return sum;});
    const b=multiply(s,x),y=multiply(green,b);
    assert.ok(Math.max(...y.map((v,i)=>Math.abs(v-x[i])))<2e-6);
    assert.ok(b.reduce((sum,v,i)=>sum+v*x[i],0)>0);
  }
});
test('inaccurate or incompletely sampled accelerators cannot win',()=>{
  const run=(ms,qualified=true)=>({ms,qualified});
  const candidates=[{kind:'wrong',samples:[run(1,false),run(1),run(1)]},{kind:'missing',samples:[]},
    {kind:'gpu',samples:[run(9),run(10),run(10)]},{kind:'neural',samples:[run(6),run(7),run(100)]}];
  assert.equal(winningBackend(candidates).kind,'neural');assert.equal(winningBackend(candidates.slice(0,2)),null);
});
test('annular axial force and local Shape adjoint agree with analytic and displaced-wall solutions',()=>assert.ok(verifyShape().pass));
test('dual-weighted refinement improves localized force at an equal sector budget',()=>assert.ok(verifyGoalRefinement().pass));
test('reciprocal Voronoi weights seal thin walls and sharp edges across offsets',()=>assert.ok(verifyThinWalls().pass));
test('segment certificate detects a negative interior extremum between positive samples',()=>{
  // Along the diagonal xy is quadratic; endpoints and the usual midpoint miss the sheet.
  const f={h:1,origin:[-.5,-.5,-.5]};
  assert.equal(crossesMetric({f,sample:p=>(p[0]-.11)*(p[1]-.14)},[0,0,0],[1,1,1]),true);
  assert.equal(crossesMetric({f,sample:p=>(p[0]-.11)*(p[1]-.14)+.01},[0,0,0],[1,1,1]),false);
});
