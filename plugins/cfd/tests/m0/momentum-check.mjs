import {gpuScope} from './gpu.mjs';
import {cartesianSolver,cellCenter,cellWidth,sstWallWGSL,linearCutPressure,cutGroups} from '../../plugin.js';

const boxLo=[12.53,1.38,2.52],boxHi=[16.48,5.42,5.46];
export function cutBox(p){
  const intervals=p.map((v,k)=>[Math.max(v-.5,boxLo[k]),Math.min(v+.5,boxHi[k])]);
  const overlap=intervals.map(([a,b])=>Math.max(0,b-a)),theta=1-overlap.reduce((a,b)=>a*b);
  const open=p.map((v,k)=>v+.5>boxLo[k]&&v+.5<boxHi[k]?1-overlap[(k+1)%3]*overlap[(k+2)%3]:1);
  const centers=[];
  for(let k=0;k<3;k++)for(let t=1;t<=2;t++){
    const a=(k+t)%3,r=open[k];
    centers.push(r>0&&r<1?-(1-r)*(.5*(intervals[a][0]+intervals[a][1])-p[a])/r:0);
  }
  return {open,theta,centers};
}

// The pressure reservoirs have equal pressure and the perturbation is supported
// away from the outer boundary. Total Cartesian fluid impulse lost in the first
// step must equal the reported body reaction, including tangential components.
export async function verifyMomentum(device,graded=false,wallModeled=false,cutCells=false,linearWallPressure=false,sstWall=false,faceReconstruction=false,mergeToFluid=false,groupTransport=false){
  const gpu=gpuScope(device),dims=[32,8,8],count=dims.reduce((a,b)=>a*b);
  const h=.004,dt=.0004;
  const axes=graded?dims.map(d=>Float64Array.from({length:d+1},(_,i)=>h*i*(.7+.3*i/d))):undefined;
  const fixture={name:'momentum',dims,axes,h,origin:[0,0,0],maxSpeed:1,U:0,omega:0,cutCells,linearWallPressure,sstWall,faceReconstruction,mergeToFluid,
    nu:1.5e-5,sphere:!wallModeled,wallModeled,rotor:false,period:.01,groupTransport,faceHistory:groupTransport,pressureOpen:[true,true,true,true,true,true]};
  try{
    const material=new Float32Array(4*count),wall=new Float32Array(4*count),initial=new Float32Array(8*count);
    const centers=cutCells?new Float32Array(6*count):null;
    const before=[0,0,0],volumes=new Float64Array(count);
    const mobile=d=>Math.max(0,Math.min(1,d+.5));
    for(let i=0;i<count;i++){
      const x=i%32,y=(i>>5)%8,z=i>>8;
      volumes[i]=cellWidth(fixture,0,x)*cellWidth(fixture,1,y)*cellWidth(fixture,2,z);
      const distance=(a,b,c)=>Math.hypot(a-14.2,b-3.2,c-4.1)-2.1;
      const d=distance(x,y,z);wall.set([d,0,0,1-mobile(d)],4*i);
      if(cutCells){
        // An independently integrated offset box leaves fluid slivers as
        // small as 2% along x. All its internal face apertures are analytic.
        const p=[x,y,z],geometry=cutBox(p),{theta,open}=geometry;
        centers.set(geometry.centers,6*i);const q=p.map((v,k)=>Math.max(boxLo[k]-v,v-boxHi[k]));
        wall[4*i]=Math.hypot(...q.map(v=>Math.max(0,v)))+Math.min(0,Math.max(...q));
        material.set([...open,theta],4*i);volumes[i]*=material[4*i+3];
      }else if(wallModeled){const fluid=Number(d>0);volumes[i]*=fluid;
        material.set([fluid*Number(distance(x+1,y,z)>0),fluid*Number(distance(x,y+1,z)>0),fluid*Number(distance(x,y,z+1)>0),fluid],4*i);
      }else material.set([mobile(distance(x+.5,y,z)),mobile(distance(x,y+.5,z)),mobile(distance(x,y,z+.5)),mobile(d)],4*i);
      const bump=Math.max(0,1-Math.hypot(x-12.5,y-3.5,z-3.5)/2.4);
      initial.set([.067*bump,-.021*bump,.041*bump,.00001,.02,0,0,0],8*i);
      for(let axis=0;axis<3;axis++)before[axis]+=volumes[i]*initial[8*i+axis];
    }
    const force=gpu.buffer('CFD independently balanced impulse',4*count);
    const wallBuffer=gpu.buffer('CFD test wall',wall),apertures=gpu.buffer('CFD test face mobility',material);
    const groups=cutCells?await cutGroups(gpu,fixture,apertures,wallBuffer):null;
    const solver=await cartesianSolver(gpu,fixture,dt,wallBuffer,force,apertures,groups,
      centers?gpu.buffer('CFD independently clipped square centroids',centers):null);
    device.queue.writeBuffer(solver.state,0,initial);
    if(groupTransport){
      // A closed upstream circulation transports the non-uniform impulse.
      const q=new Float32Array(8*count);
      for(const [x,y,a,sign] of [[10,3,0,1],[11,3,1,1],[10,4,0,-1],[10,3,1,-1]]){
        const i=x+32*(y+8*3),j=i+(a===0?1:32);
        q[8*i+a]=q[8*j+4+a]=sign*.28;
      }
      device.queue.writeBuffer(solver.flux,0,q);
      await solver.advance(0,false,{async perform(ops){
        const e=device.createCommandEncoder();for(const op of ops)op.encode(e);device.queue.submit([e.finish()]);
        await device.queue.onSubmittedWorkDone();
      }});
    }else solver.step(0,false);
    const stage=gpu.staging('CFD control volume readback',32*count);
    const after=await gpu.read(solver.state,stage,8*count),axial=await gpu.read(force,stage,count),other=await gpu.read(solver.loads,stage,4*count);
    const fluidChange=[0,0,0],reaction=[0,0,0];
    for(let i=0;i<count;i++){
      for(let k=0;k<3;k++)fluidChange[k]+=volumes[i]*(initial[8*i+k]-after[8*i+k]);
      reaction[0]+=axial[i];reaction[1]+=other[4*i+2];reaction[2]+=other[4*i+3];
    }
    const relativeError=reaction.map((v,k)=>Math.abs((v-fluidChange[k])/before[k]));
    const faces=await gpu.read(solver.flux,stage,8*count),tail=await gpu.read(solver.fluxTail,stage,8*count);
    let groupCourant=null;
    if(cutCells){
      const strides=[1,32,256],roots=new Uint32Array(count),groupVolume=new Float64Array(count),flow=new Float64Array(count);
      let fluidParents=null;
      if(mergeToFluid){
        const depth=new Int32Array(count).fill(-1),queue=[];
        const neighbours=(i,visit)=>{
          const p=[i%32,(i>>5)%8,i>>8],width=p.map((v,a)=>cellWidth(fixture,a,v));
          for(const [a,s] of strides.entries())for(const side of [-1,1]){
            if(p[a]+side<0||p[a]+side>=dims[a])continue;
            const j=i+side*s,opening=material[4*Math.min(i,j)+a];
            if(opening>0&&material[4*j+3]>0)visit(j,Math.fround(opening*Math.fround(width[(a+1)%3]*width[(a+2)%3])));
          }
        };
        for(let i=0;i<count;i++)if(material[4*i+3]===1&&wall[4*i]>0){queue.push(i);depth[i]=0;}
        for(let h=0;h<queue.length;h++){const i=queue[h];neighbours(i,j=>{if(depth[j]<0){depth[j]=depth[i]+1;queue.push(j);}});}
        fluidParents=Int32Array.from({length:count},(_,i)=>i);
        for(const i of queue)if(depth[i]>0){
          let best=-1;neighbours(i,(j,opening)=>{if(depth[j]+1===depth[i]&&opening>best){best=opening;fluidParents[i]=fluidParents[j];}});
        }
      }
      for(let i=0;i<count;i++){
        let j=fluidParents?.[i]??i;
        while(material[4*j+3]>0&&material[4*j+3]<.3){
          let next=j,bestOpening=0;const point=[j%32,(j>>5)%8,j>>8];
          for(const [a,stride] of strides.entries())for(const side of [-1,1]){
            if(point[a]+side<0||point[a]+side>=dims[a])continue;
            const k=j+side*stride,opening=material[4*Math.min(j,k)+a],other=material[4*k+3];
            if(opening>0&&other>material[4*j+3]&&(other>material[4*next+3]||other===material[4*next+3]&&opening>bestOpening)){
              next=k;bestOpening=opening;
            }
          }
          if(next===j)break;j=next;
        }
        roots[i]=j;groupVolume[j]+=volumes[i];
      }
      for(let i=0;i<count;i++)if(volumes[i]){
        const point=[i%32,(i>>5)%8,i>>8];
        for(const [a,stride] of strides.entries())for(const side of [-1,1]){
          if(point[a]+side>=0&&point[a]+side<dims[a]&&roots[i+side*stride]===roots[i])continue;
          const slot=8*i+a+(side<0?4:0);flow[roots[i]]+=Math.abs(faces[slot]+tail[slot]);
        }
      }
      const expected=flow.reduce((m,x,i)=>groupVolume[i]?Math.max(m,.5*x/groupVolume[i]):m,0);
      const measured=await groups.courant(solver.flux,solver.fluxTail);
      groupCourant={expected,measured,relativeError:Math.abs(measured/expected-1)};
    }
    let maxRawImbalance=0,maxCorrectedImbalance=0,maxPairMismatch=0;
    for(let i=0;i<count;i++){
      let raw=0,balance=0;const point=[i%32,(i>>5)%8,i>>8];
      for(let k=0;k<3;k++){
        const a=8*i+k,b=a+4;raw+=faces[a]-faces[b];balance+=(faces[a]+tail[a])-(faces[b]+tail[b]);
        if(point[k]+1<dims[k]){const other=b+8*[1,32,256][k];maxPairMismatch=Math.max(maxPairMismatch,Math.abs((faces[a]+tail[a])-(faces[other]+tail[other])));}
      }
      if(volumes[i]>0){maxRawImbalance=Math.max(maxRawImbalance,Math.abs(raw)/volumes[i]);maxCorrectedImbalance=Math.max(maxCorrectedImbalance,Math.abs(balance)/volumes[i]);}
    }
    let wallLawError=null,sstWallError=null;
    if(wallModeled){
      const nu=1.5e-5,y=.003,up=[.01,1,5,11,25],input=[],expected=[],wallValues=[];
      for(const u of up){const x=.41*u,yp=u+(Math.expm1(x)-x-.5*x*x-x*x*x/6)/9.8,friction=yp*nu/y;
        input.push(u*friction);expected.push(friction**2);
        wallValues.push([Math.hypot(6*nu/(.075*y*y),friction/(.3*.41*y)),(1-u/yp)*friction**3/(.41*y),u/yp*nu/y]);}
      const speed=gpu.buffer('CFD wall reference speeds',Float32Array.from(input)),out=gpu.buffer('CFD calculated wall state',16*up.length);
      const pipe=await gpu.kernel('CFD oblique wall shear reference',sstWallWGSL+`
        @group(0) @binding(0) var<storage,read> speed:array<f32>;@group(0) @binding(1) var<storage,read_write> shear:array<vec4f>;
        @compute @workgroup_size(8) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x>=arrayLength(&speed)){return;}
          let n=vec3f(.6,0.,.8);let t=vec3f(.8,0.,-.6);let v=speed[g.x]*(t+1.7*n);
          let ut=tangentialSlip(v,n);shear[g.x]=vec4f(dot(ut,t)*wallResistance(length(ut),${y},${nu}),sstWall(length(ut),${y},${nu}));}`);
      gpu.run(pipe,[speed,out],[1]);const shear=await gpu.read(out,stage,4*up.length);
      wallLawError=expected.reduce((err,value,i)=>Math.max(err,Math.abs(shear[4*i]/value-1)),0);
      sstWallError=wallValues.reduce((err,row,i)=>Math.max(err,...row.map((value,k)=>{
        const scale=k===1?expected[i]**1.5/(.41*y):value;return Math.abs(shear[4*i+k+1]-value)/scale;
      })),0);
    }
    return {fixture:'localized velocity beside a stationary immersed body',wallModeled,cutCells,linearWallPressure,wallLawError,initialMomentum:before,fluidMomentumLoss:fluidChange,bodyImpulse:reaction,relativeError,
      maxRawImbalance,maxCorrectedImbalance,maxPairMismatch,groupCourant,sstWallError,
      pass:relativeError.every(v=>v<2e-6)&&reaction.every(v=>Math.abs(v)>.001)&&maxPairMismatch===0&&maxCorrectedImbalance<1e-9&&
        (!groupCourant||groupCourant.relativeError<2e-6)&&(!wallModeled||(wallLawError<.0005&&sstWallError<.0005))};
  }finally{gpu.close();}
}

// A closed solid in p=p0+g.x receives -Vsolid*g. The independent Cartesian
// rectangle integral checks the complete cut-wall pressure, for every axis,
// including cells whose centres lie on the solid side of the surface.
export async function verifyLinearWallPressure(device,graded){
  const gpu=gpuScope(device),dims=[32,8,8],n=2048,h=.004;
  const axes=graded?dims.map(d=>Float64Array.from({length:d+1},(_,i)=>h*i*(.7+.3*i/d))):undefined;
  const f={name:'linear-cut',dims,axes,h,origin:[0,0,0],pressureOpen:Array(6).fill(false),fullMoment:true};
  const material=new Float32Array(4*n),wall=new Float32Array(4*n),centers=new Float32Array(6*n),p=new Float32Array(n);
  const axial=new Float32Array(n),loads=new Float32Array(8*n),gradient=[.23,-.39,.17],strides=[1,32,256];
  function coords(i){return [i%32,(i>>5)%8,i>>8];}
  for(let i=0;i<n;i++){
    const xyz=coords(i),{theta,open,centers:offset}=cutBox(xyz);
    material.set([...open,theta],4*i);wall[4*i+3]=theta;centers.set(offset,6*i);
    p[i]=xyz.reduce((s,v,k)=>s+gradient[k]*cellCenter(f,k,v)/h,.4);
  }
  for(let i=0;i<n;i++){
    if(material[4*i+3]===0)continue;
    const xyz=coords(i),width=xyz.map((v,k)=>cellWidth(f,k,v)),arm=xyz.map((v,k)=>cellCenter(f,k,v));
    const force=width.map((_,k)=>{
      const hi=xyz[k]+1<dims[k]?material[4*i+k]:1,lo=xyz[k]>0?material[4*(i-strides[k])+k]:1;
      return p[i]*(lo-hi)*width[(k+1)%3]*width[(k+2)%3];
    });
    axial[i]=force[0];loads.set([force[0],arm[1]*force[2]-arm[2]*force[1],force[1],force[2]],4*i);
    loads.set([0,0,arm[2]*force[0]-arm[0]*force[2],arm[0]*force[1]-arm[1]*force[0]],4*(n+i));
  }
  const physical=(v,k)=>{const j=Math.floor(v+.5);return cellCenter(f,k,j)+(v-j)*h*cellWidth(f,k,j);};
  const lo=boxLo.map(physical),hi=boxHi.map(physical),volume=hi.reduce((s,v,k)=>s*(v-lo[k])/h,1);
  const target=gradient.map(v=>-v*volume),arm=lo.map((v,k)=>(v+hi[k])*.5);
  const expectedMoment=arm.map((_,k)=>arm[(k+1)%3]*target[(k+2)%3]-arm[(k+2)%3]*target[(k+1)%3]);
  try{
    const fx=gpu.buffer('CFD base manufactured drag',axial),all=gpu.buffer('CFD base manufactured load',loads);
    const apply=await linearCutPressure(gpu,f,gpu.buffer('CFD box apertures',material),gpu.buffer('CFD box face moments',centers),
      gpu.buffer('CFD box wall volumes',wall),gpu.buffer('CFD affine pressure',p),gpu.buffer('CFD affine pressure impulses',n*32),fx,all);
    const e=device.createCommandEncoder();apply(e);device.queue.submit([e.finish()]);
    const read=await gpu.read(all,gpu.staging('CFD manufactured surface load',all.size),8*n),sum=Array(8).fill(0);
    for(let i=0;i<read.length;i++)sum[(i<4*n?0:4)+i%4]+=read[i];
    const measured=[sum[0],sum[2],sum[3]],forceError=Math.max(...measured.map((x,k)=>Math.abs(x/target[k]-1)));
    const measuredMoment=[sum[1],sum[6],sum[7]];
    const torqueError=Math.max(...measuredMoment.map((x,k)=>Math.abs(x/expectedMoment[k]-1)));
    return {expectedForce:target,measuredForce:measured,forceError,expectedMoment,measuredMoment,
      expectedTorque:expectedMoment[0],measuredTorque:sum[1],torqueError,pass:forceError<5e-6&&torqueError<.02};
  }finally{gpu.close();}
}
