import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCuboidField} from '../finite-body.js';
const MU0=4*Math.PI*1e-7;
const near=(a,b,tol=2e-7)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b} within ${tol}`);
const vec=(a,b,tol)=>a.forEach((x,i)=>near(x,b[i],tol));
const field=(bodies,targets)=>evaluateCuboidField({units:'SI',bodies,targets});

// Independent integration: Gauss-Legendre face quadrature, no analytic corner/log/solid-angle expressions.
function gauss(n) {
  const nodes=Array(n),weights=Array(n);
  for(let i=0;i<Math.ceil(n/2);i++) {
    let x=Math.cos(Math.PI*(i+.75)/(n+.5)),derivative;
    for(let iteration=0;iteration<30;iteration++) {
      let p0=1,p1=x;for(let k=2;k<=n;k++){const next=((2*k-1)*x*p1-(k-1)*p0)/k;p0=p1;p1=next;}
      derivative=n*(x*p1-p0)/(x*x-1);const delta=p1/derivative;x-=delta;if(Math.abs(delta)<1e-15)break;
    }
    nodes[i]=-x;nodes[n-1-i]=x;weights[i]=weights[n-1-i]=2/((1-x*x)*derivative*derivative);
  }
  return {nodes,weights};
}
function integrate(body,target,n) {
  const {nodes,weights}=gauss(n),H=[0,0,0],half=body.halfSize;
  for(let normal=0;normal<3;normal++)for(const sign of [-1,1]) {
    const axes=[0,1,2].filter(a=>a!==normal),sigma=sign*body.magnetization[normal];
    for(let i=0;i<n;i++)for(let j=0;j<n;j++) {
      const source=[...body.center];source[normal]+=sign*half[normal];
      source[axes[0]]+=half[axes[0]]*nodes[i];source[axes[1]]+=half[axes[1]]*nodes[j];
      const r=target.map((x,k)=>x-source[k]),radius=Math.hypot(...r);
      const factor=sigma*half[axes[0]]*half[axes[1]]*weights[i]*weights[j]/(4*Math.PI*radius**3);
      r.forEach((x,k)=>H[k]+=x*factor);
    }
  }
  return H;
}

test('oblique interior/exterior fields agree with independently converged six-face integration',()=>{
  const body={center:[.2,-.3,.1],halfSize:[.7,.9,.5],magnetization:[600,-320,170]};
  const targets=[[.31,-.2,.18],[1.4,.6,.9],[-1.2,-1.4,.7],[.5,1.6,-.8]];
  const actual=field([body],targets);
  targets.forEach((p,i)=>{
    const coarse=integrate(body,p,32),fine=integrate(body,p,48);vec(coarse,fine,3e-7);vec(actual.H[i],fine,3e-7);
    const M=i===0?body.magnetization:[0,0,0];vec(actual.materialM[i],M,1e-12);
    vec(actual.B[i],actual.H[i].map((x,k)=>MU0*(x+M[k])),1e-15);
  });
});

test('center demagnetizing tensor has unit trace but a long prism is unlike a sphere',()=>{
  const halfSize=[1,1,10],Ns=[];
  for(let axis=0;axis<3;axis++) {
    const M=[0,0,0];M[axis]=900;
    const body={center:[0,0,0],halfSize,magnetization:M};
    const r=field([body],[[0,0,0]]);Ns.push(-r.H[0][axis]/900);
    vec(r.H[0],integrate(body,[0,0,0],128),2e-5);
  }
  near(Ns.reduce((a,b)=>a+b,0),1,2e-12);assert.ok(Ns[2]<.01);assert.ok(Ns[0]>.49);
  // The existing equivalent-sphere -M/3 diagonal is inappropriate for this body's center field.
  assert.ok(Math.abs(Ns[2]-1/3)>.3);
});

test('rigid covariance agrees with an independent Rodrigues rotation',()=>{
  const axis=[1/3,2/3,2/3],angle=.8,c=Math.cos(angle),s=Math.sin(angle);
  const rotate=v=>{
    const dot=v.reduce((sum,x,i)=>sum+x*axis[i],0),cross=[axis[1]*v[2]-axis[2]*v[1],axis[2]*v[0]-axis[0]*v[2],axis[0]*v[1]-axis[1]*v[0]];
    return v.map((x,i)=>x*c+cross[i]*s+axis[i]*dot*(1-c));
  };
  const base={center:[0,0,0],halfSize:[.5,.8,.9],magnetization:[200,500,-120]},points=[[0,0,0],[1.2,-1.1,.7]];
  const before=field([base],points),translation=[2,-3,1],q=[...axis.map(x=>x*Math.sin(angle/2)),Math.cos(angle/2)];
  const after=field([{...base,center:translation,rotation:q}],points.map(p=>rotate(p).map((x,i)=>x+translation[i])));
  before.H.forEach((v,i)=>vec(after.H[i],rotate(v),2e-10));before.B.forEach((v,i)=>vec(after.B[i],rotate(v),1e-15));
});

test('boundary conditions hold in limits approaching a face away from its edges',()=>{
  const M=[500,300,-100],body={center:[0,0,0],halfSize:[1,1,1],magnetization:M},eps=1e-6;
  const r=field([body],[[1-eps,.13,-.21],[1+eps,.13,-.21]]);
  near(r.H[1][0]-r.H[0][0],M[0],.002);near(r.H[1][1],r.H[0][1],.002);near(r.H[1][2],r.H[0][2],.002);
  near(r.B[0][0],r.B[1][0],3e-9);
});

test('opposed faces give a finite field across a shrinking explicit air gap',()=>{
  const halfSize=[1,1,1],magnetization=[1000,0,0];let previous=null;
  for(const gap of [1e-2,1e-4,1e-6]) {
    const r=field([{center:[-1-gap/2,0,0],halfSize,magnetization},{center:[1+gap/2,0,0],halfSize,magnetization}],[[0,0,0]]);
    assert.equal(r.region[0],'exterior');assert.ok(r.H[0][0]>800&&r.H[0][0]<1000);near(r.H[0][1],0);near(r.H[0][2],0);
    if(previous!==null)assert.ok(r.H[0][0]>previous);previous=r.H[0][0];
  }
  // This point-field example does not validate a sample discretization or the native tiny-gap solver.
});

test('away from surfaces numerical derivatives obey divergence-free B and curl-free H',()=>{
  const body={center:[0,0,0],halfSize:[.4,.6,.7],magnetization:[230,-410,170]},step=1e-4;
  for(const point of [[1.3,.9,-.4],[.07,-.11,.13]]) {
    const targets=[];for(let axis=0;axis<3;axis++)for(const sign of [-1,1])targets.push(point.map((x,i)=>x+(i===axis?sign*step:0)));
    const r=field([body],targets),dH=[],dB=[];
    for(let axis=0;axis<3;axis++) {
      dH.push(r.H[2*axis+1].map((x,i)=>(x-r.H[2*axis][i])/(2*step)));
      dB.push(r.B[2*axis+1].map((x,i)=>(x-r.B[2*axis][i])/(2*step)));
    }
    near(dB.reduce((sum,row,i)=>sum+row[i],0)/MU0,0,2e-4);
    vec([dH[1][2]-dH[2][1],dH[2][0]-dH[0][2],dH[0][1]-dH[1][0]],[0,0,0],2e-4);
  }
});
