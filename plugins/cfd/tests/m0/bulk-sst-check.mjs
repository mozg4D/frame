import {bulkSstWGSL,gpuScope} from '../../plugin.js';

// Independent scalar reconstruction of the two transport equations, in
// Float64. The WGSL transpose is compared with central differences of the
// complete four-output map for every independent input and objective.
function reference(q,ddes){
  const [k0,w0,eddy,s2,g2,cross,dist,pitch,nu,share,advK,advW,lapK,lapW,elK,elW]=q;
  const k=Math.max(1e-12,k0),w=Math.max(1e-8,w0),y=Math.max(.5,dist),r=Math.sqrt(k);
  const cd=Math.max(1e-14,2*.856*cross/w);
  const a=r/(.09*w*y),b=500*nu/(y*y*w),c=4*.856*k/(cd*y*y);
  const f1=Math.tanh(Math.min(10,Math.max(a,b),c)**4),f2=Math.tanh(Math.min(10,Math.max(2*a,b))**2);
  const production=Math.min(eddy*s2,.9*k*w),rans=r/(.09*w),les=(.61+.17*f1)*pitch;
  const rd=(eddy+nu)/Math.max(1e-20,.41**2*y*y*Math.sqrt(Math.max(0,g2)));
  const shield=1-Math.tanh(Math.min(8,20*rd)**3);
  const decay=ddes?r/Math.max(1e-20,(1-shield)*rans+shield*Math.min(rans,les)):.09*w;
  const beta=.0828-.0078*f1,gamma=.44+(5/9-.44)*f1;
  const omegaProduction=eddy>0?gamma*production/Math.max(eddy,1e-10):0;
  const source=omegaProduction+(1-f1)*2*.856*cross/w;
  return {value:[
    (share*(k+production)-advK+nu*lapK+(1-.15*f1)*elK)/(1+decay),
    (share*(w+source)-advW+nu*lapW+(.856-.356*f1)*elW)/(1+beta*w),
    share*production/(1+decay),share*Math.sqrt(Math.max(s2,0))*f2],
    limited:eddy*s2>.9*k*w,f1,shield,lesLimited:les<rans};
}

function samples(){
  const cases=[];
  for(let i=0;i<60;i++){
    const k=2e-5*1.5**(i%16),w=.018+.019*(i%9),eddy=.0001*2.3**(i%7);
    const strain=.003+.024*(i%10),s2=strain**2;
    const dist=[.28,.8,1.8,3.4,7.2,13,26,48,85,130,200][i%11];
    const cross=(i%3===0?-1:1)*(i%3===1?.18:1.5)*k*w/(dist*dist);
    cases.push([k,w,eddy,s2,(.7+1.7*(i%3))*s2,cross,dist,.42+.31*(i%7),
      3e-5*(1+i%4),.29+.063*(i%11),.1*k*Math.sin(i),.09*w*Math.cos(i),
      -.35*k,.17*w,.0012*k,-.0006*w]);
  }
  return cases.map(q=>Array.from(Float32Array.from(q)));
}

export async function verifyBulkSst(device){
  const cases=samples(),special=[
    [0,0,.001,0,0,0,.25,1,1e-5,1,0,0,0,0,0,0],
    [.002,.1,0,0,0,0,40,1,1e-5,1,0,0,0,0,0,0]];
  const field=['k','omega','eddyViscosity','strainSquared','gradientNormSquared','gradientCrossProduct',
    'wallDistance','largestPitch','molecularViscosity','volumeShare','kAdvection','omegaAdvection',
    'kDiffusion','omegaDiffusion','kEddyDiffusion','omegaEddyDiffusion'];
  const gpu=gpuScope(device),rows=[];
  try{
    for(const ddes of [false,true]){
      const values=[...cases,...special],n=values.length*4;
      const q=new Float32Array(16*n),seeds=new Float32Array(4*n);
      for(const [i,sample] of values.entries())for(let j=0;j<4;j++){
        const slot=4*i+j;q.set(sample,16*slot);seeds[4*slot+j]=1;
      }
      const kernel=await gpu.kernel('CFD differentiate the SST cell transport equations',bulkSstWGSL(ddes,true)+`
        struct Result{value:vec4f,dual:SstInputs}
        @group(0) @binding(0) var<storage,read> q:array<SstInputs>;
        @group(0) @binding(1) var<storage,read> s:array<vec4f>;
        @group(0) @binding(2) var<storage,read_write> results:array<Result>;
        @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
          let i=id.x;if(i>=arrayLength(&results)){return;}
          results[i]=Result(bulkSst(q[i]),bulkSstReverse(q[i],s[i]));
        }`);
      const out=gpu.buffer('Bulk SST primal and cotangents',80*n);
      gpu.run(kernel,[gpu.buffer('Physical SST states',q),gpu.buffer('Independent output seeds',seeds),out],[Math.ceil(n/64)]);
      const data=await gpu.read(out,gpu.staging('Read all four SST Jacobian rows',out.size),out.size/4);
      const errors=field.map(()=>[0,0]),primal=[0,0,0,0],norm=[0,0,0,0];let fdStepError=0;
      for(const [i,sample] of cases.entries()){
        const ref=reference(sample,ddes).value;
        for(let j=0;j<4;j++){
          const base=20*(4*i+j),scale=Math.max(1e-12,Math.abs(ref[j]));
          primal[j]+=(data[base+j]-ref[j])**2;norm[j]+=ref[j]**2;
          for(let a=0;a<16;a++){
            const amplitude=Math.max(1e-12,Math.abs(sample[a])),slopes=[];
            for(const h of [1e-4,5e-5]){
              const left=[...sample],right=[...sample];left[a]-=amplitude*h;right[a]+=amplitude*h;
              slopes.push((reference(right,ddes).value[j]-reference(left,ddes).value[j])/(2*h));
            }
            const predicted=data[base+4+a]*amplitude;
            errors[a][0]+=((predicted-slopes[1])/scale)**2;errors[a][1]+=(slopes[1]/scale)**2;
            fdStepError=Math.max(fdStepError,Math.abs(slopes[1]-slopes[0])/scale);
          }
        }
      }
      const relative=Object.fromEntries(errors.map(([err,den],a)=>[field[a],Math.sqrt(err/Math.max(den,1e-17))]));
      const primalRelativeL2=primal.map((v,i)=>Math.sqrt(v/norm[i]));
      const states=cases.map(q=>reference(q,ddes)),coverage={samples:cases.length,
        inner:states.filter(s=>s.f1>.99).length,outer:states.filter(s=>s.f1<.01).length,
        blending:states.filter(s=>s.f1>.01&&s.f1<.99).length,productionLimited:states.filter(s=>s.limited).length,
        shielded:states.filter(s=>s.shield<.01).length,detached:states.filter(s=>s.shield>.99&&s.lesLimited).length,
        partialShielding:states.filter(s=>s.shield>.01&&s.shield<.99&&s.lesLimited).length};
      rows.push({model:ddes?'DDES':'SST',coverage,primalRelativeL2,transposeRelativeL2:relative,fdStepError,
        finiteAtZeroStrainAndUniformFlow:data.subarray(80*cases.length).every(Number.isFinite),
        pass:data.every(Number.isFinite)&&Math.max(...primalRelativeL2)<2e-5&&Math.max(...Object.values(relative))<.001&&
          fdStepError<3e-5&&coverage.inner&&coverage.outer&&coverage.blending&&coverage.productionLimited>0&&
          coverage.productionLimited<cases.length&&(!ddes||!!(coverage.shielded&&coverage.detached&&coverage.partialShielding))});
    }
    return {pass:rows.every(r=>r.pass),rows};
  }finally{gpu.close();}
}
