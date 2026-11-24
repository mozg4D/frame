// Independent FP64 verification of an axial viscous force and its discrete
// shape adjoint. Fully developed axial Stokes flow in an annulus reduces to a
// scalar finite-volume problem in (r,theta). Geometry and lengths are in SI.
const inner=0.02, outer=0.05, length=0.3, mu=0.08, rings=14, sectors=24;
const angle=2*Math.PI/sectors, dr=(outer-inner)/rings, first=inner+dr/2;
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);

function solveSpd(apply,b){
  const u=new Float64Array(b.length),r=b.slice(),p=r.slice();
  let rr=dot(r,r);const tolerance=rr*1e-25;
  for(let step=0;rr>tolerance;step++){
    if(step>=1000)throw Error('Annular finite-volume residual did not converge');
    const ap=apply(p), alpha=rr/dot(p,ap);
    for(let i=0;i<u.length;i++){u[i]+=alpha*p[i];r[i]-=alpha*ap[i];}
    const next=dot(r,r);
    if(!Number.isFinite(next))throw Error('Nonfinite annular residual');
    const beta=next/rr;rr=next;
    for(let i=0;i<p.length;i++)p[i]=r[i]+beta*p[i];
  }
  return u;
}

function annulus(radii,wallSpeed,withAdjoint=false,mesh={}){
  const sectors=radii.length,width=mesh.width??new Float64Array(sectors).fill(2*Math.PI/sectors);
  const weight=mesh.weight??new Float64Array(sectors).fill(1),wrap=i=>(i+sectors)%sectors;
  const gap=(i,j)=>(width[i]+width[j])/2;
  const size=rings*sectors, rhs=new Float64Array(size), objective=new Float64Array(size);
  const edges=[], diagonal=new Float64Array(size);
  for(let j=0;j<rings;j++){
    const r=first+j*dr, hi=inner+(j+1)*dr;
    for(let k=0;k<sectors;k++){
      const i=j*sectors+k,next=wrap(k+1);
      const lo=j===0?Math.sqrt(radii[k]*radii[next]):inner+j*dr;
      if(!(lo>0 && lo<r && radii[k]<first))throw Error('Perturbation leaves the frozen grid');
      edges.push([i,j*sectors+next,mu*length*Math.log(hi/lo)/gap(k,next)]);
      if(j+1<rings)edges.push([i,i+sectors,mu*length*width[k]/Math.log((r+dr)/r)]);
      if(j===0){const g=mu*length*width[k]/Math.log(r/radii[k]);objective[i]=weight[k]*g;diagonal[i]+=g;}
      if(j===rings-1){
        const conductance=mu*length*width[k]/Math.log(outer/r);
        diagonal[i]+=conductance;rhs[i]=conductance*wallSpeed[k];
      }
    }
  }
  const apply=v=>{
    const y=Float64Array.from(v,(x,i)=>diagonal[i]*x);
    for(const [i,j,g] of edges){const flux=g*(v[i]-v[j]);y[i]+=flux;y[j]-=flux;}
    return y;
  };
  const system={apply,rhs,objective};
  if(mesh.assembleOnly)return system;
  const u=solveSpd(apply,rhs),force=dot(objective,u);
  if(!withAdjoint)return {force};
  // A^T lambda = dJ/du. For each wall sector differentiate both its force
  // quadrature and all affected face fluxes in b-Au at fixed primal state.
  const lambda=solveSpd(apply,objective), gradient=new Float64Array(sectors);
  for(let k=0;k<sectors;k++){
    const a=radii[k], dg=mu*length*width[k]/(a*Math.log(first/a)**2);
    gradient[k]=dg*u[k]*(weight[k]-lambda[k]);
    for(const j of [wrap(k-1),wrap(k+1)]){
      const dEdge=-mu*length/(2*gap(k,j)*a);
      gradient[k]-=dEdge*(u[k]-u[j])*(lambda[k]-lambda[j]);
    }
  }
  return {force,gradient,...mesh.keepSystem?{...system,u,lambda}:{}};
}

// Reuse the adjoint of the selected force functional. The algebraic residual
// on the converged coarse grid vanishes. Reconstruct both states on a virtual
// refined grid and weight its local flux defect before choosing any new sites.
export function verifyGoalRefinement(){
  const regular=n=>Array.from({length:n+1},(_,i)=>i*2*Math.PI/n);
  const centers=faces=>faces.slice(1).map((v,i)=>(v+faces[i])/2);
  function problem(faces,options={}){
    const t=centers(faces),omega=Float64Array.from(t,a=>0.1+2.5*Math.exp(8*(Math.cos(a-.9)-1)));
    const weight=t.map(a=>Math.exp(6*(Math.cos(a-.65)-1)));
    return annulus(new Float64Array(t.length).fill(inner),omega,true,{width:t.map((_,i)=>faces[i+1]-faces[i]),weight,...options});
  }
  const coarse=regular(24),base=problem(coarse,{keepSystem:true}),enriched=regular(48),fine=problem(enriched,{assembleOnly:true});
  function reconstruct(field){
    return Float64Array.from({length:rings*48},(_,i)=>{
      const j=Math.floor(i/48),k=i%48,parent=Math.floor(k/2),other=(parent+(k%2?1:23))%24;
      return .75*field[j*24+parent]+.25*field[j*24+other];
    });
  }
  const projected=reconstruct(base.u),weight=reconstruct(base.lambda),applied=fine.apply(projected),indicator=new Float64Array(24);
  for(let i=0;i<projected.length;i++)indicator[Math.floor((i%48)/2)]+=weight[i]*(fine.rhs[i]-applied[i]);
  const ranked=Array.from(indicator,(v,i)=>[Math.abs(v),i]).sort((a,b)=>b[0]-a[0]);
  const selected=new Set(ranked.slice(0,12).map(row=>row[1]));
  const adaptive=coarse.flatMap((x,i)=>selected.has(i)?[x,(x+coarse[i+1])/2]:[x]);
  const reference=problem(regular(144)).force,uniform=problem(regular(36)).force,adapted=problem(adaptive).force;
  const error=v=>Math.abs(v-reference);
  return {objective:'weighted axial wall force',coarseN:24,adaptedN:36,uniformN:36,referenceN:144,
    selectedSectors:[...selected],coarseErrorN:error(base.force),uniformErrorN:error(uniform),adaptiveErrorN:error(adapted),
    pass:error(adapted)<error(uniform)&&error(adapted)<error(base.force)};
}

export function verifyShape(){
  const radii=new Float64Array(sectors).fill(inner), constant=new Float64Array(sectors).fill(1);
  const uniform=annulus(radii,constant,true);
  const exactForce=2*Math.PI*mu*length/Math.log(outer/inner);
  const exactDerivative=2*Math.PI*mu*length/(inner*Math.log(outer/inner)**2);
  const uniformDerivative=uniform.gradient.reduce((a,b)=>a+b,0);
  // A nonuniform outer-wall velocity exercises positive, near-neutral and
  // negative local responses while the integrated axial force stays positive.
  const speeds=Float64Array.from(radii,(_,i)=>0.25+1.8*Math.cos((i+0.5)*angle)+0.3*Math.sin(2*(i+0.5)*angle));
  const base=annulus(radii,speeds,true), steps=[4e-5,2e-5], patches=[];
  for(let i=0;i<sectors;i++){
    const fd=steps.map(e=>{
      const plus=radii.slice(),minus=radii.slice();plus[i]+=e;minus[i]-=e;
      return (annulus(plus,speeds).force-annulus(minus,speeds).force)/(2*e);
    });
    const theta=(i+0.5)*angle, slope=base.gradient[i];
    patches.push({id:'wall-'+i,thetaDegrees:theta*180/Math.PI,
      centroidM:[length/2,inner*Math.cos(theta),inner*Math.sin(theta)],areaM2:inner*angle*length,
      sensitivityNPerMm:slope*1e-3,pairedNPerMm:fd.map(v=>v*1e-3),action:slope>0?'push_in':'pull_out'});
  }
  const a=patches.map(p=>p.sensitivityNPerMm), b=patches.map(p=>p.pairedNPerMm[1]);
  const center=v=>v.map(x=>x-v.reduce((s,p)=>s+p,0)/v.length), ac=center(a),bc=center(b);
  const correlation=dot(ac,bc)/Math.sqrt(dot(ac,ac)*dot(bc,bc));
  const relativeL2=Math.sqrt(dot(a.map((x,i)=>x-b[i]),a.map((x,i)=>x-b[i]))/dot(b,b));
  const signAgreement=a.every((v,i)=>Math.sign(v)===Math.sign(b[i]));
  const maxSlope=Math.max(...a.map(Math.abs));
  const trial=Float64Array.from(radii,(r,i)=>r-0.0004*a[i]/maxSlope);
  const trialForce=annulus(trial,speeds).force;
  const pass=Math.abs(uniform.force/exactForce-1)<1e-8 && Math.abs(uniformDerivative/exactDerivative-1)<1e-8 &&
    correlation>0.9 && relativeL2<0.005 && signAgreement && Math.min(...a)<0 && Math.max(...a)>0 && trialForce<base.force;
  return {fixture:'fully developed axial annular Stokes flow',objective:'minimize signed axial viscous force',
    unit:'N/mm per wall sector',method:'discrete adjoint of conservative face fluxes',stepsMm:steps.map(e=>e*1000),
    uniform:{forceN:uniform.force,exactForceN:exactForce,derivativeNPerM:uniformDerivative,exactDerivativeNPerM:exactDerivative},
    correlation,relativeL2,signAgreement,forceN:base.force,trialForceN:trialForce,patches,pass};
}
