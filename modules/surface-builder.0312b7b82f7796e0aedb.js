 
(function(root){
'use strict';
const SurfacePatch=(()=>{
'use strict';
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const mul=(a,s)=>a.map(x=>x*s);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(...a);
const unit=a=>{const L=len(a);return L>1e-30?mul(a,1/L):[0,0,0];};
const mix=(a,b,t)=>add(mul(a,1-t),mul(b,t));
const clamp=x=>Math.max(-1,Math.min(1,x));
const clamp01=x=>Math.max(0,Math.min(1,x));
function projectPerp(v,t){const q=dot(t,t)||1,s=dot(v,t)/q;return sub(v,mul(t,s));}
function pieceAt(p,t){const k=p.knots;let lo=0,hi=k.length-1;t=clamp01(t);while(hi-lo>1){const m=(lo+hi)>>1;if(k[m]<=t)lo=m;else hi=m;}return [lo,(t-k[lo])/(k[lo+1]-k[lo]),k[lo+1]-k[lo]];}
function cloneEdge(e,origin){const point=p=>p.map((v,k)=>v-(origin?.[k]||0)),out=e.map(point);if(e.pieces){out.pieces=e.pieces.map(p=>p.map(point));out.knots=e.knots.slice();}return out;}
const bez=(p,t)=>{if(p.pieces){const [i,s]=pieceAt(p,t);return bez(p.pieces[i],s);}const a=1-t,b=a*a*a,c=3*t*a*a,d=3*t*t*a,e=t*t*t;return [b*p[0][0]+c*p[1][0]+d*p[2][0]+e*p[3][0],b*p[0][1]+c*p[1][1]+d*p[2][1]+e*p[3][1],b*p[0][2]+c*p[1][2]+d*p[2][2]+e*p[3][2]];};
const deriv=(p,t)=>{if(p.pieces){const [i,s,w]=pieceAt(p,t);return mul(deriv(p.pieces[i],s),1/w);}const a=3*(1-t)*(1-t),b=6*t*(1-t),c=3*t*t;return [a*(p[1][0]-p[0][0])+b*(p[2][0]-p[1][0])+c*(p[3][0]-p[2][0]),a*(p[1][1]-p[0][1])+b*(p[2][1]-p[1][1])+c*(p[3][1]-p[2][1]),a*(p[1][2]-p[0][2])+b*(p[2][2]-p[1][2])+c*(p[3][2]-p[2][2])];};
function tangentVector(p,t){const d=deriv(p,t);if(len(d)>0)return d;if(p.pieces){const [i,u]=pieceAt(p,t);return tangentVector(p.pieces[i],u);}if(t===0){for(let i=1;i<4;i++){const q=sub(p[i],p[0]);if(len(q)>0)return q;}}else if(t===1){for(let i=2;i>=0;i--){const q=sub(p[3],p[i]);if(len(q)>0)return q;}}else{const q=p[0].map((_,k)=>6*((1-t)*(p[2][k]-2*p[1][k]+p[0][k])+t*(p[3][k]-2*p[2][k]+p[1][k])));if(len(q)>0)return q;}return sub(p[3],p[0]);}
function rotation(a,b){a=unit(a);b=unit(b);let d=dot(a,b);if(d<-.999999){const basis=Math.abs(a[0])<.8?[1,0,0]:[0,1,0];return [...unit(cross(a,basis)),0];}return unit([...cross(a,b),1+d]);}
function rotate(q,v){const t=mul(cross(q,v),2);return add(v,add(mul(t,q[3]),cross(q,t)));}
function angular(a,b,t,hint){a=unit(a);b=unit(b);const d=clamp(dot(a,b));if(d>.9999999)return unit(mix(a,b,t));if(d<-.999999){let guide=hint||[1,0,0],v=sub(guide,mul(a,dot(guide,a)));if(len(v)<1e-9)v=cross(a,Math.abs(a[0])<.8?[1,0,0]:[0,1,0]);v=unit(v);return add(mul(a,Math.cos(Math.PI*t)),mul(v,Math.sin(Math.PI*t)));}const h=Math.acos(d);return add(mul(a,Math.sin((1-t)*h)/Math.sin(h)),mul(b,Math.sin(t*h)/Math.sin(h)));}
function make(edges,options={}){
  let n=edges.length;if(n<2||n>5)throw Error('Supported side count: 2, 3, 4 or 5');edges=edges.map(e=>cloneEdge(e));
  for(let i=0;i<n;i++){const e=edges[i];if(e.length!==4||e.some(p=>p.length!==3||p.some(x=>!Number.isFinite(x))))throw Error('Four finite 3D control points required');if(len(sub(e[3],edges[(i+1)%n][0]))>1e-8)throw Error('Open boundary');if(len(sub(e[3],e[0]))<1e-9)throw Error('Degenerate edge');}
  const mode=options.fieldMode||'exact';
  const domain=Array.from({length:n},(_,i)=>[Math.cos(-Math.PI/2+2*Math.PI*i/n),Math.sin(-Math.PI/2+2*Math.PI*i/n)]);
  const edgeLengths=n>4?edges.map(e=>{let a=e[0],sum=0;for(let k=1;k<=128;k++){const b=bez(e,k/128);sum+=len(sub(b,a));a=b;}return sum;}):null;
  const widths=n>4?edges.map((e,i)=>{const chain=[];for(let k=n-2;k>=2;k--)chain.push((i+k)%n);const total=chain.reduce((v,j)=>v+edgeLengths[j],0);const opposite=t=>{let x=t*total;for(let k=0;k<chain.length;k++){const j=chain[k],L=edgeLengths[j];if(x<=L||k===chain.length-1)return bez(edges[j],1-clamp01(x/(L||1)));x-=L;}};return Array.from({length:9},(_,j)=>Math.log(Math.max(1e-9,len(sub(bez(e,j/8),opposite(j/8))))));}):null;
  const widthWork=new Float64Array(9);function smoothWidth(i,t){const a=widthWork;a.set(widths[i]);for(let k=a.length-1;k>0;k--)for(let j=0;j<k;j++)a[j]=(1-t)*a[j]+t*a[j+1];return Math.exp(a[0]);}
  function sideParameter(i,s,hints){if(hints)return hints[i];const maps=options.arcMaps;if(!maps)return clamp01(s);const a=maps[i];s=clamp01(s);let lo=0,hi=a.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(a[m].t<=s)lo=m;else hi=m;}const f=(s-a[lo].t)/(a[hi].t-a[lo].t||1);return a[lo].bezierT+(a[hi].bezierT-a[lo].bezierT)*f;}
  function digonOtherParameter(i,t){const map=options.arcMaps?.[i];if(!map)return 1-t;let lo=0,hi=map.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(map[m].bezierT<=t)lo=m;else hi=m;}const r=map[lo].t+(t-map[lo].bezierT)*(map[hi].t-map[lo].t)/(map[hi].bezierT-map[lo].bezierT||1);return sideParameter(1-i,1-r);}
  const fields=edges.map((e,i)=>{
    const prev=edges[(i+n-1)%n],next=edges[(i+1)%n],d0=mul(deriv(prev,1),-1),d1=deriv(next,0),t0=tangentVector(e,0),t1=tangentVector(e,1),x0=projectPerp(d0,t0),x1=projectPerp(d1,t1);
     
     
     
    const shear0=dot(d0,t0)/(dot(t0,t0)||1),shear1=dot(d1,t1)/(dot(t1,t1)||1);
    let cum=[0],p=e[0];for(let j=1;j<=128;j++){const q=bez(e,j/128);cum.push(cum.at(-1)+len(sub(q,p)));p=q;}const total=cum.at(-1)||1;cum=cum.map(x=>x/total);
    const span=t=>n===2?len(sub(bez(edges[1-i],digonOtherParameter(i,t)),bez(e,t))):n>4?smoothWidth(i,t):n===4?len(sub(bez(edges[(i+2)%n],1-t),bez(e,t))):len(sub(edges[(i+2)%n][0],bez(e,t)));
    const s0=Math.max(1e-12,span(0)),s1=Math.max(1e-12,span(1));
    return {d0,d1,t0,t1,x0,x1,shear0,shear1,cum,span,rho0Raw:len(d0)/s0,rho1Raw:len(d1)/s1,rho0Perp:len(x0)/s0,rho1Perp:len(x1)/s1};
  });
   
   
   
   
   
   
  function oppositePairKind(i){if(n!==4)return null;const A=edges[i],B=edges[(i+2)%4].slice().reverse(),scale=Math.max(1e-12,...A.flatMap((p,a)=>A.slice(a+1).map(q=>len(sub(q,p)))),...B.flatMap((p,a)=>B.slice(a+1).map(q=>len(sub(q,p))))),tol=scale*2e-5;let congr=true;for(let a=0;a<4;a++)for(let b=a+1;b<4;b++)if(Math.abs(len(sub(A[a],A[b]))-len(sub(B[a],B[b])))>tol)congr=false;if(!congr)return null;const D=sub(B[0],A[0]);let trans=true;for(let k=1;k<4;k++)if(len(sub(sub(B[k],A[k]),D))>tol)trans=false;return trans?'translate':'rotate';}
  const pairKinds=n===4?[oppositePairKind(0),oppositePairKind(1)]:[],cellFieldKind=pairKinds.includes('rotate')?'frame':pairKinds.includes('translate')?'translate':'mixed';
  const frameConsistent=fields.map((f,i)=>{if(n!==4||len(f.d0)<1e-12||len(f.d1)<1e-12)return true;const pred=unit(rotate(rotation(f.t0,f.t1),unit(f.d0))),target=unit(f.d1);return dot(pred,target)>=.9993908270190958;});
  const quadCorrection=n===4&&(cellFieldKind==='translate'||cellFieldKind==='mixed'&&frameConsistent.some(x=>!x));
   
   
   
  const quadTranslation=n===4&&!edges.some(e=>e.pieces)&&[0,1].every(i=>{const A=edges[i],B=edges[i+2],delta=sub(B[3],A[0]),scale=Math.max(len(delta),len(sub(A[3],A[0])),1e-30);return A.every((p,k)=>len(sub(sub(B[3-k],p),delta))<=scale*1e-12);});
   
   
  const quadRuled=n===4&&!quadTranslation&&!edges.some(e=>e.pieces)?(()=>{
    function line(e){const d=sub(e[3],e[0]),l2=dot(d,d);if(!(l2>1e-24))return null;
      const w=e.map(p=>dot(sub(p,e[0]),d)/l2);
      if(w[1]<-1e-12||w[2]>1+1e-12||w[2]<w[1])return null;
      if(e.some((p,k)=>len(sub(sub(p,e[0]),mul(d,w[k])))>Math.sqrt(l2)*1e-10))return null;return w;}
    for(let base=0;base<2;base++){
      const a=line(edges[(base+1)%4]),b=line(edges[(base+3)%4].slice().reverse());
      if(a&&b&&a.every((x,k)=>Math.abs(x-b[k])<1e-10))return {base,w:a};
    }return null;
  })():null;
  const ruledWeight=t=>{const w=quadRuled.w,s=1-t;return 3*s*s*t*w[1]+3*s*t*t*w[2]+t*t*t;};
   
   
   
  const rotationFields=options.quadFamily?.kind==='rotate'?fields.map((f,i)=>{
    const side=(i-options.quadFamily.base+4)%4,axis=options.quadFamily.axis;
    if(side%2===0)return {constant:unit(f.x0)};
    const sign=side===1?1:-1,radial=mul(unit(cross(f.t0,axis)),sign),r=dot(f.x0,radial),z=dot(f.x0,axis),L=Math.hypot(r,z);
    return {axis,sign,r:r/(L||1),z:z/(L||1)};
  }):null;
  function arcFraction(i,t){const f=fields[i],x=clamp01(t)*128,k=Math.min(127,Math.floor(x));return f.cum[k]+(f.cum[k+1]-f.cum[k])*(x-k);}
  function direction(i,t){t=clamp01(t);if(rotationFields){const f=rotationFields[i];if(f.constant)return f.constant.slice();const R=mul(unit(cross(tangentVector(edges[i],t),f.axis)),f.sign);return add(mul(R,f.r),mul(f.axis,f.z));}const f=fields[i],s=arcFraction(i,t),T=tangentVector(edges[i],t);let A=rotate(rotation(f.t0,T),f.x0),B=rotate(rotation(f.t1,T),f.x1);A=unit(projectPerp(A,T));B=unit(projectPerp(B,T));if(len(A)<1e-12&&len(B)<1e-12)return [0,0,0];if(len(A)<1e-12)return B;if(len(B)<1e-12)return A;const d=dot(A,B);return d<-.9961946980917455?angular(A,B,s,unit(cross(T,A))):unit(mix(A,B,s));}
  let fieldTables=null;
  function fieldExact(i,t){
    t=clamp01(t);const f=fields[i],s=arcFraction(i,t),dir=direction(i,t),T=tangentVector(edges[i],t);
    let L;if(n===2){const a=dir,b=mul(direction(1-i,digonOtherParameter(i,t)),-1),turn=Math.acos(clamp(dot(a,b)));L=f.span(t)/(Math.cos(turn/4)**2||1);}else L=f.span(t)*((1-s)*f.rho0Perp+s*f.rho1Perp);
    const shear=(1-s)*f.shear0+s*f.shear1;
    return add(mul(dir,L),mul(T,shear));
  }
  function lookup(i,t,out=[0,0,0],segment){const tab=fieldTables[i],a=tab.samples;let lo=0,hi=a.length-1;if(t<=a[0].t){for(let k=0;k<3;k++)out[k]=tab.values[0][k];return out;}if(t>=a[hi].t){for(let k=0;k<3;k++)out[k]=tab.values[hi][k];return out;}if(segment!==undefined&&t>=a[segment].t&&t<a[segment+1].t){lo=segment;hi=segment+1;}else while(hi-lo>1){const m=(lo+hi)>>1;if(a[m].t<=t)lo=m;else hi=m;}const h=a[hi].t-a[lo].t,f=(t-a[lo].t)/(h||1),A=tab.values[lo],B=tab.values[hi];if(mode==='cubic'&&tab.slopes){const f2=f*f,f3=f2*f;for(let k=0;k<3;k++)out[k]=(2*f3-3*f2+1)*A[k]+(-2*f3+3*f2)*B[k]+h*((f3-2*f2+f)*tab.slopes[lo][k]+(f3-f2)*tab.slopes[hi][k]);}else if(mode==='nlerp'&&tab.lengths){const la=tab.lengths[lo],lb=tab.lengths[hi],L=la*(1-f)+lb*f;for(let k=0;k<3;k++)out[k]=(1-f)*A[k]/(la||1)+f*B[k]/(lb||1);const inv=L/(Math.hypot(...out)||1);for(let k=0;k<3;k++)out[k]*=inv;}else for(let k=0;k<3;k++)out[k]=(1-f)*A[k]+f*B[k];return out;}
  function field(i,t){return fieldTables?lookup(i,t):fieldExact(i,t);}
  function crossDirection(i,t){
    if(quadRuled){const {base}=quadRuled,side=(i-base+4)%4;
      if(side%2===0){const x=side===0?t:1-t,D=sub(bez(edges[base+2],1-x),bez(edges[base],x));return unit(mul(D,side===0?1:-1));}
      const x=side===1?1:0,w=ruledWeight(side===1?t:1-t),A=deriv(edges[base],x),B=mul(deriv(edges[base+2],1-x),-1);return unit(mul(mix(A,B,w),side===1?-1:1));
    }return direction(i,t);
  }
  if(['linear','nlerp','cubic'].includes(mode)){
    if(!options.edgeSamples)throw Error('Prepared edgeSamples required for field interpolation');
    fieldTables=options.edgeSamples.map((samples,i)=>{const values=samples.map(q=>fieldExact(i,q.t)),lengths=mode==='nlerp'?values.map(v=>Math.hypot(...v)):null,slopes=mode==='cubic'?values.map((v,j)=>{const a=Math.max(0,j-1),b=Math.min(values.length-1,j+1),h=samples[b].t-samples[a].t;return v.map((_,k)=>(values[b][k]-values[a][k])/(h||1));}):null;return {samples,values,lengths,slopes};});
  }
  const terminals=n===3?edges.map((e,i)=>{const k0=mul(deriv(edges[(i+n-1)%n],0),-1),k1=deriv(edges[(i+1)%n],1),x=unit(sub(e[3],e[0]));let y=sub(bez(e,.5),mix(e[0],e[3],.5));y=unit(sub(y,mul(x,dot(y,x))));const X=unit(sub(k1,k0)),m=mix(k0,k1,.5),Y=unit(sub(m,mul(X,dot(m,X))));return {k0,k1,x,y,X,Y,scale:len(sub(k1,k0))/(len(sub(e[3],e[0]))||1)};}):null;
  function terminal(i,t){const f=terminals[i],linear=mix(f.k0,f.k1,t);if(options.terminal==='lerp')return linear;const residual=sub(bez(edges[i],t),mix(edges[i][0],edges[i][3],t));return add(linear,mul(add(mul(f.X,dot(residual,f.x)),mul(f.Y,dot(residual,f.y))),f.scale));}
  const terminalPowers=n===3?terminals.map((f,i)=>{const e=edges[i],c=new Float64Array(12),R=[[],[],[]];for(let k=0;k<3;k++){R[0][k]=3*(e[1][k]-e[0][k])-(e[3][k]-e[0][k]);R[1][k]=3*(e[0][k]-2*e[1][k]+e[2][k]);R[2][k]=-e[0][k]+3*e[1][k]-3*e[2][k]+e[3][k];}for(let k=0;k<3;k++){c[k*4]=f.k0[k];for(let j=1;j<4;j++)c[k*4+j]=(j===1?f.k1[k]-f.k0[k]:0)+(options.terminal==='lerp'?0:f.scale*(f.X[k]*dot(R[j-1],f.x)+f.Y[k]*dot(R[j-1],f.y)));}return c;}):null;
  const packetScratchA=new Float64Array(6),packetScratchB=new Float64Array(6);
  function buildPacket(i,N,arc=true){const tab=new Float32Array((N+1)*6);for(let k=0;k<=N;k++){const s=k/N,t=arc?sideParameter(i,s):s,P=bez(edges[i],t),D=fieldExact(i,t),o=k*6;tab[o]=P[0];tab[o+1]=P[1];tab[o+2]=P[2];tab[o+3]=D[0];tab[o+4]=D[1];tab[o+5]=D[2];}return tab;}
  function lut(tab,N,s,stride,out){s=clamp01(s);const x=s*N,i=Math.min(N-1,Math.floor(x)),f=x-i,a=i*stride,b=a+stride;for(let k=0;k<stride;k++)out[k]=tab[a+k]+(tab[b+k]-tab[a+k])*f;return out;}
  function coefEval(tab,N,s,t,out){s=clamp01(s);const x=s*N,i=Math.min(N-1,Math.floor(x)),f=x-i,a=i*12,b=a+12;for(let c=0;c<3;c++){const j=4*c,A=tab[a+j]+(tab[b+j]-tab[a+j])*f,B=tab[a+j+1]+(tab[b+j+1]-tab[a+j+1])*f,C=tab[a+j+2]+(tab[b+j+2]-tab[a+j+2])*f,D=tab[a+j+3]+(tab[b+j+3]-tab[a+j+3])*f;out[c]=A+t*(B+t*(C+t*D));}return out;}
   
   
  const packetResolution=options.interactive?32:128;
  let fast=null;
  if(n===2){
    const N=packetResolution,p0=buildPacket(0,N,true),p1=buildPacket(1,N,true),coef=new Float32Array((N+1)*12);for(let k=0;k<=N;k++){const s=k/N,A=lut(p0,N,s,6,packetScratchA),B=lut(p1,N,1-s,6,packetScratchB),o=k*12;for(let c=0;c<3;c++){const a=A[c],b=B[c],da=A[c+3],db=B[c+3];coef[o+4*c]=a;coef[o+4*c+1]=da;coef[o+4*c+2]=-3*a+3*b-2*da+db;coef[o+4*c+3]=2*a-2*b+da-db;}}fast={N,coef};
  }else if(n===4&&!quadTranslation&&!quadRuled){
    const N=packetResolution,packets=Array.from({length:4},(_,i)=>buildPacket(i,N,false)),ac=new Float32Array((N+1)*12),db=new Float32Array((N+1)*12);const fill=(tab,i,j,fa,fb)=>{for(let k=0;k<=N;k++){const s=k/N,A=lut(packets[i],N,fa(s),6,packetScratchA),B=lut(packets[j],N,fb(s),6,packetScratchB),o=k*12;for(let c=0;c<3;c++){const a=A[c],b=B[c],da=A[c+3],dd=B[c+3];tab[o+4*c]=a;tab[o+4*c+1]=da;tab[o+4*c+2]=-3*a+3*b-2*da+dd;tab[o+4*c+3]=2*a-2*b+da-dd;}}};fill(ac,0,2,s=>s,s=>1-s);fill(db,3,1,s=>1-s,s=>s);fast={N,ac,db};
  }else if(n===5){
    const N=packetResolution,packets=Array.from({length:5},(_,i)=>buildPacket(i,N,true)),scale=1/(2*Math.sin(Math.PI/n)*Math.cos(Math.PI/n)),lines=domain.map((a,i)=>{const b=domain[(i+1)%n];return [(a[1]-b[1])*scale,(b[0]-a[0])*scale,(a[0]*b[1]-b[0]*a[1])*scale];});fast={N,packets,lines,scale:Math.min(1,Math.cos(Math.PI/n)/(2*Math.sin(Math.PI/n)))};
  }else if(n===3){
    const NH=packetResolution,NQ=packetResolution*2,nativeTabs=Array.from({length:3},(_,i)=>{const a=new Float32Array(NQ+1);for(let k=0;k<=NQ;k++)a[k]=sideParameter(i,k/NQ);return a;}),hTabs=[];
    for(let i=0;i<3;i++){const tab=new Float32Array((NH+1)*13),opp=edges[(i+2)%3][0];for(let k=0;k<=NH;k++){const r=k/NH,u=sideParameter(i,r),A=bez(edges[i],u),D=fieldExact(i,u),E=terminal(i,u),o=k*13;tab[o]=A[0];tab[o+1]=A[1];tab[o+2]=A[2];tab[o+3]=D[0];tab[o+4]=D[1];tab[o+5]=D[2];for(let c=0;c<3;c++){tab[o+6+c]=-3*A[c]+3*opp[c]-2*D[c]-E[c];tab[o+9+c]=2*A[c]-2*opp[c]+D[c]+E[c];}tab[o+12]=(options.warp===undefined?1:options.warp)*u*(1-u);}hTabs.push(tab);}
    function transportedTerminal(i,r){const e=edges[i],t=sideParameter(i,r),k0=mul(deriv(edges[(i+2)%3],0),-1),k1=deriv(edges[(i+1)%3],1),T=tangentVector(e,t),A=rotate(rotation(tangentVector(e,0),T),k0),B=rotate(rotation(tangentVector(e,1),T),k1);return mix(A,B,r);}
    function buildQRibbon(i){const packet=buildPacket(i,NQ,true),tab=new Float32Array((NQ+1)*9);for(let k=0;k<=NQ;k++){const r=k/NQ,P=lut(packet,NQ,r,6,packetScratchA),E=transportedTerminal(i,r),o=k*9;for(let c=0;c<6;c++)tab[o+c]=P[c];tab[o+6]=E[0];tab[o+7]=E[1];tab[o+8]=E[2];}return tab;}
    function bend(a,b){const A=len(a),B=len(b);if(!(A&&B))return 1;return Math.sqrt(Math.max(0,1-(clamp(dot(a,b)/(A*B)))**2));}
    function regularity(r,m=10){r=clamp01(r);const a=r**m,b=(1-r)**m;return a/(a+b||1);}
    const weights=[];for(let v=0;v<3;v++){const prev=edges[(v+2)%3],next=edges[v],tp=mul(tangentVector(prev,1),-1),tn=tangentVector(next,0),cp=sub(prev[0],prev[3]),cn=sub(next[3],next[0]),rho=Math.max(bend(tp,cp),bend(tn,cn));weights.push(1-regularity(rho));}
     
     
     
     
    const frameMap=(a1,a2,b1,b2,x)=>{a1=unit(a1);let aY=unit(projectPerp(a2,a1)),aZ=unit(cross(a1,aY));b1=unit(b1);let bY=unit(projectPerp(b2,b1)),bZ=unit(cross(b1,bY));if(len(aY)<1e-12||len(bY)<1e-12)return null;return add(add(mul(b1,dot(x,a1)),mul(bY,dot(x,aY))),mul(bZ,dot(x,aZ)));};
    const sym=new Float64Array(3);
    for(let v=0;v<3;v++){
      const ra=v,rb=(v+2)%3,opp=(v+1)%3,P=edges[v][0],va=sub(edges[ra][3],P),vb=sub(edges[rb][0],P),La=len(va),Lb=len(vb);if(!(La>1e-12&&Lb>1e-12))continue;
      const Ta=tangentVector(edges[opp],0),Tb=tangentVector(edges[opp],1);let e2=0,c=0;
      for(const r of [.2,.4,.6,.8]){const A=sub(bez(edges[ra],sideParameter(ra,r)),P),B=sub(bez(edges[rb],sideParameter(rb,1-r)),P),Q=frameMap(va,Ta,vb,Tb,A);if(!Q)continue;const d=len(sub(Q,B))/Math.max(1e-12,.5*(La+Lb));e2+=d*d;c++;}
      if(c){const lenErr=Math.abs(La-Lb)/Math.max(La,Lb),err=Math.sqrt(e2/c+lenErr*lenErr),x=err/.01;sym[v]=1/(1+x*x*x*x);}
    }
    for(let v=0;v<3;v++){const unique=sym[v]*(1-sym[(v+1)%3])*(1-sym[(v+2)%3]);weights[v]=1-(1-weights[v])*(1-unique);}
    const reg=weights.reduce((p,s)=>p*(1-s),1),cut=2e-4,activeH=reg>cut,active=weights.map(w=>w>cut),den=(activeH?reg:0)+weights.reduce((sum,w,i)=>sum+(active[i]?w:0),0);
     
     
    const qTabs=Array.from({length:3},(_,i)=>active[(i+2)%3]?buildQRibbon(i):null);fast={NH,NQ,hTabs,qTabs,nativeTabs,reg,weights,den,activeH,active};
  }
  const temp0=new Float64Array(6), out0=new Float64Array(3), out1=new Float64Array(3), out2=new Float64Array(3), qout=new Float64Array(3), triL=new Float64Array(3), ngonD=new Float64Array(5);
  function hRibbon(tab,N,r,v,out){r=clamp01(r);const x=r*N,i=Math.min(N-1,Math.floor(x)),f=x-i,a=i*13,b=a+13,A0=tab[a]+(tab[b]-tab[a])*f,A1=tab[a+1]+(tab[b+1]-tab[a+1])*f,A2=tab[a+2]+(tab[b+2]-tab[a+2])*f,D0=tab[a+3]+(tab[b+3]-tab[a+3])*f,D1=tab[a+4]+(tab[b+4]-tab[a+4])*f,D2=tab[a+5]+(tab[b+5]-tab[a+5])*f,C0=tab[a+6]+(tab[b+6]-tab[a+6])*f,C1=tab[a+7]+(tab[b+7]-tab[a+7])*f,C2=tab[a+8]+(tab[b+8]-tab[a+8])*f,F0=tab[a+9]+(tab[b+9]-tab[a+9])*f,F1=tab[a+10]+(tab[b+10]-tab[a+10])*f,F2=tab[a+11]+(tab[b+11]-tab[a+11])*f,hh=tab[a+12]+(tab[b+12]-tab[a+12])*f,t=v+hh*v*(1-v);out[0]=A0+t*(D0+t*(C0+t*F0));out[1]=A1+t*(D1+t*(C1+t*F1));out[2]=A2+t*(D2+t*(C2+t*F2));return out;}
  function nativeLut(tab,N,s){s=clamp01(s);const x=s*N,i=Math.min(N-1,Math.floor(x)),f=x-i;return tab[i]+(tab[i+1]-tab[i])*f;}
  function qRibbon(l,i,out){const j=(i+1)%3,k=(i+2)%3,den=l[i]+l[j],r=den>1e-14?l[j]/den:.5,v=l[k],N=fast.NQ,tab=fast.qTabs[i],x=r*N,ii=Math.min(N-1,Math.floor(x)),f=x-ii,a=ii*9,b=a+9,A0=tab[a]+(tab[b]-tab[a])*f,A1=tab[a+1]+(tab[b+1]-tab[a+1])*f,A2=tab[a+2]+(tab[b+2]-tab[a+2])*f,D0=tab[a+3]+(tab[b+3]-tab[a+3])*f,D1=tab[a+4]+(tab[b+4]-tab[a+4])*f,D2=tab[a+5]+(tab[b+5]-tab[a+5])*f,E0=tab[a+6]+(tab[b+6]-tab[a+6])*f,E1=tab[a+7]+(tab[b+7]-tab[a+7])*f,E2=tab[a+8]+(tab[b+8]-tab[a+8])*f,nt0=nativeLut(fast.nativeTabs[k],N,1-v),nt1=nativeLut(fast.nativeTabs[j],N,v),t=(1-r)*(1-nt0)+r*nt1,tt=t*t,ttt=tt*t,h00=2*ttt-3*tt+1,h10=ttt-2*tt+t,h01=1-h00,h11=ttt-tt,B=edges[k][0];out[0]=h00*A0+h10*D0+h01*B[0]+h11*E0;out[1]=h00*A1+h10*D1+h01*B[1]+h11*E1;out[2]=h00*A2+h10*D2+h01*B[2]+h11*E2;return out;}
  function triEvalInto(u,v,out){let l0=Math.max(0,1-u-v),l1=Math.max(0,u),l2=Math.max(0,v);const eps=1e-13;if(l2<=eps){const r=l1/(l0+l1||1),P=bez(edges[0],sideParameter(0,r));out[0]=P[0];out[1]=P[1];out[2]=P[2];return out;}if(l0<=eps){const r=l2/(l1+l2||1),P=bez(edges[1],sideParameter(1,r));out[0]=P[0];out[1]=P[1];out[2]=P[2];return out;}if(l1<=eps){const r=l0/(l2+l0||1),P=bez(edges[2],sideParameter(2,r));out[0]=P[0];out[1]=P[1];out[2]=P[2];return out;}triL[0]=l0;triL[1]=l1;triL[2]=l2;let x=0,y=0,z=0;if(fast.activeH){hRibbon(fast.hTabs[0],fast.NH,l1/(l0+l1),l2,out0);hRibbon(fast.hTabs[1],fast.NH,l2/(l1+l2),l0,out1);hRibbon(fast.hTabs[2],fast.NH,l0/(l2+l0),l1,out2);const w0=(l0*l1)**2,w1=(l1*l2)**2,w2=(l2*l0)**2,W=w0+w1+w2||1,iv=fast.reg/W;x+=(out0[0]*w0+out1[0]*w1+out2[0]*w2)*iv;y+=(out0[1]*w0+out1[1]*w1+out2[1]*w2)*iv;z+=(out0[2]*w0+out1[2]*w1+out2[2]*w2)*iv;}for(let vert=0;vert<3;vert++)if(fast.active[vert]){const side=(vert+1)%3;qRibbon(triL,side,qout);const w=fast.weights[vert];x+=qout[0]*w;y+=qout[1]*w;z+=qout[2]*w;}const inv=1/(fast.den||1);out[0]=x*inv;out[1]=y*inv;out[2]=z*inv;return out;}
  function evalInto(u,v,out){
    if(quadRuled){const {base}=quadRuled,x=base?v:u,y=base?1-u:v,w=ruledWeight(y),A=bez(edges[base],x),B=bez(edges[base+2],1-x);for(let k=0;k<3;k++)out[k]=A[k]+w*(B[k]-A[k]);return out;}
    if(quadTranslation){const A=bez(edges[0],u),B=bez(edges[1],v),C=edges[0][3];for(let k=0;k<3;k++)out[k]=A[k]+B[k]-C[k];return out;}
    if(options.model==='linear'){
      const coord=n===4?[[u,v],[v,1-u],[1-u,1-v],[1-v,u]]:(()=>{const l=[Math.max(0,1-u-v),u,v];return l.map((x,i)=>[l[(i+1)%3]/(x+l[(i+1)%3]||1),l[(i+2)%3]]);})();let sum=0;out[0]=out[1]=out[2]=0;for(let i=0;i<n;i++){const [t,d]=coord[i];if(d<1e-14){const P=bez(edges[i],t);out[0]=P[0];out[1]=P[1];out[2]=P[2];return out;}const w=1/(d*d),P=bez(edges[i],t),D=field(i,t);out[0]+=(P[0]+D[0]*d)*w;out[1]+=(P[1]+D[1]*d)*w;out[2]+=(P[2]+D[2]*d)*w;sum+=w;}out[0]/=sum;out[1]/=sum;out[2]/=sum;return out;
    }
    if(n===3)return triEvalInto(u,v,out);
    if(n===2){if(u<=0){const P=edges[0][0];out[0]=P[0];out[1]=P[1];out[2]=P[2];return out;}if(u>=1){const P=edges[0][3];out[0]=P[0];out[1]=P[1];out[2]=P[2];return out;}if(v<=1e-14){const P=bez(edges[0],sideParameter(0,u));out[0]=P[0];out[1]=P[1];out[2]=P[2];return out;}if(v>=1-1e-14){const P=bez(edges[1],sideParameter(1,1-u));out[0]=P[0];out[1]=P[1];out[2]=P[2];return out;}return coefEval(fast.coef,fast.N,u,v,out);}
    if(n===4){if(v<=1e-14){const P=bez(edges[0],u);out[0]=P[0];out[1]=P[1];out[2]=P[2];return out;}if(u>=1-1e-14){const P=bez(edges[1],v);out[0]=P[0];out[1]=P[1];out[2]=P[2];return out;}if(v>=1-1e-14){const P=bez(edges[2],1-u);out[0]=P[0];out[1]=P[1];out[2]=P[2];return out;}if(u<=1e-14){const P=bez(edges[3],1-v);out[0]=P[0];out[1]=P[1];out[2]=P[2];return out;}const a=(u*(1-u))**2,b=(v*(1-v))**2;coefEval(fast.ac,fast.N,u,v,out0);coefEval(fast.db,fast.N,v,u,out1);const w=a/(a+b||1);out[0]=out1[0]+(out0[0]-out1[0])*w;out[1]=out1[1]+(out0[1]-out1[1])*w;out[2]=out1[2]+(out0[2]-out1[2])*w;if(quadCorrection){let tx,ty,tz;if(cellFieldKind==='translate'){const A=bez(edges[0],u),B=bez(edges[1],v),C=edges[0][3];tx=A[0]+B[0]-C[0];ty=A[1]+B[1]-C[1];tz=A[2]+B[2]-C[2];}else{const B0=bez(edges[0],u),R=bez(edges[1],v),T=bez(edges[2],1-u),L=bez(edges[3],1-v),P00=edges[0][0],P10=edges[0][3],P11=edges[1][3],P01=edges[2][3],iu=1-u,iv=1-v;tx=iv*B0[0]+v*T[0]+iu*L[0]+u*R[0]-(iu*iv*P00[0]+u*iv*P10[0]+u*v*P11[0]+iu*v*P01[0]);ty=iv*B0[1]+v*T[1]+iu*L[1]+u*R[1]-(iu*iv*P00[1]+u*iv*P10[1]+u*v*P11[1]+iu*v*P01[1]);tz=iv*B0[2]+v*T[2]+iu*L[2]+u*R[2]-(iu*iv*P00[2]+u*iv*P10[2]+u*v*P11[2]+iu*v*P01[2]);}const qx=4*u*(1-u),qy=4*v*(1-v),hx=qx*qx/(qx*qx+.01*(1-qx)*(1-qx)),hy=qy*qy/(qy*qy+.01*(1-qy)*(1-qy)),bw=hx*hy;out[0]+=bw*(tx-out[0]);out[1]+=bw*(ty-out[1]);out[2]+=bw*(tz-out[2]);}return out;}
    let mn=Infinity;for(let i=0;i<n;i++){const L=fast.lines[i],d=Math.abs(L[0]*u+L[1]*v+L[2]);ngonD[i]=d;mn=Math.min(mn,d);}let sx=0,sy=0,sz=0,sw=0;for(let i=0;i<n;i++){const a=ngonD[(i+n-1)%n],b=ngonD[(i+1)%n],s=a/(a+b||1),di=ngonD[i];if(di<1e-12){const P=bez(edges[i],sideParameter(i,s));out[0]=P[0];out[1]=P[1];out[2]=P[2];return out;}const q=lut(fast.packets[i],fast.N,s,6,temp0),w=(mn/di)**2,f=fast.scale*di/(1+2*di);sx+=(q[0]+q[3]*f)*w;sy+=(q[1]+q[4]*f)*w;sz+=(q[2]+q[5]*f)*w;sw+=w;}const inv=1/(sw||1);out[0]=sx*inv;out[1]=sy*inv;out[2]=sz*inv;return out;
  }
  function evaluate(u,v){const out=[0,0,0];evalInto(u,v,out);return out;}
   
   
  function triDifferential(x,y,firstOrder=false){
    const count=firstOrder?3:6,l=[1-x-y,x,y],gx=[-1,1,0],gy=[-1,0,1],S=Array.from({length:count},()=>[0,0,0]),W=new Float64Array(count);
    for(let i=0;i<3;i++){
      const j=(i+1)%3,k=(i+2)%3,a=l[i],b=l[j],den=a+b;if(den<1e-14)continue;
      const dx=gx[i]+gx[j],dy=gy[i]+gy[j],r=b/den;let u=r,scale=1;
      if(options.arcMaps){const map=options.arcMaps[i];let lo=0,hi=map.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(map[m].t<=r)lo=m;else hi=m;}scale=(map[hi].bezierT-map[lo].bezierT)/(map[hi].t-map[lo].t||1);u=map[lo].bezierT+(r-map[lo].t)*scale;}
      const ux=(gx[j]-r*dx)/den*scale,uy=(gy[j]-r*dy)/den*scale,uxx=-2*ux*dx/den,uyy=-2*uy*dy/den,uxy=-(ux*dy+uy*dx)/den,v=l[k],vx=gx[k],vy=gy[k];
      const ab=a*b,abx=gx[i]*b+a*gx[j],aby=gy[i]*b+a*gy[j],w=[ab*ab,2*ab*abx,2*ab*aby];if(!firstOrder)w.push(2*abx*abx+4*ab*gx[i]*gx[j],2*abx*aby+2*ab*(gx[i]*gy[j]+gy[i]*gx[j]),2*aby*aby+4*ab*gy[i]*gy[j]);for(let d=0;d<count;d++)W[d]+=w[d];
      let edge=edges[i],z=u,es=1;if(edge.pieces){const piece=pieceAt(edge,u);edge=edge.pieces[piece[0]];z=piece[1];es=1/piece[2];}
      const tab=fieldTables[i];let lo=0,hi=tab.samples.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(tab.samples[m].t<=u)lo=m;else hi=m;}const fh=tab.samples[hi].t-tab.samples[lo].t,ff=(u-tab.samples[lo].t)/(fh||1);
      const warp=options.warp===undefined?1:options.warp,h=u*(1-u),g=v*(1-v),t=v+warp*h*g,tu=warp*(1-2*u)*g,tv=1+warp*h*(1-2*v),tuu=-2*warp*g,tuv=warp*(1-2*u)*(1-2*v),tvv=-2*warp*h,tc=terminalPowers[i],terminalData=terminals[i];
      const B=bez(edge,z),Bd=mul(deriv(edge,z),es),Bdd=firstOrder?null:edge[0].map((_,c)=>6*((1-z)*(edge[2][c]-2*edge[1][c]+edge[0][c])+z*(edge[3][c]-2*edge[2][c]+edge[1][c]))*es*es);let terminalValues,terminalFirst,terminalSecond;
      if(edges[i].pieces){const chord=sub(edges[i][3],edges[i][0]), Rd=sub(Bd,chord), transform=q=>mul(add(mul(terminalData.X,dot(q,terminalData.x)),mul(terminalData.Y,dot(q,terminalData.y))),terminalData.scale);terminalValues=terminal(i,u);terminalFirst=add(sub(terminalData.k1,terminalData.k0),options.terminal==='lerp'?[0,0,0]:transform(Rd));if(!firstOrder)terminalSecond=options.terminal==='lerp'?[0,0,0]:transform(Bdd);}
      for(let c=0;c<3;c++){
        const o=c*4,A=B[c],Au=Bd[c],Auu=firstOrder?0:Bdd[c],D=tab.values[lo][c]+ff*(tab.values[hi][c]-tab.values[lo][c]),Du=(tab.values[hi][c]-tab.values[lo][c])/(fh||1),E=terminalValues?terminalValues[c]:tc[o]+u*(tc[o+1]+u*(tc[o+2]+u*tc[o+3])),Eu=terminalFirst?terminalFirst[c]:tc[o+1]+u*(2*tc[o+2]+3*u*tc[o+3]),Euu=terminalSecond?terminalSecond[c]:2*tc[o+2]+6*u*tc[o+3];
        const C=-3*A+3*edges[k][0][c]-2*D-E,F=2*A-2*edges[k][0][c]+D+E,Cu=-3*Au-2*Du-Eu,Fu=2*Au+Du+Eu,Cuu=-3*Auu-Euu,Fuu=2*Auu+Euu,q=A+t*(D+t*(C+t*F)),qt=D+t*(2*C+3*t*F),qtt=2*C+6*t*F,qut=Du+t*(2*Cu+3*t*Fu),qu=Au+t*(Du+t*(Cu+t*Fu))+qt*tu,qv=qt*tv,qx=qu*ux+qv*vx,qy=qu*uy+qv*vy;
        S[0][c]+=w[0]*q;S[1][c]+=w[1]*q+w[0]*qx;S[2][c]+=w[2]*q+w[0]*qy;if(firstOrder)continue;
        const quu=Auu+t*t*(Cuu+t*Fuu)+2*qut*tu+qtt*tu*tu+qt*tuu,quv=qut*tv+qtt*tu*tv+qt*tuv,qvv=qtt*tv*tv+qt*tvv,qxx=quu*ux*ux+2*quv*ux*vx+qvv*vx*vx+qu*uxx,qxy=quu*ux*uy+quv*(ux*vy+uy*vx)+qvv*vx*vy+qu*uxy,qyy=quu*uy*uy+2*quv*uy*vy+qvv*vy*vy+qu*uyy;
        S[3][c]+=w[3]*q+2*w[1]*qx+w[0]*qxx;S[4][c]+=w[4]*q+w[1]*qy+w[2]*qx+w[0]*qxy;S[5][c]+=w[5]*q+2*w[2]*qy+w[0]*qyy;
      }
    }
    if(W[0]<1e-28)throw Error('Tri differential requires a non-corner point');for(let c=0;c<3;c++){S[0][c]/=W[0];S[1][c]=(S[1][c]-W[1]*S[0][c])/W[0];S[2][c]=(S[2][c]-W[2]*S[0][c])/W[0];if(firstOrder)continue;S[3][c]=(S[3][c]-W[3]*S[0][c]-2*W[1]*S[1][c])/W[0];S[4][c]=(S[4][c]-W[4]*S[0][c]-W[1]*S[2][c]-W[2]*S[1][c])/W[0];S[5][c]=(S[5][c]-W[5]*S[0][c]-2*W[2]*S[2][c])/W[0];}
    return firstOrder?{p:S[0],du:S[1],dv:S[2]}:{p:S[0],du:S[1],dv:S[2],duu:S[3],duv:S[4],dvv:S[5]};
  }
   
   
   
  const qTerminalJets=n===3?fast.qTabs.map((tab,side)=>{if(!fast.active[(side+2)%3])return null;const N=fast.NQ,out=new Float64Array((N+1)*6);for(let i=0;i<=N;i++)for(let c=0;c<3;c++){const a=Math.max(0,Math.min(N-2,i-1)),j=i-a,A=tab[a*9+6+c],B=tab[(a+1)*9+6+c],C=tab[(a+2)*9+6+c];out[i*6+c]=N*((B-A)+(j-.5)*(C-2*B+A));out[i*6+3+c]=N*N*(C-2*B+A);}return out;}):null;
  function arcJet(i,r){const a=options.arcMaps?.[i];if(!a)return [r,1];let lo=0,hi=a.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(a[m].t<=r)lo=m;else hi=m;}const s=(a[hi].bezierT-a[lo].bezierT)/(a[hi].t-a[lo].t);return [a[lo].bezierT+(r-a[lo].t)*s,s];}
  function qDifferential(x,y,side,firstOrder){
    const l=[1-x-y,x,y],gx=[-1,1,0],gy=[-1,0,1],i=side,j=(i+1)%3,k=(i+2)%3,den=l[i]+l[j],r=l[j]/den,v=l[k],dx=gx[i]+gx[j],dy=gy[i]+gy[j],rx=(gx[j]-r*dx)/den,ry=(gy[j]-r*dy)/den,rxx=-2*rx*dx/den,rxy=-(rx*dy+ry*dx)/den,ryy=-2*ry*dy/den,vx=gx[k],vy=gy[k];
    const [native,slope]=arcJet(i,r),[a,da]=arcJet(k,1-v),[b,db]=arcJet(j,v),t=(1-r)*(1-a)+r*b,tr=b-(1-a),tv=(1-r)*da+r*db,trv=db-da;
    let edge=edges[i],z=native,es=slope;if(edge.pieces){const p=pieceAt(edge,native);edge=edge.pieces[p[0]];z=p[1];es/=p[2];}
    const P=bez(edge,z),Pr=mul(deriv(edge,z),es),tab=fast.qTabs[i],N=fast.NQ,f=r*N,at=Math.min(N-1,Math.floor(f)),mix=f-at,J=qTerminalJets[i],out=Array.from({length:firstOrder?3:6},()=>[0,0,0]);
    for(let c=0;c<3;c++){
      const o=at*9+c,D=tab[o+3]+mix*(tab[o+12]-tab[o+3]),Dr=N*(tab[o+12]-tab[o+3]),E=tab[o+6]+mix*(tab[o+15]-tab[o+6]),Er=J[at*6+c]+mix*(J[(at+1)*6+c]-J[at*6+c]),Err=J[at*6+c+3]+mix*(J[(at+1)*6+c+3]-J[at*6+c+3]),Prr=6*((1-z)*(edge[2][c]-2*edge[1][c]+edge[0][c])+z*(edge[3][c]-2*edge[2][c]+edge[1][c]))*es*es;
      const C=-3*P[c]+3*edges[k][0][c]-2*D-E,F=2*P[c]-2*edges[k][0][c]+D+E,Cr=-3*Pr[c]-2*Dr-Er,Fr=2*Pr[c]+Dr+Er,Crr=-3*Prr-Err,Frr=2*Prr+Err,qt=D+t*(2*C+3*t*F),qtt=2*C+6*t*F,qrt=Dr+t*(2*Cr+3*t*Fr),qr=Pr[c]+t*(Dr+t*(Cr+t*Fr))+qt*tr,qv=qt*tv;
      out[0][c]=P[c]+t*(D+t*(C+t*F));out[1][c]=qr*rx+qv*vx;out[2][c]=qr*ry+qv*vy;
      if(!firstOrder){const qrr=Prr+t*t*(Crr+t*Frr)+2*qrt*tr+qtt*tr*tr,qrv=qrt*tv+qtt*tr*tv+qt*trv,qvv=qtt*tv*tv;out[3][c]=qrr*rx*rx+2*qrv*rx*vx+qvv*vx*vx+qr*rxx;out[4][c]=qrr*rx*ry+qrv*(rx*vy+ry*vx)+qvv*vx*vy+qr*rxy;out[5][c]=qrr*ry*ry+2*qrv*ry*vy+qvv*vy*vy+qr*ryy;}
    }
    return firstOrder?{p:out[0],du:out[1],dv:out[2]}:{p:out[0],du:out[1],dv:out[2],duu:out[3],duv:out[4],dvv:out[5]};
  }
  function triSurfaceDifferential(u,v,firstOrder=false){
    if(!fast.active.some(Boolean))return triDifferential(u,v,firstOrder);
    const names=firstOrder?['p','du','dv']:['p','du','dv','duu','duv','dvv'],out={};for(const name of names)out[name]=[0,0,0];
    const accumulate=(q,w)=>{for(const name of names)for(let c=0;c<3;c++)out[name][c]+=q[name][c]*w;};
    if(fast.activeH)accumulate(triDifferential(u,v,firstOrder),fast.reg/fast.den);
    for(let vertex=0;vertex<3;vertex++)if(fast.active[vertex])accumulate(qDifferential(u,v,(vertex+1)%3,firstOrder),fast.weights[vertex]/fast.den);
    return out;
  }
  function digonDifferential(u,v){
    const jets=[];for(let i=0;i<2;i++){const r=i?1-u:u,sign=i?-1:1,map=options.arcMaps?.[i];let t=r,dt=sign;if(map){let lo=0,hi=map.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(map[m].t<=r)lo=m;else hi=m;}const scale=(map[hi].bezierT-map[lo].bezierT)/(map[hi].t-map[lo].t||1);t=map[lo].bezierT+(r-map[lo].t)*scale;dt*=scale;}let e=edges[i],z=t,dz=dt;if(e.pieces){const [j,q,w]=pieceAt(e,t);e=e.pieces[j];z=q;dz/=w;}const P=bez(e,z),Pu=mul(deriv(e,z),dz),Puu=e[0].map((_,k)=>6*((1-z)*(e[2][k]-2*e[1][k]+e[0][k])+z*(e[3][k]-2*e[2][k]+e[1][k]))*dz*dz),tab=fieldTables[i];let lo=0,hi=tab.samples.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(tab.samples[m].t<=t)lo=m;else hi=m;}const h=tab.samples[hi].t-tab.samples[lo].t,f=(t-tab.samples[lo].t)/(h||1),D=tab.values[lo].map((a,k)=>a+(tab.values[hi][k]-a)*f),Du=tab.values[lo].map((a,k)=>(tab.values[hi][k]-a)*dt/(h||1));jets.push({P,Pu,Puu,D,Du});}
    const A=jets[0],B=jets[1],out={p:[],du:[],dv:[],duu:[],duv:[],dvv:[]};for(let k=0;k<3;k++){const a=A.P[k],b=A.D[k],c=-3*a+3*B.P[k]-2*b+B.D[k],d=2*a-2*B.P[k]+b-B.D[k],au=A.Pu[k],bu=A.Du[k],cu=-3*au+3*B.Pu[k]-2*bu+B.Du[k],du=2*au-2*B.Pu[k]+bu-B.Du[k],auu=A.Puu[k],cuu=-3*auu+3*B.Puu[k],duu=2*auu-2*B.Puu[k];out.p[k]=a+v*(b+v*(c+v*d));out.du[k]=au+v*(bu+v*(cu+v*du));out.dv[k]=b+v*(2*c+3*v*d);out.duu[k]=auu+v*v*(cuu+v*duu);out.duv[k]=bu+v*(2*cu+3*v*du);out.dvv[k]=2*c+6*v*d;}return out;
  }
  function evaluateGrid(xs,ys,out,offset){
    if(n!==4||quadRuled||(!quadTranslation&&quadCorrection))return false;
     
    if(xs.length*ys.length<(quadTranslation?64:384))return false;
    if(quadTranslation){
      const A=Array.from(xs,u=>bez(edges[0],u)),B=Array.from(ys,v=>bez(edges[1],v)),C=edges[0][3];
      for(let j=0;j<ys.length;j++)for(let i=0;i<xs.length;i++){const at=offset+3*(j*xs.length+i);for(let k=0;k<3;k++)out[at+k]=A[i][k]+B[j][k]-C[k];if(!Number.isFinite(out[at]+out[at+1]+out[at+2]))throw Error('SurfaceBuilder: non-finite grid position');}
    }else{
       
       
      const coefficients=(tab,values)=>Array.from(values,s=>{const a=new Float64Array(12),x=clamp01(s)*fast.N,i=Math.min(fast.N-1,Math.floor(x)),f=x-i,o=i*12;for(let c=0;c<12;c++)a[c]=tab[o+c]+(tab[o+12+c]-tab[o+c])*f;return a;});
      const A=coefficients(fast.ac,xs),B=coefficients(fast.db,ys);
      for(let j=0;j<ys.length;j++){const v=ys[j],b=(v*(1-v))**2;for(let i=0;i<xs.length;i++){const u=xs[i],a=(u*(1-u))**2,w=a/(a+b||1),at=offset+3*(j*xs.length+i),P=A[i],Q=B[j];for(let c=0;c<3;c++){const k=c*4,x=P[k]+v*(P[k+1]+v*(P[k+2]+v*P[k+3])),y=Q[k]+u*(Q[k+1]+u*(Q[k+2]+u*Q[k+3]));out[at+c]=y+(x-y)*w;}if(!Number.isFinite(out[at]+out[at+1]+out[at+2]))throw Error('SurfaceBuilder: non-finite grid position');}}
    }
    return true;
  }
  return {evaluate,evaluateInto:evalInto,evaluateGrid,crossDirection,tangents:n===3?(u,v)=>triSurfaceDifferential(u,v,true):null,differential:n===2?digonDifferential:n===3?triSurfaceDifferential:null,evaluateProjected:(u,v)=>evaluate(u,v),field,edges,n,options,domain,quadTranslation,quadRuled,quadCorrection:quadCorrection?cellFieldKind:null};
}
return {make,bez,deriv,tangentVector,cloneEdge,add,sub,mul,dot,cross,len,unit,mix,rotation,rotate,angular};
})();

const FrameAngleSampler=(()=>{
var add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], len = (a) => Math.hypot(a[0], a[1], a[2]), dist = (a, b) => len(sub(a, b));
function segmentPoints(data, segmentOrId) {
  let s = typeof segmentOrId == "string" ? data.segments[segmentOrId] : segmentOrId;
  if (!s) return null;
  let a = data.vertices[s.a], b = data.vertices[s.b];
  return !a || !b ? null : [a, add(a, s.ha), add(b, s.hb), b];
}
function cubicPoint(points, t) {
  let [a, b, c, d] = points, u = 1 - t, uu = u * u, tt = t * t;
  return [u * uu * a[0] + 3 * uu * t * b[0] + 3 * u * tt * c[0] + tt * t * d[0], u * uu * a[1] + 3 * uu * t * b[1] + 3 * u * tt * c[1] + tt * t * d[1], u * uu * a[2] + 3 * uu * t * b[2] + 3 * u * tt * c[2] + tt * t * d[2]];
}
function cubicDerivative(points, t) {
  let [a, b, c, d] = points, u = 1 - t;
  return [3 * u * u * (b[0] - a[0]) + 6 * u * t * (c[0] - b[0]) + 3 * t * t * (d[0] - c[0]), 3 * u * u * (b[1] - a[1]) + 6 * u * t * (c[1] - b[1]) + 3 * t * t * (d[1] - c[1]), 3 * u * u * (b[2] - a[2]) + 6 * u * t * (c[2] - b[2]) + 3 * t * t * (d[2] - c[2])];
}
function cubicSecondDerivative(points, t) {
  let [a, b, c, d] = points;
  return [6 * ((1 - t) * (c[0] - 2 * b[0] + a[0]) + t * (d[0] - 2 * c[0] + b[0])), 6 * ((1 - t) * (c[1] - 2 * b[1] + a[1]) + t * (d[1] - 2 * c[1] + b[1])), 6 * ((1 - t) * (c[2] - 2 * b[2] + a[2]) + t * (d[2] - 2 * c[2] + b[2]))];
}
function tangentAt(points, t, side = 0) {
  let d = cubicDerivative(points, t), n = len(d);
  if (n > 1e-11) return mul(d, 1 / n);
  let direction = side || (t >= 1 ? -1 : 1);
  for (let h = 1e-8; h <= 0.01; h *= 10) {
    let q = Math.max(0, Math.min(1, t + direction * h));
    if (d = cubicDerivative(points, q), n = len(d), n > 1e-11) return mul(d, 1 / n);
  }
  return [0, 0, 0];
}
function angularSpeed(points, t) {
  let d = cubicDerivative(points, t), n2 = dot(d, d);
  return n2 < 1e-22 ? 0 : len(cross(d, cubicSecondDerivative(points, t))) / n2;
}
function simpsonAngle(points, a, b) {
  let m = (a + b) / 2;
  return (b - a) * (angularSpeed(points, a) + 4 * angularSpeed(points, m) + angularSpeed(points, b)) / 6;
}
function angleLeaves(points, a, b, tol, depth = 0, whole = simpsonAngle(points, a, b), out = []) {
  let m = (a + b) / 2, l = simpsonAngle(points, a, m), r = simpsonAngle(points, m, b), sum = l + r;
  return depth >= 22 || Math.abs(sum - whole) <= 15 * tol ? (out.push({ a, b, theta: Math.max(0, sum + (sum - whole) / 15) }), out) : (angleLeaves(points, a, m, tol / 2, depth + 1, l, out), angleLeaves(points, m, b, tol / 2, depth + 1, r, out), out);
}
function stationaryParameters(points) {
  let scale = Math.max(1, ...points.slice(1).map((p, i) => dist(p, points[i]))), eps = scale * 1e-9, candidates = [], previous = len(cubicDerivative(points, 0));
  for (let i = 1; i < 256; i++) {
    let t = i / 256, current = len(cubicDerivative(points, t)), next = len(cubicDerivative(points, (i + 1) / 256));
    if (current <= previous && current <= next) {
      let a = (i - 1) / 256, b = (i + 1) / 256;
      for (let k = 0; k < 40; k++) {
        let m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
        len(cubicDerivative(points, m1)) < len(cubicDerivative(points, m2)) ? b = m2 : a = m1;
      }
      let root = (a + b) / 2;
      len(cubicDerivative(points, root)) <= eps && !candidates.some((x) => Math.abs(x - root) < 1e-6) && candidates.push(root);
    }
    previous = current;
  }
  return candidates;
}
function angleMap(points) {
  let stationary = stationaryParameters(points), cuts = [0, ...stationary, 1].sort((a, b) => a - b), leaves = [];
  for (let i = 1; i < cuts.length; i++) {
    let a = cuts[i - 1], b = cuts[i];
    b - a > 1e-12 && angleLeaves(points, a, b, 1e-9, 0, simpsonAngle(points, a, b), leaves);
  }
  let total = 0, table = [{ t: 0, theta: 0 }];
  for (let leaf of leaves)
    total += leaf.theta, table.push({ t: leaf.b, theta: total });
  return { table, total, stationary };
}
function invertAngle(points, map, target) {
  if (target <= 0) return 0;
  if (target >= map.total) return 1;
  let lo = 0, hi = map.table.length - 1;
  for (; hi - lo > 1; ) {
    let m = lo + hi >> 1;
    map.table[m].theta < target ? lo = m : hi = m;
  }
  let row = map.table[lo], end = map.table[hi], base = row.theta, baseT = row.t, a = baseT, b = end.t, t = a + (b - a) * (target - base) / (end.theta - base);
  for (let i = 0; i < 24; i++) {
    let theta = base + angleLeaves(points, baseT, t, 1e-10, 0, simpsonAngle(points, baseT, t), []).reduce((v, x) => v + x.theta, 0), f = theta - target;
    if (Math.abs(f) < 1e-10) return t;
    f > 0 ? b = t : a = t;
    let w = angularSpeed(points, t), next = w > 1e-12 ? t - f / w : NaN;
    t = Number.isFinite(next) && next > a && next < b ? next : (a + b) / 2;
  }
  return t;
}
var angleSampleCache = /* @__PURE__ */ new Map(), ANGLE_CACHE_LIMIT = 2048;
 
 
function shortEndpointSamples(points, angle) {
  const delta=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],L=a=>Math.hypot(...a);
  const size=Math.max(...points.slice(1).map(p=>L(delta(p,points[0]))));
  if(!(size>0)||Math.min(L(delta(points[1],points[0])),L(delta(points[3],points[2])))>size*1e-5)return null;
  const tolerance=64*Number.EPSILON*size,limit=angle*Math.PI/180;
  const local=points.map(p=>delta(p,points[0])),out=[{t:0,position:points[0].slice()}],stack=[{p:local,a:0,b:1,depth:0}];let precisionLimited=false;
  const turn=(a,b)=>{const la=L(a),lb=L(b);if(!la||!lb)return 0;const A=a.map(x=>x/la),B=b.map(x=>x/lb);return Math.atan2(L([A[1]*B[2]-A[2]*B[1],A[2]*B[0]-A[0]*B[2],A[0]*B[1]-A[1]*B[0]]),A[0]*B[0]+A[1]*B[1]+A[2]*B[2]);};
  const middle=(a,b)=>a.map((x,k)=>(x+b[k])*.5);
  while(stack.length){
    const s=stack.pop(),p=s.p,legs=[delta(p[1],p[0]),delta(p[2],p[1]),delta(p[3],p[2])].filter(v=>L(v)>0);
    let bend=0;for(let i=1;i<legs.length;i++)bend+=turn(legs[i-1],legs[i]);
    const extent=Math.max(...p.slice(1).map(q=>L(delta(q,p[0]))));
    if(bend>limit&&s.depth<44&&extent>tolerance){
      const A=middle(p[0],p[1]),B=middle(p[1],p[2]),C=middle(p[2],p[3]),D=middle(A,B),E=middle(B,C),F=middle(D,E),m=(s.a+s.b)*.5;
      stack.push({p:[F,E,C,p[3]],a:m,b:s.b,depth:s.depth+1},{p:[p[0],A,D,F],a:s.a,b:m,depth:s.depth+1});continue;
    }
    if(bend>limit)precisionLimited=true;
     
     
    const t=s.b,q=t===1?points[3].slice():cubicPoint(local,t).map((v,k)=>v+points[0][k]);
    const last=out.at(-1);if(t!==1&&L(delta(q,last.position))<=tolerance){precisionLimited=true;continue;}
    if(t===1)while(out.length>1&&L(delta(q,out.at(-1).position))<=tolerance){out.pop();precisionLimited=true;}
    out.push({t,position:q});
  }
  for(const q of out){q.exactTangent=tangentAt(points,q.t);q.stationary=false;q.precisionLimited=precisionLimited;}
  return out;
}

function cachedAngleSamples(points, angle) {
  let key = angle + "|" + JSON.stringify(points), old = angleSampleCache.get(key);
  if (old)
    return angleSampleCache.delete(key), angleSampleCache.set(key, old), old;
  const stable=shortEndpointSamples(points,angle);
  if(stable){angleSampleCache.set(key,stable);if(angleSampleCache.size>ANGLE_CACHE_LIMIT)angleSampleCache.delete(angleSampleCache.keys().next().value);return stable;}
  let map = angleMap(points), angleMax = angle * Math.PI / 180, n = Math.max(1, Math.ceil(map.total / angleMax - 1e-10)), parameters = [0];
  for (let i = 1; i < n; i++) parameters.push(invertAngle(points, map, i * map.total / n));
  for (let t of map.stationary) t > 1e-9 && t < 1 - 1e-9 && !parameters.some((x) => Math.abs(x - t) < 1e-7) && parameters.push(t);
  parameters.push(1), parameters.sort((a, b) => a - b);
  let samples = parameters.map((t) => ({ t, position: cubicPoint(points, t), exactTangent: tangentAt(points, t), stationary: map.stationary.some((x) => Math.abs(x - t) < 1e-7) }));
  return angleSampleCache.set(key, samples), angleSampleCache.size > ANGLE_CACHE_LIMIT && angleSampleCache.delete(angleSampleCache.keys().next().value), samples;
}
function sampleSplineSegment(data, segmentId, approx = data.approximation) {
  let points = segmentPoints(data, segmentId), segment = data.segments[segmentId];
  if (!points || !segment) return [];
  let angle = Math.max(1, Math.round(+segment.approximation?.angle || +approx?.angle || 10));
  return cachedAngleSamples(points, angle).map((sample) => ({ ...sample, position: sample.position.slice(), exactTangent: sample.exactTangent.slice(), originalSpanID: segmentId, hardOrSoft: sample.t <= 1e-9 || sample.t >= 1 - 1e-9 ? segment.soft ? "soft" : "hard" : "soft" }));
}

return {sampleSplineSegment,cachedAngleSamples,cubicPoint,cubicDerivative,angleMap,clearCache:()=>angleSampleCache.clear()};
})();

const FrameQuadJet=(()=>{const D=SurfacePatch,{mul}=D;
function secondEdge(e,t){if(e.pieces){const k=e.knots;let lo=0,hi=k.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(k[m]<=t)lo=m;else hi=m;}const w=k[hi]-k[lo],z=(t-k[lo])/w;return mul(secondEdge(e.pieces[lo],z),1/(w*w));}return e[0].map((_,c)=>6*((1-t)*(e[2][c]-2*e[1][c]+e[0][c])+t*(e[3][c]-2*e[2][c]+e[1][c])));}
function edgeJet(e,t,sign=1){return {p:D.bez(e,t),d:mul(D.deriv(e,t),sign),dd:secondEdge(e,t)};}
function correctionTargetJet(patch,u,v){const e=patch.edges,zero=[0,0,0];if(patch.quadCorrection==='translate'){const A=edgeJet(e[0],u),B=edgeJet(e[1],v),C=e[0][3],p=[0,0,0],du=A.d,dv=B.d,duu=A.dd,dvv=B.dd;for(let k=0;k<3;k++)p[k]=A.p[k]+B.p[k]-C[k];return {p,du,dv,duu,duv:zero.slice(),dvv};}
 const B=edgeJet(e[0],u),R=edgeJet(e[1],v),T=edgeJet(e[2],1-u,-1),L=edgeJet(e[3],1-v,-1),P00=e[0][0],P10=e[0][3],P11=e[1][3],P01=e[2][3],iu=1-u,iv=1-v,out=Array.from({length:6},()=>[0,0,0]);
 for(let k=0;k<3;k++){const Lu=iv*(P10[k]-P00[k])+v*(P11[k]-P01[k]),Lv=iu*(P01[k]-P00[k])+u*(P11[k]-P10[k]),Luv=P00[k]-P10[k]+P11[k]-P01[k];out[0][k]=iv*B.p[k]+v*T.p[k]+iu*L.p[k]+u*R.p[k]-(iu*iv*P00[k]+u*iv*P10[k]+u*v*P11[k]+iu*v*P01[k]);out[1][k]=iv*B.d[k]+v*T.d[k]-L.p[k]+R.p[k]-Lu;out[2][k]=-B.p[k]+T.p[k]+iu*L.d[k]+u*R.d[k]-Lv;out[3][k]=iv*B.dd[k]+v*T.dd[k];out[4][k]=-B.d[k]+T.d[k]-L.d[k]+R.d[k]-Luv;out[5][k]=iu*L.dd[k]+u*R.dd[k];}
 return {p:out[0],du:out[1],dv:out[2],duu:out[3],duv:out[4],dvv:out[5]};}
function blendAxisJet(x){const q=4*x*(1-x),qp=4-8*x,qpp=-8,a=.01,den=q*q+a*(1-q)*(1-q),h=q*q/(den||1),hq=2*a*q*(1-q)/((den*den)||1),hqq=2*a*(2*a*q*q*q-3*a*q*q+a+2*q*q*q-3*q*q)/((den*den*den)||1);return [h,hq*qp,hqq*qp*qp+hq*qpp];}
function applyCorrectionJet(patch,C,u,v){if(!patch.quadCorrection)return C;const T=correctionTargetJet(patch,u,v),U=blendAxisJet(u),V=blendAxisJet(v),w=U[0]*V[0],wu=U[1]*V[0],wv=U[0]*V[1],wuu=U[2]*V[0],wuv=U[1]*V[1],wvv=U[0]*V[2],out={p:[0,0,0],du:[0,0,0],dv:[0,0,0],duu:[0,0,0],duv:[0,0,0],dvv:[0,0,0]};for(let k=0;k<3;k++){const d=T.p[k]-C.p[k],du=T.du[k]-C.du[k],dv=T.dv[k]-C.dv[k],duu=T.duu[k]-C.duu[k],duv=T.duv[k]-C.duv[k],dvv=T.dvv[k]-C.dvv[k];out.p[k]=C.p[k]+w*d;out.du[k]=C.du[k]+wu*d+w*du;out.dv[k]=C.dv[k]+wv*d+w*dv;out.duu[k]=C.duu[k]+wuu*d+2*wu*du+w*duu;out.duv[k]=C.duv[k]+wuv*d+wu*dv+wv*du+w*duv;out.dvv[k]=C.dvv[k]+wvv*d+2*wv*dv+w*dvv;}return out;}
function ruledPatchJet(patch,u,v){
 const {base,w}=patch.quadRuled,x=base?v:u,y=base?1-u:v,s=1-y,W=3*s*s*y*w[1]+3*s*y*y*w[2]+y*y*y,D=3*s*s*w[1]+6*s*y*(w[2]-w[1])+3*y*y*(1-w[2]),DD=6*s*(w[2]-2*w[1])+6*y*(1-2*w[2]+w[1]);
 const A=edgeJet(patch.edges[base],x),B=edgeJet(patch.edges[base+2],1-x,-1),q=Array.from({length:6},()=>[0,0,0]);
 for(let k=0;k<3;k++){q[0][k]=A.p[k]+W*(B.p[k]-A.p[k]);q[1][k]=A.d[k]+W*(B.d[k]-A.d[k]);q[2][k]=D*(B.p[k]-A.p[k]);q[3][k]=A.dd[k]+W*(B.dd[k]-A.dd[k]);q[4][k]=D*(B.d[k]-A.d[k]);q[5][k]=DD*(B.p[k]-A.p[k]);}
 return base?{p:q[0],du:mul(q[2],-1),dv:q[1],duu:q[5],duv:mul(q[4],-1),dvv:q[3]}:{p:q[0],du:q[1],dv:q[2],duu:q[3],duv:q[4],dvv:q[5]};
}
function quadPatchDifferential(patch){if(patch.quadRuled)return (u,v)=>ruledPatchJet(patch,u,v);if(patch.quadTranslation)return (u,v)=>correctionTargetJet(patch,u,v);const edges=patch.edges,field=patch.field,bez=D.bez,deriv=D.deriv,fieldTables=patch.options.edgeSamples.map((samples,i)=>({samples,values:samples.map(q=>field(i,q.t))}));function pieceAt(e,t){const knots=e.knots;let i=0;while(i<e.pieces.length-1&&t>=knots[i+1])i++;const w=knots[i+1]-knots[i];return [i,(t-knots[i])/w,w];}
function quadDifferential(u,v){
 function second(e,t){if(e.pieces){const [i,s,w]=pieceAt(e,t);return mul(second(e.pieces[i],s),1/(w*w));}return e[0].map((_,k)=>6*((1-t)*(e[2][k]-2*e[1][k]+e[0][k])+t*(e[3][k]-2*e[2][k]+e[1][k])));}
 function slope(i,t){const tab=fieldTables[i],a=tab.samples;let lo=0,hi=a.length-1;while(hi-lo>1){const m=(hi+lo)>>1;if(a[m].t<=t)lo=m;else hi=m;}const h=a[hi].t-a[lo].t;return tab.values[lo].map((x,k)=>(tab.values[hi][k]-x)/h);}
 function ribbon(i,ta,j,tb,sa,sb,r){const a=bez(edges[i],ta),b=bez(edges[j],tb),fa=field(i,ta),fb=field(j,tb),at=mul(deriv(edges[i],ta),sa),bt=mul(deriv(edges[j],tb),sb),fat=mul(slope(i,ta),sa),fbt=mul(slope(j,tb),sb),att=second(edges[i],ta),btt=second(edges[j],tb),H=[2*r*r*r-3*r*r+1,-2*r*r*r+3*r*r,r*r*r-2*r*r+r,-r*r*r+r*r],D=[6*r*r-6*r,-6*r*r+6*r,3*r*r-4*r+1,-3*r*r+2*r],DD=[12*r-6,-12*r+6,6*r-4,-6*r+2],out=Array.from({length:6},()=>[0,0,0]);for(let k=0;k<3;k++){out[0][k]=H[0]*a[k]+H[1]*b[k]+H[2]*fa[k]+H[3]*fb[k];out[1][k]=H[0]*at[k]+H[1]*bt[k]+H[2]*fat[k]+H[3]*fbt[k];out[2][k]=D[0]*a[k]+D[1]*b[k]+D[2]*fa[k]+D[3]*fb[k];out[3][k]=H[0]*att[k]+H[1]*btt[k];out[4][k]=D[0]*at[k]+D[1]*bt[k]+D[2]*fat[k]+D[3]*fbt[k];out[5][k]=DD[0]*a[k]+DD[1]*b[k]+DD[2]*fa[k]+DD[3]*fb[k];}return out;}
 const A=ribbon(0,u,2,1-u,1,-1,v),tmp=ribbon(3,1-v,1,v,-1,1,u),B=[tmp[0],tmp[2],tmp[1],tmp[5],tmp[4],tmp[3]],a=(u*(1-u))**2,b=(v*(1-v))**2,d=a+b,au=2*u*(1-u)*(1-2*u),bv=2*v*(1-v)*(1-2*v),auu=2-12*u+12*u*u,bvv=2-12*v+12*v*v;
 if(d<1e-25)throw Error('Quad differential requires a non-corner point');const w=a/d,wu=au*b/(d*d),wv=-a*bv/(d*d),wuu=auu*b/(d*d)-2*au*au*b/(d*d*d),wvv=-a*bvv/(d*d)+2*a*bv*bv/(d*d*d),wuv=au*bv*(a-b)/(d*d*d),out=Array.from({length:6},()=>[0,0,0]);
 for(let k=0;k<3;k++){const R=A.map((q,i)=>q[k]-B[i][k]);out[0][k]=B[0][k]+w*R[0];out[1][k]=B[1][k]+wu*R[0]+w*R[1];out[2][k]=B[2][k]+wv*R[0]+w*R[2];out[3][k]=B[3][k]+wuu*R[0]+2*wu*R[1]+w*R[3];out[4][k]=B[4][k]+wuv*R[0]+wu*R[2]+wv*R[1]+w*R[4];out[5][k]=B[5][k]+wvv*R[0]+2*wv*R[2]+w*R[5];}return {p:out[0],du:out[1],dv:out[2],duu:out[3],duv:out[4],dvv:out[5]};
}
return patch.quadCorrection?(u,v)=>applyCorrectionJet(patch,quadDifferential(u,v),u,v):quadDifferential;}

function quadPatchTangents(patch){
 if(patch.quadRuled)return (u,v)=>ruledPatchJet(patch,u,v);
 if(patch.quadCorrection){const differential=quadPatchDifferential(patch);return function(u,v){const q=differential(u,v);return {p:q.p,du:q.du,dv:q.dv};};}
 const {edges,field}=patch,bez=D.bez,deriv=D.deriv,tables=patch.options.edgeSamples.map((samples,i)=>({samples,values:samples.map(q=>field(i,q.t))}));
 function slope(i,t){const tab=tables[i],a=tab.samples;let lo=0,hi=a.length-1;while(hi-lo>1){const m=(hi+lo)>>1;if(a[m].t<=t)lo=m;else hi=m;}const h=a[hi].t-a[lo].t;return [(tab.values[hi][0]-tab.values[lo][0])/h,(tab.values[hi][1]-tab.values[lo][1])/h,(tab.values[hi][2]-tab.values[lo][2])/h];}
 function ribbon(i,ta,j,tb,sa,sb,r){const a=bez(edges[i],ta),b=bez(edges[j],tb),fa=field(i,ta),fb=field(j,tb),at=mul(deriv(edges[i],ta),sa),bt=mul(deriv(edges[j],tb),sb),fat=mul(slope(i,ta),sa),fbt=mul(slope(j,tb),sb),H=[2*r*r*r-3*r*r+1,-2*r*r*r+3*r*r,r*r*r-2*r*r+r,-r*r*r+r*r],d=[6*r*r-6*r,-6*r*r+6*r,3*r*r-4*r+1,-3*r*r+2*r],out=[[0,0,0],[0,0,0],[0,0,0]];
  for(let k=0;k<3;k++){out[0][k]=H[0]*a[k]+H[1]*b[k]+H[2]*fa[k]+H[3]*fb[k];out[1][k]=H[0]*at[k]+H[1]*bt[k]+H[2]*fat[k]+H[3]*fbt[k];out[2][k]=d[0]*a[k]+d[1]*b[k]+d[2]*fa[k]+d[3]*fb[k];}return out;
 }
 return function tangents(u,v){const A=ribbon(0,u,2,1-u,1,-1,v),tmp=ribbon(3,1-v,1,v,-1,1,u),B=[tmp[0],tmp[2],tmp[1]],a=(u*(1-u))**2,b=(v*(1-v))**2,d=a+b,au=2*u*(1-u)*(1-2*u),bv=2*v*(1-v)*(1-2*v);if(d<1e-25)throw Error('Quad differential requires a non-corner point');const w=a/d,wu=au*b/(d*d),wv=-a*bv/(d*d),P=[0,0,0],U=[0,0,0],V=[0,0,0];for(let k=0;k<3;k++){const r=A[0][k]-B[0][k];P[k]=B[0][k]+w*r;U[k]=B[1][k]+wu*r+w*(A[1][k]-B[1][k]);V[k]=B[2][k]+wv*r+w*(A[2][k]-B[2][k]);}return {p:P,du:U,dv:V};};
}


return {differential:quadPatchDifferential,tangents:quadPatchTangents};})();

const FrameNgonJet=(()=>{
'use strict';
function make(patch){
 const n=patch.n,C=patch.domain,scale=1/(2*Math.sin(Math.PI/n)*Math.cos(Math.PI/n)),kappa=Math.min(1,Math.cos(Math.PI/n)/(2*Math.sin(Math.PI/n)));
 const lines=C.map((a,i)=>{const b=C[(i+1)%n];return [(a[1]-b[1])*scale,(b[0]-a[0])*scale,(a[0]*b[1]-b[0]*a[1])*scale];});
 const maps=patch.options.arcMaps;
 const tabs=patch.options.edgeSamples.map((s,i)=>({s,values:s.map(q=>patch.field(i,q.t))}));
 const dist=new Float64Array(n),gx=new Float64Array(n),gy=new Float64Array(n),W=new Float64Array(6),sum=new Float64Array(18),P=new Float64Array(3),T=new Float64Array(3),TT=new Float64Array(3),TTT=new Float64Array(3),D=new Float64Array(3),DT=new Float64Array(3);
 function cubic(e,t){let z=t,es=1;if(e.pieces){const knots=e.knots;let lo=0,hi=knots.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(knots[m]<=t)lo=m;else hi=m;}es=1/(knots[hi]-knots[lo]);z=(t-knots[lo])*es;e=e.pieces[lo];}
  const a=1-z;for(let c=0;c<3;c++){const x=e[0][c],b=e[1][c],d=e[2][c],f=e[3][c];P[c]=a*a*a*x+3*a*a*z*b+3*a*z*z*d+z*z*z*f;T[c]=(3*a*a*(b-x)+6*a*z*(d-b)+3*z*z*(f-d))*es;TT[c]=6*(a*(d-2*b+x)+z*(f-2*d+b))*es*es;TTT[c]=6*(f-3*d+3*b-x)*es*es*es;}
 }
 return function differential(x,y){
  let min=Infinity;for(let i=0;i<n;i++){const L=lines[i],v=L[0]*x+L[1]*y+L[2],sign=v<0?-1:1;dist[i]=Math.abs(v);gx[i]=sign*L[0];gy[i]=sign*L[1];min=Math.min(min,dist[i]);}
  if(!(min>1e-12))throw Error('N-gon derivative needs an interior point');
  W.fill(0);sum.fill(0);
  for(let i=0;i<n;i++){
   const ia=(i+n-1)%n,ib=(i+1)%n,a=dist[ia],den=a+dist[ib],ax=gx[ia],ay=gy[ia],dx=gx[ia]+gx[ib],dy=gy[ia]+gy[ib];
   let t=a/den,tx=(ax-t*dx)/den,ty=(ay-t*dy)/den,txx=-2*tx*dx/den,txy=-(tx*dy+ty*dx)/den,tyy=-2*ty*dy/den;
   if(maps){const map=maps[i];let lo=0,hi=map.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(map[m].t<=t)lo=m;else hi=m;}const r=(map[hi].bezierT-map[lo].bezierT)/(map[hi].t-map[lo].t);t=map[lo].bezierT+(t-map[lo].t)*r;tx*=r;ty*=r;txx*=r;txy*=r;tyy*=r;}
   cubic(patch.edges[i],t);
   const tab=tabs[i],ss=tab.s;let lo=0,hi=ss.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(ss[m].t<=t)lo=m;else hi=m;}const dt=ss[hi].t-ss[lo].t,ff=(t-ss[lo].t)/dt;
   let a0=0,a1=0,a2=0,b0=0,b1=0,b2=0;
   for(let c=0;c<3;c++){D[c]=tab.values[lo][c]+ff*(tab.values[hi][c]-tab.values[lo][c]);DT[c]=(tab.values[hi][c]-tab.values[lo][c])/dt;a0+=T[c]*D[c];a1+=TT[c]*D[c]+T[c]*DT[c];a2+=TTT[c]*D[c]+2*TT[c]*DT[c];b0+=T[c]*T[c];b1+=2*T[c]*TT[c];b2+=2*(TT[c]*TT[c]+T[c]*TTT[c]);}
   if(!(b0>0))throw Error('N-gon tangent is zero');const h=a0/b0,ht=(a1-h*b1)/b0,htt=(a2-h*b2-2*ht*b1)/b0;
   const d=dist[i],ex=gx[i],ey=gy[i],z=1+2*d,f=kappa*d/z,fd=kappa/(z*z),fdd=-4*kappa/(z*z*z),w=(min/d)**2,wx=-2*w*ex/d,wy=-2*w*ey/d,wxx=6*w*ex*ex/(d*d),wxy=6*w*ex*ey/(d*d),wyy=6*w*ey*ey/(d*d);
   W[0]+=w;W[1]+=wx;W[2]+=wy;W[3]+=wxx;W[4]+=wxy;W[5]+=wyy;
   for(let c=0;c<3;c++){
    const U=D[c]-T[c]*h,Ut=DT[c]-TT[c]*h-T[c]*ht,Utt=-TTT[c]*h-2*TT[c]*ht-T[c]*htt,R=P[c]+U*f,Rt=T[c]+Ut*f,Rtt=TT[c]+Utt*f;
    const Rx=Rt*tx+U*fd*ex,Ry=Rt*ty+U*fd*ey,Rxx=Rtt*tx*tx+Rt*txx+2*Ut*tx*fd*ex+U*fdd*ex*ex,Rxy=Rtt*tx*ty+Rt*txy+Ut*fd*(tx*ey+ty*ex)+U*fdd*ex*ey,Ryy=Rtt*ty*ty+Rt*tyy+2*Ut*ty*fd*ey+U*fdd*ey*ey;
    sum[c]+=w*R;sum[3+c]+=wx*R+w*Rx;sum[6+c]+=wy*R+w*Ry;sum[9+c]+=wxx*R+2*wx*Rx+w*Rxx;sum[12+c]+=wxy*R+wx*Ry+wy*Rx+w*Rxy;sum[15+c]+=wyy*R+2*wy*Ry+w*Ryy;
   }
  }
  const out=Array.from({length:6},()=>[0,0,0]);for(let c=0;c<3;c++){out[0][c]=sum[c]/W[0];out[1][c]=(sum[3+c]-W[1]*out[0][c])/W[0];out[2][c]=(sum[6+c]-W[2]*out[0][c])/W[0];out[3][c]=(sum[9+c]-W[3]*out[0][c]-2*W[1]*out[1][c])/W[0];out[4][c]=(sum[12+c]-W[4]*out[0][c]-W[1]*out[2][c]-W[2]*out[1][c])/W[0];out[5][c]=(sum[15+c]-W[5]*out[0][c]-2*W[2]*out[2][c])/W[0];}
  return {p:out[0],du:out[1],dv:out[2],duu:out[3],duv:out[4],dvv:out[5]};
 };
}
return {make};})();

 
const SBCommon=(()=>{
'use strict';
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],norm=a=>Math.hypot(...a);
function rate(q,x,y,theta){return Math.sqrt(Math.max(0,q[0]*x*x+2*q[1]*x*y+q[2]*y*y))/theta;}
class BufferMesh{
 constructor(prep,V){
  this.boundaryCount=prep.uv.length/2;this.v=this.boundaryCount;
  if(!Number.isSafeInteger(V)||V<this.v||V>(prep.cfg.maxVertices||250000))throw new RangeError('SurfaceBuilder: vertex budget exceeded ('+V+')');
  this.uv=new Float64Array(V*2);this.uv.set(prep.uv);this.indices=new Uint32Array((2*V-this.boundaryCount-2)*3);this.t=0;
 }
 add(u,v){const i=this.v++;this.uv[2*i]=u;this.uv[2*i+1]=v;return i;}
 tri(a,b,c){this.indices[this.t++]=a;this.indices[this.t++]=b;this.indices[this.t++]=c;}
 finish(type,meta={}){if(this.v*2!==this.uv.length||this.t!==this.indices.length)throw Error('SurfaceBuilder: output allocation mismatch');return {uv:this.uv,indices:this.indices,vertexCount:this.v,boundaryCount:this.boundaryCount,triangleCount:this.t/3,meta:{type,flips:0,postPasses:0,...meta}};}
}
function evaluatePositions(prep,mesh){const start=performance.now(),p=new Float64Array(mesh.vertexCount*3),q=new Float64Array(3);p.set(prep.positions);if(mesh.grid&&prep.surface.evaluateGrid?.(mesh,p)){mesh.meta.positionMethod=prep.surface.kernel.quadTranslation?'separable-curves':'cached-ribbons';return {positions:p,ms:performance.now()-start};}for(let i=mesh.boundaryCount;i<mesh.vertexCount;i++){if(prep.surface.evaluateInto)prep.surface.evaluateInto(mesh.uv[2*i],mesh.uv[2*i+1],q);else{const a=prep.surface.evaluate(mesh.uv[2*i],mesh.uv[2*i+1]);q[0]=a[0];q[1]=a[1];q[2]=a[2];}if(!Number.isFinite(q[0]+q[1]+q[2]))throw Error('SurfaceBuilder: non-finite interior position '+i);const at=i*3;p[at]=q[0];p[at+1]=q[1];p[at+2]=q[2];}return {positions:p,ms:performance.now()-start};}
function curvatureMetric(d,n,base,out,o){
  const u=d.du,v=d.dv,uu=d.duu,uv=d.duv,vv=d.dvv;
  let e=0,f=0,g=0,h=0,j=0,k=0;
  for(let c=0;c<3;c++){e+=u[c]*u[c];f+=u[c]*v[c];g+=v[c]*v[c];h+=n[c]*uu[c];j+=n[c]*uv[c];k+=n[c]*vv[c];}
  if(base===1){const E=e-2*f+g,F=e-f,H=h-2*j+k,J=h-j;g=e;e=E;f=F;k=h;h=H;j=J;}
  else if(base===2){const E=g,F=g-f,G=e-2*f+g,H=k,J=k-j,K=h-2*j+k;e=E;f=F;g=G;h=H;j=J;k=K;}
  if(!(e>0&&e*g-f*f>0)||!Number.isFinite(e+f+g+h+j+k))return false;
  const l=Math.sqrt(e),c=f/l,t=Math.sqrt(Math.max(1e-30,g-c*c));
  const a=h/e,b=(j-h*f/e)/(l*t),z=(k-2*f/e*j+(f/e)*(f/e)*h)/(t*t);
  const disc=Math.hypot(a-z,2*b),trace=a+z;
  let p=Math.abs((trace+disc)*.5),q=Math.abs((trace-disc)*.5),peak=Math.max(p,q,1e-20);
  p=Math.max(p,peak/16);q=Math.max(q,peak/16);
  const x=disc>1e-20?(a-z)/disc:1,y=disc>1e-20?2*b/disc:0,w=(p+q)*.5,diff=(p-q)*.5;
  const aa=w+diff*x,bb=diff*y,cc=w-diff*x;
  out[o]=l*l*aa;out[o+1]=l*(c*aa+t*bb);out[o+2]=c*c*aa+2*c*t*bb+t*t*cc;
  return Number.isFinite(out[o]+out[o+1]+out[o+2]);
 }
function jetMetric(d){const a=d.du,b=d.dv,uu=d.duu,uv=d.duv,vv=d.dvv,N=cross(a,b),L=norm(N);if(!(L>1e-18))return null;for(let k=0;k<3;k++)N[k]/=L;const x=cross(uu,b),X=cross(a,uv),y=cross(uv,b),Y=cross(a,vv);for(let k=0;k<3;k++){x[k]+=X[k];y[k]+=Y[k];}const nX=dot(N,x),nY=dot(N,y);for(let k=0;k<3;k++){x[k]=(x[k]-N[k]*nX)/L;y[k]=(y[k]-N[k]*nY)/L;}return {p:d.p,n:N,du:a,dv:b,q:[dot(x,x),dot(x,y),dot(y,y)],jacobian:L};}
function normalJet(d){
  const u=d.du,v=d.dv,uu=d.duu,uv=d.duv,vv=d.dvv;
  let nx=u[1]*v[2]-u[2]*v[1],ny=u[2]*v[0]-u[0]*v[2],nz=u[0]*v[1]-u[1]*v[0];
  const L=Math.sqrt(nx*nx+ny*ny+nz*nz);if(!(L>1e-12)||!Number.isFinite(L))return null;
  nx/=L;ny/=L;nz/=L;
  let ax=(uu[1]*v[2]-uu[2]*v[1])+(u[1]*uv[2]-u[2]*uv[1]),ay=(uu[2]*v[0]-uu[0]*v[2])+(u[2]*uv[0]-u[0]*uv[2]),az=(uu[0]*v[1]-uu[1]*v[0])+(u[0]*uv[1]-u[1]*uv[0]);
  let bx=(uv[1]*v[2]-uv[2]*v[1])+(u[1]*vv[2]-u[2]*vv[1]),by=(uv[2]*v[0]-uv[0]*v[2])+(u[2]*vv[0]-u[0]*vv[2]),bz=(uv[0]*v[1]-uv[1]*v[0])+(u[0]*vv[1]-u[1]*vv[0]);
  const a=nx*ax+ny*ay+nz*az,b=nx*bx+ny*by+nz*bz;
  ax=(ax-nx*a)/L;ay=(ay-ny*a)/L;az=(az-nz*a)/L;bx=(bx-nx*b)/L;by=(by-ny*b)/L;bz=(bz-nz*b)/L;
  return {n:[nx,ny,nz],q:[ax*ax+ay*ay+az*az,ax*bx+ay*by+az*bz,bx*bx+by*by+bz*bz],p:d.p,du:u,dv:v,jacobian:L};
 }
function jetMetricQuad(d){const a=d.du,b=d.dv,uu=d.duu,uv=d.duv,vv=d.dvv,N=cross(a,b),L=Math.sqrt(dot(N,N));if(!(L>1e-18))return null;for(let k=0;k<3;k++)N[k]/=L;const x=cross(uu,b),X=cross(a,uv),y=cross(uv,b),Y=cross(a,vv);for(let k=0;k<3;k++){x[k]+=X[k];y[k]+=Y[k];}const nX=dot(N,x),nY=dot(N,y);for(let k=0;k<3;k++){x[k]=(x[k]-N[k]*nX)/L;y[k]=(y[k]-N[k]*nY)/L;}return {p:d.p,n:N,du:a,dv:b,q:[dot(x,x),dot(x,y),dot(y,y)],jacobian:L};}
return {BufferMesh,rate,evaluatePositions,jetMetric,jetMetricQuad,normalJet,curvatureMetric,cross,dot,norm};})();


const TriThreeCurves=(()=>{
 'use strict';
 const E=SBCommon,PI=Math.PI,H=Math.sqrt(3)/2;

 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 function local(base,u,v){return base===0?[u,v]:base===1?[v,1-u-v]:[1-u-v,u];}
  
 const normalJet=SBCommon.normalJet;
  
  
  
 const curvatureMetric=SBCommon.curvatureMetric;
  
 function sampleMetric(rows,s,r,out,band=-1){
  s=Math.cbrt(s*s);const z=clamp(r*rows.length-.5,0,rows.length-1),k=band<0?Math.min(rows.length-2,Math.floor(z)):band,f=z-k,ra=rows[k],rb=rows[k+1];
  const x=clamp(s*ra.count-.5,0,ra.count-1),i=Math.min(ra.count-2,Math.floor(x)),a=x-i;
  const equal=ra.count===rb.count,y=equal?x:clamp(s*rb.count-.5,0,rb.count-1),j=equal?i:Math.min(rb.count-2,Math.floor(y)),b=equal?a:y-j;
  const A=ra.metric,B=rb.metric,ia=i*3,ib=j*3,w0=(1-f)*(1-a),w1=(1-f)*a,w2=f*(1-b),w3=f*b;
  out[0]=A[ia]*w0+A[ia+3]*w1+B[ib]*w2+B[ib+3]*w3;
  out[1]=A[ia+1]*w0+A[ia+4]*w1+B[ib+1]*w2+B[ib+4]*w3;
  out[2]=A[ia+2]*w0+A[ia+5]*w1+B[ib+2]*w2+B[ib+5]*w3;
 }
 function analyze(prep,withMetric=true){
  const started=performance.now(),budget=prep.cfg.probes,theta=prep.cfg.angle*PI/180,base=prep.cfg.counts.indexOf(Math.max(...prep.cfg.counts)),N=prep.cfg.counts[base],source=prep.sides[base];
  let cut=1;for(let i=2;i<N;i++)if(Math.abs(source[i].t-.5)<Math.abs(source[cut].t-.5))cut=i;
  const rawMid=N>1?source[cut].t:.5,unsafe=rawMid<.25||rawMid>.75,rPow=1,virtual=unsafe,mid=clamp(rawMid,.25,.75),field={version:'r13',mode:'three',withMetric,metricMissing:0,base,cut,mid,theta,unsafe,virtual,rPow,probes:[],halves:[],requested:budget,bad:0,flat:prep.flat,limited:false,maxValue:0};
  if(prep.flat){field.advanceFactor=1;field.alongFactor=1.2;field.ms=performance.now()-started;return field;}
  let sumStep=0,peakStep=0;
  for(let side=0;side<2;side++){
   const count=Math.floor(budget/2)+(side===0?budget%2:0),nr=Math.max(2,Math.min(Math.floor(count/2),Math.round(Math.sqrt(count)))),rows=[];
   for(let j=0;j<nr;j++){
    const nc=Math.floor(count/nr)+(j<count%nr?1:0),yr=(j+.5)/nr,r=Math.pow(yr,rPow),dr=(rPow)*Math.pow(yr,(rPow)-1),rates=new Float64Array(nc*4),valid=new Uint8Array(nc),metric=withMetric?new Float64Array(nc*3):null,metricValid=withMetric?new Uint8Array(nc):null;let hits=0;
    for(let i=0;i<nc;i++){
     const t=(i+.5)/nc,rootT=Math.sqrt(t),s=t*rootT,dsdt=1.5*rootT,lu=side?1-s*(1-mid+mid*r):mid*(1-r)*s,lv=r*s,u=base===0?lu:base===1?1-lu-lv:lv,v=base===0?lv:base===1?lu:1-lu-lv;let d,m;
     try{d=prep.surface.differential(u,v);m=normalJet(d);}catch(_){m=null;}
     if(!m){field.bad++;continue;}
     const la=side?-(1-mid+mid*r):mid*(1-r),lb=r,lx=-mid*s,ly=s,a=base===0?la:base===1?-la-lb:lb,b=base===0?lb:base===1?la:-la-lb,x=base===0?lx:base===1?-lx-ly:ly,y=base===0?ly:base===1?lx:-lx-ly,q=m.q;
     const normal=E.rate(q,a,b,theta);let step=E.rate(q,x,y,theta)*dr;
      
      
     const coupled=q[0]*a*x+q[1]*(a*y+b*x)+q[2]*b*y;
     const conditional=Math.sqrt(Math.max(0,step*step-coupled*coupled/Math.max(normal*normal*theta*theta,1e-30)/theta/theta));
     step=Math.max(.7*step,conditional);
     let tx=d.du[0]*a+d.dv[0]*b,ty=d.du[1]*a+d.dv[1]*b,tz=d.du[2]*a+d.dv[2]*b;
     let ax=d.duu[0]*a*a+2*d.duv[0]*a*b+d.dvv[0]*b*b,ay=d.duu[1]*a*a+2*d.duv[1]*a*b+d.dvv[1]*b*b,az=d.duu[2]*a*a+2*d.duv[2]*a*b+d.dvv[2]*b*b;
     const cx=ty*az-tz*ay,cy=tz*ax-tx*az,cz=tx*ay-ty*ax;
     let curve=Math.sqrt(cx*cx+cy*cy+cz*cz)/Math.max(1e-30,tx*tx+ty*ty+tz*tz)/theta;
     if(!Number.isFinite(normal+step+curve)){field.bad++;continue;}
     if(withMetric){metricValid[i]=curvatureMetric(d,m.n,base,metric,i*3)?1:0;if(!metricValid[i])field.metricMissing++;}
     const stepScale=theta/(2*nr),alongScale=theta/(2*nc);
     rates[4*i]=Math.atan(step*stepScale)/stepScale;
     rates[4*i+1]=Math.atan(normal*dsdt*alongScale)/alongScale;
     rates[4*i+2]=Math.atan(curve*dsdt*alongScale)/alongScale;rates[4*i+3]=Math.sqrt(tx*tx+ty*ty+tz*tz)*dsdt;valid[i]=1;hits++;sumStep+=step;peakStep=Math.max(peakStep,step);
      
     m.u=u;m.v=v;field.probes.push(m);
    }
     
     
    if(hits&&hits<nc)for(let i=0;i<nc;i++)if(!valid[i]){let near=-1,dist=Infinity;for(let k=0;k<nc;k++)if(valid[k]&&Math.abs(k-i)<dist){dist=Math.abs(k-i);near=k;}rates.set(rates.subarray(near*4,near*4+4),i*4);}
    if(withMetric){
     for(let i=0;i<nc;i++)if(!metricValid[i]){let near=-1,dist=Infinity;for(let k=0;k<nc;k++)if(metricValid[k]&&Math.abs(k-i)<dist){near=k;dist=Math.abs(k-i);}if(near>=0)metric.set(metric.subarray(near*3,near*3+3),i*3);else metric.set([1,.5,1],i*3);}
    }
    rows.push({count:nc,rates,hits,metric});
   }
   if(rows.every(row=>!row.hits))throw Error('Обмер клина вырожден: нет действительных производных.');
   for(let j=0;j<nr;j++)if(!rows[j].hits){let near=-1,dist=Infinity;for(let k=0;k<nr;k++)if(rows[k].hits&&Math.abs(k-j)<dist){near=k;dist=Math.abs(k-j);}const src=rows[near];for(let i=0;i<rows[j].count;i++){const k=Math.min(src.count-1,Math.floor((i+.5)*src.count/rows[j].count));rows[j].rates.set(src.rates.subarray(k*4,k*4+4),i*4);}}
   field.halves.push(rows);
  }
  const contrast=peakStep/(sumStep/(field.probes.length||1)||1);
   
  field.advanceFactor=(1+.2*clamp((contrast-3)/3,0,1));field.alongFactor=(2.2-(1+.2*clamp((contrast-3)/3,0,1)));field.contrast=contrast;
  preparePlanning(field);field.ms=performance.now()-started;return field;
 }
  
 const layouts=new Map();
 function layout(count,targets){const key=count*100+targets;let l=layouts.get(key);if(l)return l;
  const ids=new Uint32Array(targets),mix=new Float64Array(targets);
  for(let i=0;i<targets;i++){const x=Math.max(0,Math.min(count-1,(i+.5)*count/targets-.5)),j=Math.min(count-2,Math.floor(x));ids[i]=j*4;mix[i]=x-j;}
  l={ids,mix};layouts.set(key,l);return l;
 }
 function preparePlanning(field){for(const rows of field.halves){for(const row of rows){
   const R=row.rates,l8=layout(row.count,8),l24=layout(row.count,24),step=new Float64Array(8),along=new Float64Array(72);
   for(let i=0;i<8;i++){const k=l8.ids[i],t=l8.mix[i];step[i]=R[k]*(1-t)+R[k+4]*t;}
   for(let i=0;i<24;i++){const k=l24.ids[i],t=l24.mix[i];for(let c=0;c<3;c++)along[i*3+c]=R[k+c+1]*(1-t)+R[k+c+5]*t;}
   row.step=step;row.along=along;
  }}
 }
   
   
  function quantile(values,z){const x=clamp(z,0,1)*(values.length-1),i=Math.min(values.length-2,Math.floor(x));return values[i]+(values[i+1]-values[i])*(x-i);}
  function build(prep,field,type='sector'){
   const begin=performance.now(), B=prep.uv.length/2, base=field.base||0, source=prep.sides[base], baseIDs=prep.ids[base], endSides=[(base+2)%3,(base+1)%3], A=baseIDs[0], Z=baseIDs.at(-1);
   if(prep.flat||B===3){const m=new E.BufferMesh(prep,B);m.tri(prep.ids[0][0],prep.ids[1][0],prep.ids[2][0]);const out=m.finish(type,{flat:prep.flat,underresolved:!prep.flat,layers:1,rowCounts:[3],extraSurfaceCalls:0});out.ms=performance.now()-begin;return out;}
   if(field.mode!=='three')throw Error('Нужен обмер треугольной ячейки.');
   const {cut,mid}=field,sourceMid=source[cut].t,profile=new Float64Array(33),plan=[];let total=0,V=B,limited=!!field.bad;
   const startIDs=[Uint32Array.from(baseIDs.slice(0,cut+1)),Uint32Array.from(baseIDs.slice(cut).reverse())];
   const startS=[Float64Array.from(source.slice(0,cut+1),q=>q.t/sourceMid),Float64Array.from(source.slice(cut).reverse(),q=>(1-q.t)/(1-sourceMid))];
   const endIDs=[Uint32Array.from(prep.ids[endSides[0]]).reverse(),Uint32Array.from(prep.ids[endSides[1]])];
   const endS=[Float64Array.from(prep.sides[endSides[0]].slice().reverse(),q=>1-q.t),Float64Array.from(prep.sides[endSides[1]],q=>q.t)];
   for(let j=0;j<32;j++){const r=(j+.5)/32;let max=0;for(let side=0;side<2;side++){
    const rows=field.halves[side],z=clamp(r*rows.length-.5,0,rows.length-1),k=Math.min(rows.length-2,Math.floor(z)),f=z-k,a=rows[k].step,b=rows[k+1].step;
    for(let i=0;i<8;i++)max=Math.max(max,(1-f)*a[i]+f*b[i]);
   }total+=max/(32*field.advanceFactor);profile[j+1]=total;}
    
    
    
   const requestedK=Math.max(2,Math.ceil(total)),K=Math.min(96,requestedK);limited||=K!==requestedK;let bin=0;const cdf=new Float64Array(25),arc=new Float64Array(25);
   for(let j=1;j<K;j++){
    const target=total*j/K;while(bin<31&&profile[bin+1]<target)bin++;
    const turnLevel=(bin+(target-profile[bin])/(profile[bin+1]-profile[bin]||1))/32;
     
    const r=.5*turnLevel+.5*j/K,halves=[];
    for(let side=0;side<2;side++){
     const rows=field.halves[side],z=clamp(r*rows.length-.5,0,rows.length-1),l=Math.min(rows.length-2,Math.floor(z)),f=z-l,ar=rows[l].along,br=rows[l+1].along;let sum=0;
     for(let i=0;i<24;i++){const k=3*i,normal=(1-f)*ar[k]+f*br[k],curve=(1-f)*ar[k+1]+f*br[k+1],speed=(1-f)*ar[k+2]+f*br[k+2];sum+=Math.max(curve,normal)/(24*field.alongFactor);cdf[i+1]=sum;arc[i+1]=arc[i]+speed/24;}
      
      
     const w0=field.virtual?0:(1-r)**4,w1=r**4,wi=1-w0-w1;
     const wanted=Math.max(1,Math.ceil(wi*sum+w0*(startS[side].length-1)+w1*(endS[side].length-1))),M=Math.min(511,wanted),ts=new Float64Array(M+1),order=new Float64Array(M+1);limited||=M!==wanted;ts[M]=1;order[M]=1;let k=0;
     for(let i=1;i<M;i++){
      const z=i/M,target=sum*z;while(k<23&&cdf[k+1]<target)k++;const w=(target-cdf[k])/(cdf[k+1]-cdf[k]||1),q=sum>1e-12?(k+w)/24:z;
      const s=wi*(q*Math.sqrt(q))+w0*quantile(startS[side],z)+w1*quantile(endS[side],z);ts[i]=s;
      const chartS=Math.cbrt(s*s),at=Math.min(23,Math.floor(chartS*24)),af=chartS*24-at,relative=(arc[at]+af*(arc[at+1]-arc[at]))/(arc[24]||1);
       
       
      order[i]=(w0+w1)*s+wi*relative;
     }
     halves.push({s:ts,order,arcLength:arc[24]});V+=M-1;
    }
    V++;plan.push({r,halves});
   }
   const directed=type==='sector';if(directed&&!field.withMetric)throw Error('Нужен обмер с метрикой направления.');
   const m=new E.BufferMesh(prep,V),metric=new Float64Array(3);
   let metricChoices=0,orderChoices=0,metricTies=0,factoredChoices=0,nearTieChoices=0;
   const add=(u,v)=>base===0?m.add(u,v):base===1?m.add(1-u-v,u):m.add(v,1-u-v),prev=startIDs.slice(),params=startS.slice(),radii=startS.slice();
    
    
   function fullPredicate(a0,a1,b1,b0,side,rows,band,oldOrder){
    const ids=[a0,a1,b1,b0],U=new Float64Array(8);for(let k=0;k<4;k++){const q=local(base,m.uv[2*ids[k]],m.uv[2*ids[k]+1]);U[2*k]=q[0];U[2*k+1]=q[1];}
    const u=(U[0]+U[2]+U[4]+U[6])*.25,v=(U[1]+U[3]+U[5]+U[7])*.25,s=side?(1-u-mid*v)/(1-mid):u/mid+v,r=v/Math.max(s,1e-30);sampleMetric(rows,s,r,metric,band);
    const x0=U[0]-U[6],y0=U[1]-U[7],x1=U[2]-U[6],y1=U[3]-U[7],x2=U[4]-U[6],y2=U[5]-U[7],A=metric[0],B=metric[1],C=metric[2];
    const q0=A*x0*x0+2*B*x0*y0+C*y0*y0,q1=A*x1*x1+2*B*x1*y1+C*y1*y1,q2=A*x2*x2+2*B*x2*y2+C*y2*y2;
    const d0=q0*(x1*y2-y1*x2),d1=q1*(x2*y0-y2*x0),d2=q2*(x0*y1-y0*x1),det=d0+d1+d2;
    if(Math.abs(det)<=4e-14*(Math.abs(d0)+Math.abs(d1)+Math.abs(d2))){metricTies++;return oldOrder;}return side?det<0:det>0;
   }
   function stitch(a,b,ta,tb,side,r0,r1,sa,sb){
    const rows=field.halves[side],nr=rows.length;
    const bracket=r=>Math.min(nr-2,Math.floor(clamp(r*nr-.5,0,nr-1))),k0=bracket(r0-1e-12),k1=bracket(r1+1e-12),band=k0===k1?k0:-1;let i=1,j=1;
    if(side)m.tri(a[0],b[1],a[1]);else m.tri(a[0],a[1],b[1]);
    const ax=side?-(1-mid+mid*r0):mid*(1-r0),ay=r0,bx=side?-(1-mid+mid*r1):mid*(1-r1),by=r1;
    const a00=ax*ax,a01=2*ax*ay,a11=ay*ay,b00=bx*bx,b01=2*bx*by,b11=by*by;
    while(i<a.length-1||j<b.length-1){let advanceA;
     if(i===a.length-1)advanceA=false;
     else if(j===b.length-1)advanceA=true;
     else if(!directed)advanceA=ta[i]*ta[i+1]<=tb[j]*tb[j+1];
      
     else if(ta[i]>tb[j+1]){advanceA=false;orderChoices++;}
     else if(tb[j]>ta[i+1]){advanceA=true;orderChoices++;}
     else {
      const sumA=sa[i]+sa[i+1],sumB=sb[j]+sb[j+1],s=(sumA+sumB)*.25,r=(r0*sumA+r1*sumB)/(sumA+sumB);
      sampleMetric(rows,s,r,metric,band);
      const x=(a00*metric[0]+a01*metric[1]+a11*metric[2])*sa[i]*sa[i+1],y=(b00*metric[0]+b01*metric[1]+b11*metric[2])*sb[j]*sb[j+1];
      const difference=x-y,scale=Math.abs(x)+Math.abs(y);
      if(Math.abs(difference)>1e-9*scale){advanceA=difference<0;factoredChoices++;}
      else {advanceA=fullPredicate(a[i],a[i+1],b[j+1],b[j],side,rows,band,ta[i]*ta[i+1]<=tb[j]*tb[j+1]);nearTieChoices++;}
      metricChoices++;
     }
     if(advanceA){if(side)m.tri(a[i],b[j],a[i+1]);else m.tri(a[i],a[i+1],b[j]);i++;}
     else{if(side)m.tri(a[i],b[j],b[j+1]);else m.tri(a[i],b[j+1],b[j]);j++;}
    }
   }
   function xOf(id){const q=local(base,m.uv[2*id],m.uv[2*id+1]);return q[0]+.5*q[1];}
   function stitchBase(a,b){let i=1,j=1;m.tri(a[0],a[1],b[1]);
    while(i<a.length-2||j<b.length-2){const x=i<a.length-2?xOf(a[i])+xOf(a[i+1]):Infinity,y=j<b.length-2?xOf(b[j])+xOf(b[j+1]):Infinity;
     if(x<=y){m.tri(a[i],a[i+1],b[j]);i++;}else{m.tri(a[i],b[j+1],b[j]);j++;}}
    m.tri(a[i],a.at(-1),b[j]);
   }
   const rowCounts=[baseIDs.length],interior=[];let first=true,lastR=0;
   for(const section of plan){const r=section.r,seam=add(mid*(1-r),r);let count=1;
    for(let side=0;side<2;side++){const p=section.halves[side],ts=p.s,M=ts.length-1,row=new Uint32Array(M+1);row[0]=side?Z:A;row[M]=seam;
     for(let i=1;i<M;i++){const s=ts[i];row[i]=add(side?1-s*(1-mid+mid*r):mid*(1-r)*s,r*s);}
     const nextParam=p.order;
     if(!first||!field.virtual)stitch(prev[side],row,params[side],nextParam,side,lastR,r,radii[side],ts);prev[side]=row;params[side]=nextParam;radii[side]=ts;count+=M-1;
    }
    if(first&&field.virtual)stitchBase(baseIDs,Array.from(prev[0]).concat(Array.from(prev[1]).reverse().slice(1)));first=false;lastR=r;rowCounts.push(count+2);interior.push(count);
   }
    
    
   for(let side=0;side<2;side++)stitch(prev[side],endIDs[side],params[side],endS[side],side,lastR,1,radii[side],endS[side]);
   rowCounts.push(endIDs[0].length+endIDs[1].length-1);
   const out=m.finish(type,{base,cut,mid,layers:K,requestedLayers:requestedK,limited,rowCounts,interiorRowCounts:interior,rowLevels:[0,...plan.map(q=>q.r),1],advanceFactor:field.advanceFactor,alongFactor:field.alongFactor,extraSurfaceCalls:0,relocatedSeam:field.virtual,sourceMid,sideClosure:'all-three-original-chains',version:'r13',factoredChoices,nearTieChoices,probeChart:'s=xi^(3/2)',coupledFloor:.7,sectionRegularization:.5,metricChoices,orderChoices,metricTies,order:directed?'local-curvature-metric':'r10-normalized-arc'});out.ms=performance.now()-begin;return out;
  }
  function prepareDisplay(field){if(field.displayPrepared)return field;field.maxValue=0;for(const p of field.probes){const q=p.q,aa=q[0],bb=(q[1]-.5*q[0])/H,cc=(.25*q[0]-q[1]+q[2])/(H*H),disc=Math.hypot(aa-cc,2*bb),hi=Math.max(0,(aa+cc+disc)/2),lo=Math.max(0,(aa+cc-disc)/2);p.value=Math.sqrt(hi)/field.theta;p.anisotropy=Math.sqrt((hi+1e-8)/(lo+1e-8));p.direction=.5*Math.atan2(2*bb,aa-cc);field.maxValue=Math.max(field.maxValue,p.value);}field.displayPrepared=true;return field;}
  return {analyze,build,prepareDisplay};
})();

const QuadR1=(()=>{
'use strict';const E={...SBCommon,jetMetric:SBCommon.jetMetricQuad},PI=Math.PI,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const warp=x=>(1-Math.cos(PI*x))*.5,unwarp=u=>Math.acos(clamp(1-2*u,-1,1))/PI,dwarp=x=>PI*.5*Math.sin(PI*x);
 const curvatureMetric=SBCommon.curvatureMetric;
 
function triangulateChains(left,right,uv,emit){
 if(left.length<2||right.length<2)return;
 const y=i=>uv[2*i+1],x=i=>uv[2*i];
 const ori=(a,b,c)=>(x(b)-x(a))*(y(c)-y(a))-(y(b)-y(a))*(x(c)-x(a));
 const out=(a,b,c)=>{const o=ori(a,b,c);if(o>0)emit(a,b,c);else if(o<0)emit(a,c,b);else throw Error('zero mono triangle '+[a,b,c]);};
 const N=left.length+right.length-2;
 if(N<3)return;
 let li=left.length-2,ri=right.length-2;
 const seq=[{id:left.at(-1),side:-1}];
 while(li>0||ri>0){
  const l=li>0?left[li]:null,r=ri>0?right[ri]:null;
  if(r===null||l!==null&&(y(l)>y(r)||y(l)===y(r)&&x(l)<x(r))){seq.push({id:l,side:0});li--;}
  else {seq.push({id:r,side:1});ri--;}
 }
 seq.push({id:left[0],side:-1});
 const stack=[seq[0],seq[1]];
 for(let j=2;j<seq.length-1;j++){
  const cur=seq[j];
  if(cur.side!==stack.at(-1).side){
   while(stack.length>1){const last=stack.pop();out(cur.id,last.id,stack.at(-1).id);}
   stack.length=0;stack.push(seq[j-1],cur);
  }else{
   let last=stack.pop();
   while(stack.length){const o=ori(cur.id,last.id,stack.at(-1).id);if(cur.side===1?o<=0:o>=0)break;out(cur.id,last.id,stack.at(-1).id);last=stack.pop();}
   stack.push(last,cur);
  }
 }
 const cur=seq.at(-1);
 while(stack.length>1){const last=stack.pop();out(cur.id,last.id,stack.at(-1).id);}
}

function analyze(prep){const t0=performance.now(),N=prep.cfg.probes,theta=prep.cfg.angle*PI/180,field={mode:'quad',probes:[],rows:[],requested:N,bad:0,metricMissing:0,maxValue:0,flat:prep.flat};if(prep.flat){field.ms=performance.now()-t0;return field;}
 const nr=Math.max(2,Math.round(Math.sqrt(N))),M=new Float64Array(3);
 for(let j=0;j<nr;j++){const nc=Math.floor(N/nr)+(j<N%nr?1:0),y=(j+.5)/nr,v=warp(y),row={count:nc,data:new Float64Array(7*nc),hits:0,valid:new Uint8Array(nc)};
  for(let i=0;i<nc;i++){const x=(i+.5)/nc,u=warp(x);let d,m;try{d=prep.surface.differential(u,v);m=E.jetMetric(d);}catch(e){m=null;}
   if(!m){field.bad++;continue;}
   const curve=(a,b)=>{const ax=a[0],ay=a[1],az=a[2],bx=b[0],by=b[1],bz=b[2],cx=ay*bz-az*by,cy=az*bx-ax*bz,cz=ax*by-ay*bx;return Math.hypot(cx,cy,cz)/Math.max(1e-30,ax*ax+ay*ay+az*az)/theta;};
   let ru=Math.max(curve(d.du,d.duu),Math.sqrt(Math.max(0,m.q[0]))/theta)*dwarp(x),rv=Math.max(curve(d.dv,d.dvv),Math.sqrt(Math.max(0,m.q[2]))/theta)*dwarp(y);
   ru=2*nc*Math.atan(theta*ru/(2*nc))/theta;rv=2*nr*Math.atan(theta*rv/(2*nr))/theta;
   if(!curvatureMetric(d,m.n,0,M,0)){field.metricMissing++;M[0]=M[2]=1;M[1]=0;}
   const o=i*7;row.data[o]=ru;row.data[o+1]=rv;row.data[o+2]=Math.hypot(...d.du)*dwarp(x);row.data[o+3]=Math.hypot(...d.dv)*dwarp(y);row.data.set(M,o+4);row.valid[i]=1;row.hits++;
   const value=Math.sqrt(Math.max(0,(m.q[0]+m.q[2]+Math.hypot(m.q[0]-m.q[2],2*m.q[1]))/2))/theta;field.probes.push({u,v,...m,value,direction:.5*Math.atan2(2*m.q[1],m.q[0]-m.q[2])});field.maxValue=Math.max(field.maxValue,value);
  }field.rows.push(row);
 }
 if(!field.probes.length)throw Error('Нет действительных проб поверхности');
  
 for(let j=0;j<nr;j++){const r=field.rows[j];for(let i=0;i<r.count;i++)if(!r.valid[i]){let near=null,best=Infinity;for(let k=0;k<nr;k++){const q=field.rows[k];for(let z=0;z<q.count;z++)if(q.valid[z]){const dd=((j-k)/nr)**2+((i+.5)/r.count-(z+.5)/q.count)**2;if(dd<best){best=dd;near=q.data.subarray(z*7,z*7+7);}}}r.data.set(near,i*7);}}
 field.ms=performance.now()-t0;return field;
}
function sample(field,x,y,out){const rows=field.rows,z=clamp(y*rows.length-.5,0,rows.length-1),j=Math.min(rows.length-2,Math.floor(z)),fy=z-j,A=rows[j],B=rows[j+1];const a=clamp(x*A.count-.5,0,A.count-1),i=Math.min(A.count-2,Math.floor(a)),fa=a-i,b=clamp(x*B.count-.5,0,B.count-1),k=Math.min(B.count-2,Math.floor(b)),fb=b-k;const w0=(1-fy)*(1-fa),w1=(1-fy)*fa,w2=fy*(1-fb),w3=fy*fb;for(let c=0;c<7;c++)out[c]=A.data[7*i+c]*w0+A.data[7*(i+1)+c]*w1+B.data[7*k+c]*w2+B.data[7*(k+1)+c]*w3;
 if(field.stripDensity){const P=field.stripDensity[j],Q=field.stripDensity[j+1];out[field.stripAxis]=P[i]*w0+P[i+1]*w1+Q[k]*w2+Q[k+1]*w3;}return out;}
function quantile(values,z){if(z<=0)return values[0];if(z>=1)return values.at(-1);const q=z*(values.length-1),i=Math.min(values.length-2,Math.floor(q));return values[i]+(values[i+1]-values[i])*(q-i);}
function inverse(cdf,target){const n=cdf.length-1,total=cdf[n];if(!(total>1e-14))return clamp(target,0,1);let lo=0,hi=n;const t=target*total;while(hi-lo>1){const m=(lo+hi)>>1;if(cdf[m]<=t)lo=m;else hi=m;}return (lo+(t-cdf[lo])/(cdf[hi]-cdf[lo]||1))/n;}
function lookup(cdf,t){const n=cdf.length-1,x=clamp(t,0,1)*n,i=Math.min(n-1,Math.floor(x));return cdf[i]+(cdf[i+1]-cdf[i])*(x-i);}
function build(prep,field,type='sector'){
 const start=performance.now(),Bcount=prep.uv.length/2;
 if(prep.flat){const m=new E.BufferMesh(prep,Bcount),a=prep.ids.map(s=>s[0]);m.tri(a[0],a[1],a[2]);m.tri(a[0],a[2],a[3]);const out=m.finish(type,{flat:true,layers:1,axis:'u',rowCounts:[2,2],extraSurfaceCalls:0});out.ms=performance.now()-start;return out;}
 if(field.mode!=='quad')throw Error('Неверный обмер');
 let base=prep.cfg.axis==='v'?1:0;
 if(field.stripAxis!==undefined)base=field.stripAxis;
 else if(prep.cfg.axis==='auto'){const a=prep.cfg.counts[0]+prep.cfg.counts[2],b=prep.cfg.counts[1]+prep.cfg.counts[3];if(b>a)base=1;}
 const bottom=prep.ids[base].slice(),right=prep.ids[(base+1)%4].slice(),top=prep.ids[(base+2)%4].slice().reverse(),left=prep.ids[(base+3)%4].slice().reverse();
 const map=(x,y)=>base?[1-y,x]:[x,y],loc=(u,v)=>base?[v,1-u]:[u,v];
 const bdParams=chain=>Float64Array.from(chain,id=>{const q=loc(prep.uv[2*id],prep.uv[2*id+1]);return q[0];});
 const bs=bdParams(bottom),ts=bdParams(top),ls=Float64Array.from(left,id=>loc(prep.uv[2*id],prep.uv[2*id+1])[1]),rs=Float64Array.from(right,id=>loc(prep.uv[2*id],prep.uv[2*id+1])[1]);
 const rateData=new Float64Array(7),get=(xi,eta)=>{if(base){sample(field,1-eta,xi,rateData);const t=rateData[0];rateData[0]=rateData[1];rateData[1]=t;const v=rateData[2];rateData[2]=rateData[3];rateData[3]=v;const m=rateData[4];rateData[4]=rateData[6];rateData[6]=m;rateData[5]=-rateData[5];}else sample(field,xi,eta,rateData);return rateData;};
 const profile=new Float64Array(33);let total=0;
 for(let j=0;j<32;j++){let rate=0;for(let i=0;i<8;i++)rate=Math.max(rate,get((i+.5)/8,(j+.5)/32)[1]);total+=rate/32;profile[j+1]=total;}
 const nL=left.length-1,nR=right.length-1,nB=bottom.length-1,nT=top.length-1;
 let requested=Math.max(1,Math.ceil(total/1.15));if(nL>1||nR>1)requested=Math.max(2,requested,Math.ceil((nL+nR)*.5));
 const strip=field.stripAxis!==undefined;
  
  
  
 if(strip)requested=Math.max(2,requested,nL,nR);
 const K=strip?requested:Math.min(128,requested),plan=[];let V=Bcount,limited=K!==requested||!!field.bad;
 const cdf=new Float64Array(33),arc=new Float64Array(33);
 for(let j=1;j<K;j++){
  const z=j/K,turn=warp(inverse(profile,z)),y=strip ? .5*(quantile(ls,z)+quantile(rs,z)) : .5*turn+.25*quantile(ls,z)+.25*quantile(rs,z),eta=unwarp(y);
  cdf.fill(0);arc.fill(0);for(let i=0;i<32;i++){const q=get((i+.5)/32,eta);cdf[i+1]=cdf[i]+q[0]/32;arc[i+1]=arc[i]+q[2]/32;}
  const wb=(1-y)**4,wt=y**4,w=1-wb-wt,wanted=Math.max(2,Math.ceil(Math.max(cdf[32]/1.15,wb*nB+wt*nT))),M=Math.min(512,wanted);limited||=wanted!==M;
  if(V+M-1>prep.cfg.maxVertices)throw Error('SurfaceBuilder: section vertex budget exceeded');
  const xs=new Float64Array(M-1),order=new Float64Array(M-1);for(let i=1;i<M;i++){const z=i/M,x=w*(strip&&cdf[32]<=1e-14?z:warp(inverse(cdf,z)))+wb*quantile(bs,z)+wt*quantile(ts,z);xs[i-1]=clamp(x,1e-12,1-1e-12);order[i-1]=strip?x:lookup(arc,unwarp(x))/(arc[32]||1);}
  plan.push({y,xs,order});V+=xs.length;
 }
 const m=new E.BufferMesh(prep,V),localUV=base?new Float64Array(V*2):m.uv;
 if(base)for(let i=0;i<Bcount;i++){localUV[2*i]=prep.uv[2*i+1];localUV[2*i+1]=1-prep.uv[2*i];}
 const add=(x,y)=>{const q=map(x,y),id=m.add(...q);if(base){localUV[2*id]=x;localUV[2*id+1]=y;}return id;};
 const boundaryOrder=chain=>{const out=new Float64Array(chain.length);let sum=0;for(let i=1;i<chain.length;i++){const a=3*chain[i-1],b=3*chain[i];sum+=Math.hypot(prep.positions[a]-prep.positions[b],prep.positions[a+1]-prep.positions[b+1],prep.positions[a+2]-prep.positions[b+2]);out[i]=sum;}for(let i=1;i<out.length;i++)out[i]/=sum;return out;};
 let metricChoices=0,forcedChoices=0,ties=0;
 function choose(a,b,c,d){const x=(localUV[2*a]+localUV[2*b]+localUV[2*c]+localUV[2*d])*.25,y=(localUV[2*a+1]+localUV[2*b+1]+localUV[2*c+1]+localUV[2*d+1])*.25,q=get(unwarp(x),unwarp(y)),m00=q[4],m01=q[5],m11=q[6],dx=localUV[2*d],dy=localUV[2*d+1];const ax=localUV[2*a]-dx,ay=localUV[2*a+1]-dy,bx=localUV[2*b]-dx,by=localUV[2*b+1]-dy,cx=localUV[2*c]-dx,cy=localUV[2*c+1]-dy,qa=m00*ax*ax+2*m01*ax*ay+m11*ay*ay,qb=m00*bx*bx+2*m01*bx*by+m11*by*by,qc=m00*cx*cx+2*m01*cx*cy+m11*cy*cy,t0=qa*(bx*cy-by*cx),t1=qb*(cx*ay-cy*ax),t2=qc*(ax*by-ay*bx),D=t0+t1+t2;if(Math.abs(D)<=4e-14*(Math.abs(t0)+Math.abs(t1)+Math.abs(t2))){ties++;return 0;}metricChoices++;return D>0?1:-1;}
 function stitch(a,b,ta,tb){let i=0,j=0;while(i<a.length-1||j<b.length-1){let lower;
  if(i===a.length-1)lower=false;else if(j===b.length-1)lower=true;
  else if(ta[i+1]<tb[j]){lower=true;forcedChoices++;}else if(tb[j+1]<ta[i]){lower=false;forcedChoices++;}
  else{const d=type==='sector'?choose(a[i],a[i+1],b[j+1],b[j]):0;lower=d?d>0:(ta[i]+ta[i+1])<=(tb[j]+tb[j+1]);}
  if(lower){m.tri(a[i],a[i+1],b[j]);i++;}else{m.tri(a[i],b[j+1],b[j]);j++;}
 }}
 let prev=bottom,po=boundaryOrder(bottom);const leftEnds=[bottom[0]],rightEnds=[bottom.at(-1)],rowCounts=[bottom.length];
 for(const r of plan){const row=Uint32Array.from(r.xs,x=>add(x,r.y));stitch(prev,row,po,r.order);leftEnds.push(row[0]);rightEnds.push(row.at(-1));prev=row;po=r.order;rowCounts.push(row.length);}
 stitch(prev,top,po,boundaryOrder(top));leftEnds.push(top[0]);rightEnds.push(top.at(-1));rowCounts.push(top.length);
 if(plan.length){triangulateChains(left,leftEnds,localUV,(a,b,c)=>m.tri(a,b,c));triangulateChains(rightEnds,right,localUV,(a,b,c)=>m.tri(a,b,c));}
 const out=m.finish(type,{axis:base?'v':'u',layers:K,requestedLayers:requested,limited,rowCounts,interiorRowCounts:rowCounts.slice(1,-1),rowLevels:[0,...plan.map(r=>r.y),1],extraSurfaceCalls:0,metricChoices,forcedChoices,metricTies:ties});out.ms=performance.now()-start;return out;
}
return {analyze,build};
})();

const QuadSections=(()=>{
'use strict';
const E=SBCommon,PI=Math.PI,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const warp=x=>(1-Math.cos(PI*x))*.5,unwarp=u=>Math.acos(clamp(1-2*u,-1,1))/PI;
 
 
 
function boundaryStrip(prep,field){
 if(!prep.cfg.fastPaths||field.bad||prep.uv.length>1024)return null;
 const vertical=prep.ids[0].length===2&&prep.ids[2].length===2,horizontal=prep.ids[1].length===2&&prep.ids[3].length===2;
 if(!vertical&&!horizontal)return null;
 const a=vertical?prep.ids[1]:prep.ids[0],b=(vertical?prep.ids[3]:prep.ids[2]).slice().reverse(),U=prep.uv,P=prep.positions,coord=id=>U[2*id+(vertical?1:0)],triangles=[],planes=[],theta=prep.cfg.angle*PI/180,cos=Math.cos(theta*.5),slope=.5*Math.tan(theta*.5);
 let i=0,j=0;
 while(i<a.length-1||j<b.length-1){
  if(j===b.length-1||i<a.length-1&&coord(a[i])+coord(a[i+1])<=coord(b[j])+coord(b[j+1])){triangles.push([a[i],a[i+1],b[j]]);i++;}
  else{triangles.push([a[i],b[j+1],b[j]]);j++;}
 }
 for(const [a,b,c] of triangles){
  const ax=U[2*a],ay=U[2*a+1],bx=U[2*b]-ax,by=U[2*b+1]-ay,cx=U[2*c]-ax,cy=U[2*c+1]-ay,det=bx*cy-by*cx;
  if(!(det>0))return null;
  const A=P.subarray(3*a,3*a+3),B=[P[3*b]-A[0],P[3*b+1]-A[1],P[3*b+2]-A[2]],C=[P[3*c]-A[0],P[3*c+1]-A[1],P[3*c+2]-A[2]],n=E.cross(B,C),L=E.norm(n),edge=Math.max(E.norm(B),E.norm(C),Math.hypot(B[0]-C[0],B[1]-C[1],B[2]-C[2]));
  if(!(L>edge*edge*1e-12))return null;
  for(let k=0;k<3;k++)n[k]/=L;
  planes.push({ax,ay,bx:bx/det,by:by/det,cx:cx/det,cy:cy/det,A,n,tolerance:edge*slope});
 }
 let minDot=1,maxDistance=0;
 for(const q of field.probes){
  if(!(q.jacobian>Math.hypot(...q.du)*Math.hypot(...q.dv)*.05))return null;
  let found=false;
  for(const t of planes){
   const x=q.u-t.ax,y=q.v-t.ay,s=x*t.cy-y*t.cx,r=t.bx*y-t.by*x;
   if(s < -1e-12||r < -1e-12||s+r>1+1e-12)continue;
   const alignment=E.dot(q.n,t.n),distance=Math.abs((q.p[0]-t.A[0])*t.n[0]+(q.p[1]-t.A[1])*t.n[1]+(q.p[2]-t.A[2])*t.n[2]);
   if(alignment<cos||distance>t.tolerance)return null;
   minDot=Math.min(minDot,alignment);maxDistance=Math.max(maxDistance,distance);found=true;break;
  }
  if(!found)return null;
 }
 return {triangles,maxNormalError:Math.acos(clamp(minDot,-1,1))*180/PI,maxDistance};
}
 
function pair(field,x,y,c,out){const rows=field.rows,z=clamp(y*rows.length-.5,0,rows.length-1),j=Math.min(rows.length-2,Math.floor(z)),fy=z-j,A=rows[j],B=rows[j+1],a=clamp(x*A.count-.5,0,A.count-1),i=Math.min(A.count-2,Math.floor(a)),fa=a-i,b=clamp(x*B.count-.5,0,B.count-1),k=Math.min(B.count-2,Math.floor(b)),fb=b-k,w0=(1-fy)*(1-fa),w1=(1-fy)*fa,w2=fy*(1-fb),w3=fy*fb;
 out[0]=A.data[7*i+c]*w0+A.data[7*(i+1)+c]*w1+B.data[7*k+c]*w2+B.data[7*(k+1)+c]*w3;
 out[1]=A.data[7*i+c+2]*w0+A.data[7*(i+1)+c+2]*w1+B.data[7*k+c+2]*w2+B.data[7*(k+1)+c+2]*w3;
}
 
 
function lineSampler(field,axis,fixed,out){const rows=field.rows,N=rows.length;
 if(!axis){const z=clamp(fixed*N-.5,0,N-1),j=Math.min(N-2,Math.floor(z)),fy=z-j,A=rows[j],B=rows[j+1],NA=A.count,NB=B.count,R=A.data,S=B.data;
  return function(x){const a=clamp(x*NA-.5,0,NA-1),i=Math.min(NA-2,Math.floor(a)),fa=a-i,b=clamp(x*NB-.5,0,NB-1),k=Math.min(NB-2,Math.floor(b)),fb=b-k,w0=(1-fy)*(1-fa),w1=(1-fy)*fa,w2=fy*(1-fb),w3=fy*fb,ia=7*i+4,ib=7*k+4;
   out[0]=R[ia]*w0+R[ia+7]*w1+S[ib]*w2+S[ib+7]*w3;out[1]=R[ia+1]*w0+R[ia+8]*w1+S[ib+1]*w2+S[ib+8]*w3;out[2]=R[ia+2]*w0+R[ia+9]*w1+S[ib+2]*w2+S[ib+9]*w3;
  };
 }
 const ids=new Uint32Array(N),mix=new Float64Array(N);for(let j=0;j<N;j++){const nc=rows[j].count,x=clamp(fixed*nc-.5,0,nc-1),i=Math.min(nc-2,Math.floor(x));ids[j]=7*i+4;mix[j]=x-i;}
 return function(y){const z=clamp(y*N-.5,0,N-1),j=Math.min(N-2,Math.floor(z)),fy=z-j,R=rows[j].data,S=rows[j+1].data,ia=ids[j],ib=ids[j+1],fa=mix[j],fb=mix[j+1],w0=(1-fy)*(1-fa),w1=(1-fy)*fa,w2=fy*(1-fb),w3=fy*fb;
  out[0]=R[ia]*w0+R[ia+7]*w1+S[ib]*w2+S[ib+7]*w3;out[1]=R[ia+1]*w0+R[ia+8]*w1+S[ib+1]*w2+S[ib+8]*w3;out[2]=R[ia+2]*w0+R[ia+9]*w1+S[ib+2]*w2+S[ib+9]*w3;
 };
}
function densityLine(field,axis,fixed){const rows=field.rows,N=rows.length;
 if(!axis){const z=clamp(fixed*N-.5,0,N-1),j=Math.min(N-2,Math.floor(z)),fy=z-j,A=rows[j],B=rows[j+1],NA=A.count,NB=B.count,R=A.data,S=B.data;
  return function(x){const a=clamp(x*NA-.5,0,NA-1),i=Math.min(NA-2,Math.floor(a)),fa=a-i,b=clamp(x*NB-.5,0,NB-1),k=Math.min(NB-2,Math.floor(b)),fb=b-k,w0=(1-fy)*(1-fa),w1=(1-fy)*fa,w2=fy*(1-fb),w3=fy*fb;return R[7*i]*w0+R[7*(i+1)]*w1+S[7*k]*w2+S[7*(k+1)]*w3;};
 }
 const ids=new Uint32Array(N),mix=new Float64Array(N);for(let j=0;j<N;j++){const nc=rows[j].count,x=clamp(fixed*nc-.5,0,nc-1),i=Math.min(nc-2,Math.floor(x));ids[j]=7*i+1;mix[j]=x-i;}
 return function(y){const z=clamp(y*N-.5,0,N-1),j=Math.min(N-2,Math.floor(z)),fy=z-j,R=rows[j].data,S=rows[j+1].data,ia=ids[j],ib=ids[j+1],fa=mix[j],fb=mix[j+1],w0=(1-fy)*(1-fa),w1=(1-fy)*fa,w2=fy*(1-fb),w3=fy*fb;return R[ia]*w0+R[ia+7]*w1+S[ib]*w2+S[ib+7]*w3;};
}
function inverse(cdf,z){const n=cdf.length-1,total=cdf[n];if(!(total>1e-14))return clamp(z,0,1);let lo=0,hi=n,t=z*total;while(hi-lo>1){const m=(lo+hi)>>1;if(cdf[m]<=t)lo=m;else hi=m;}return (lo+(t-cdf[lo])/(cdf[hi]-cdf[lo]||1))/n;}
function quantile(values,z){const x=z*(values.length-1),i=Math.min(values.length-2,Math.floor(x));return values[i]+(values[i+1]-values[i])*(x-i);}
function analyze(prep,measured){const started=performance.now(),field=measured||QuadR1.analyze(prep);if(!field.flat){
 field.boundaryStrip=boundaryStrip(prep,field);
 if(field.boundaryStrip){field.ms=performance.now()-started;return field;}
 field.matchedGrid=QuadMatchedGrid.plan(prep,field);
 if(field.matchedGrid){field.ms=performance.now()-started;return field;}
 const turn=[new Float64Array(33),new Float64Array(33)],length=[new Float64Array(33),new Float64Array(33)],q=new Float64Array(2);
 for(let axis=0;axis<2;axis++)for(let j=0;j<32;j++){let maxTurn=0,maxSpeed=0;for(let i=0;i<8;i++){
  const x=axis?(i+.5)/8:(j+.5)/32,y=axis?(j+.5)/32:(i+.5)/8;pair(field,x,y,axis,q);maxTurn=Math.max(maxTurn,q[0]);maxSpeed=Math.max(maxSpeed,q[1]);
 }turn[axis][j+1]=turn[axis][j]+maxTurn/32;length[axis][j+1]=length[axis][j]+maxSpeed/32;}
 field.contourDemand=Math.min(turn[0][32],turn[1][32])/1.15;field.placement=length;
  
 const lengths=prep.sides.map(s=>s.at(-1).s),u=(lengths[0]+lengths[2])*.5,v=(lengths[1]+lengths[3])*.5;
 if(Math.min(lengths[0],lengths[2])>4*Math.max(lengths[1],lengths[3])||Math.min(lengths[1],lengths[3])>4*Math.max(lengths[0],lengths[2])){
  field.stripAxis=u>v?1:0;const axis=field.stripAxis,component=axis?2:0,theta=prep.cfg.angle*PI/180;
   
   
  let probe=0;field.stripDensity=field.rows.map(row=>Float64Array.from({length:row.count},(_,i)=>{
   if(!row.valid[i])return row.data[7*i+axis];
   const p=field.probes[probe++],t=axis?p.v:p.u,rate=Math.sqrt(Math.max(0,p.q[component]))/theta*PI*Math.sqrt(t*(1-t)),count=axis?field.rows.length:row.count;
   return 2*count*Math.atan(theta*rate/(2*count))/theta;
  }));
 }
 }field.ms=performance.now()-started;return field;}
function build(prep,field,type='sector'){
 const begin=performance.now(),B=prep.uv.length/2,demand=field.contourDemand;
 if(field.matchedGrid)return QuadMatchedGrid.build(prep,field,type);
 if(field.boundaryStrip){const m=new E.BufferMesh(prep,B),plan=field.boundaryStrip;for(const t of plan.triangles)m.tri(...t);const out=m.finish(type,{method:'measured-boundary-strip',limited:false,extraSurfaceCalls:0,maxNormalError:plan.maxNormalError,maxPlaneError:plan.maxDistance});out.ms=performance.now()-begin;return out;}
 if(prep.flat||demand<=1||field.stripAxis!==undefined){const m=QuadR1.build(prep,field,'sector');m.meta.type=type;m.meta.method=field.stripAxis!==undefined?'rail-sections':'sections';m.ms=performance.now()-begin;return m;}
 if(!Number.isFinite(demand)||!field.placement)throw Error('Не подготовлен обмер контуров r4');
 const requested=Math.max(1,Math.ceil(demand*.5)),L=Math.min(64,requested),plan=[],sides=prep.sides.map(side=>Float64Array.from(side,q=>q.t)),cdf=new Float64Array(33);let V=B,limited=L!==requested||!!field.bad;
 const alpha=0.6;const bounds=r=>[(1-alpha)*(r)+alpha*warp(inverse(field.placement[0],r)),(1-alpha)*(1-r)+alpha*warp(inverse(field.placement[0],1-r)),(1-alpha)*(r)+alpha*warp(inverse(field.placement[1],r)),(1-alpha)*(1-r)+alpha*warp(inverse(field.placement[1],1-r))];
 for(let j=1;j<=L;j++){const r=.5*j/(L+1),box=bounds(r),rows=[];
  for(let side=0;side<4;side++){const vertical=side%2,flip=side>=2,lo=vertical?box[2]:box[0],hi=vertical?box[3]:box[1],span=hi-lo,fixed=side===0?box[2]:side===1?box[1]:side===2?box[3]:box[0],a=unwarp(lo),b=unwarp(hi),f=unwarp(fixed),readDensity=densityLine(field,vertical,f);cdf[0]=0;
   for(let k=0;k<32;k++){const z=flip?b-(b-a)*(k+.5)/32:a+(b-a)*(k+.5)/32,value=readDensity(z);cdf[k+1]=cdf[k]+value*(b-a)/32;}
   const distance=side===0?box[2]:side===1?1-box[1]:side===2?1-box[3]:box[0],w=Math.pow(Math.max(0,1-2*distance),3),wanted=Math.max(1,Math.ceil(Math.max(cdf[32]/1.1,prep.cfg.counts[side]*w))),M=Math.min(512,wanted),ts=new Float64Array(M+1);limited||=M!==wanted;ts[M]=1;let bin=0;
   for(let k=1;k<M;k++){const z=k/M,target=z*cdf[32];while(bin<31&&cdf[bin+1]<=target)bin++;const iq=cdf[32]>1e-14?(bin+(target-cdf[bin])/(cdf[bin+1]-cdf[bin]||1))/32:z,u=flip?b-(b-a)*iq:a+(b-a)*iq,t=flip?(hi-warp(u))/span:(warp(u)-lo)/span;ts[k]=0.8*((1-w)*t+w*quantile(sides[side],z))+0.2*z;}
   rows.push(ts);V+=M;
  }plan.push({r,box,rows});
 }
 const centerBox=bounds(.5);V++;const m=new E.BufferMesh(prep,V),U=m.uv,M=new Float64Array(3);let metricChoices=0,metricTies=0;
 function originalSign(a,b,c,d){const dx=U[2*d],dy=U[2*d+1],ax=U[2*a]-dx,ay=U[2*a+1]-dy,bx=U[2*b]-dx,by=U[2*b+1]-dy,cx=U[2*c]-dx,cy=U[2*c+1]-dy,qa=M[0]*ax*ax+2*M[1]*ax*ay+M[2]*ay*ay,qb=M[0]*bx*bx+2*M[1]*bx*by+M[2]*by*by,qc=M[0]*cx*cx+2*M[1]*cx*cy+M[2]*cy*cy;return qa*(bx*cy-by*cx)+qb*(cx*ay-cy*ax)+qc*(ax*by-ay*bx)>=0;}
 function stitch(a,b,side){const axis=side%2,sign=side<2?1:-1,outer=U[2*a[0]+1-axis],inner=U[2*b[0]+1-axis],fixed=unwarp((outer+outer+inner+inner)*.25),read=lineSampler(field,axis,fixed,M);let i=0,j=0;
  while(i<a.length-1||j<b.length-1){let lower;
   if(i===a.length-1)lower=false;else if(j===b.length-1)lower=true;
   else{const ai=a[i],an=a[i+1],bi=b[j],bn=b[j+1],coord=(U[2*ai+axis]+U[2*an+axis]+U[2*bn+axis]+U[2*bi+axis])*.25;read(unwarp(coord));
     
     
    const delta=sign*(U[2*bn+axis]+U[2*bi+axis]-U[2*ai+axis]-U[2*an+axis]),h=Math.abs(U[2*bi+1-axis]-U[2*ai+1-axis]),mt=axis?M[2]:M[0],mn=axis?-M[1]:M[1],D=mt*delta+2*mn*h;
    if(Math.abs(D)<=1e-8*(Math.abs(M[0])+Math.abs(M[1])+Math.abs(M[2]))){metricTies++;lower=originalSign(ai,an,bn,bi);}else lower=D>=0;metricChoices++;
   }
   if(lower){m.tri(a[i],a[i+1],b[j]);i++;}else{m.tri(a[i],b[j+1],b[j]);j++;}
  }
 }
 let prev=prep.ids.map(row=>Array.from(row));
 for(const p of plan){const [x0,x1,y0,y1]=p.box,corners=[m.add(x0,y0),m.add(x1,y0),m.add(x1,y1),m.add(x0,y1)],next=[];
  for(let side=0;side<4;side++){const ts=p.rows[side],ids=new Uint32Array(ts.length);ids[0]=corners[side];ids[ids.length-1]=corners[(side+1)%4];for(let k=1;k<ts.length-1;k++){const t=ts[k];ids[k]=side===0?m.add(x0+(x1-x0)*t,y0):side===1?m.add(x1,y0+(y1-y0)*t):side===2?m.add(x1-(x1-x0)*t,y1):m.add(x0,y1-(y1-y0)*t);}stitch(prev[side],ids,side);next.push(ids);}prev=next;
 }
 const center=m.add(centerBox[0],centerBox[2]);for(const row of prev)for(let i=0;i<row.length-1;i++)m.tri(row[i],row[i+1],center);
 const out=m.finish(type,{axis:'perimeter',method:'physical-contours',layers:L,requestedLayers:requested,limited,rowCounts:[B,...plan.map(p=>p.rows.reduce((n,s)=>n+s.length-1,0)),1],interiorRowCounts:plan.map(p=>p.rows.reduce((n,s)=>n+s.length-1,0)),rowLevels:[0,...plan.map(p=>p.r),.5],contourBounds:plan.map(p=>p.box),centerUV:[centerBox[0],centerBox[2]],contourDemand:demand,extraSurfaceCalls:0,metricChoices,metricTies});out.ms=performance.now()-begin;return out;
}
return {analyze,build};})();

const NgonContours=(()=>{
'use strict';const E=SBCommon,PI=Math.PI,clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),warp=x=>(1-Math.cos(PI*x))*.5,unwarp=x=>Math.acos(clamp(1-2*x,-1,1))/PI,dwarp=x=>PI*.5*Math.sin(PI*x);
const curvatureMetric=SBCommon.curvatureMetric;
 
const inverse=(cdf,z)=>{if(!(cdf.at(-1)>1e-16))return z;let lo=0,hi=cdf.length-1,target=z*cdf[hi];while(hi-lo>1){const m=(lo+hi)>>1;if(cdf[m]<=target)lo=m;else hi=m;}return (lo+(target-cdf[lo])/(cdf[hi]-cdf[lo]||1))/(cdf.length-1);};
function quantile(side,z){const f=clamp(z,0,1)*(side.length-1),i=Math.min(side.length-2,Math.floor(f));return side[i].t+(side[i+1].t-side[i].t)*(f-i);}
function rowSample(row,x,c){const N=row.count;if(N===1)return row.data[c];const f=clamp(x*N-.5,0,N-1),i=Math.min(N-2,Math.floor(f)),t=f-i;return row.data[i*6+c]*(1-t)+row.data[(i+1)*6+c]*t;}
function reader(field,side,eta){const rows=field.sectors[side],R=rows.length;if(R===1){const A=rows[0];return (x,c)=>rowSample(A,x,c);}const z=clamp(eta*R-.5,0,R-1),j=Math.min(R-2,Math.floor(z)),f=z-j,A=rows[j],B=rows[j+1];return (x,c)=>rowSample(A,x,c)*(1-f)+rowSample(B,x,c)*f;}
function analyze(prep){const started=performance.now(),n=prep.n,C=prep.domain,theta=prep.cfg.angle*PI/180,N=prep.cfg.probes,field={mode:'ngon',n,domain:C,theta,requested:N,probes:[],sectors:[],flat:prep.flat,bad:0,metricMissing:0,maxValue:0};if(prep.flat){field.ms=performance.now()-started;return field;}
 const bounded=(rate,width)=>2*Math.atan(theta*rate*width*.5)/(theta*width);
 for(let side=0;side<n;side++){
  const budget=Math.floor(N/n)+(side<N%n?1:0),nr=Math.max(1,Math.round(Math.sqrt(budget))),rows=[],A=C[side],B=C[(side+1)%n],ex=B[0]-A[0],ey=B[1]-A[1];
  for(let j=0;j<nr;j++){
   const nc=Math.floor(budget/nr)+(j<budget%nr?1:0);if(!nc)continue;const eta=(j+.5)/nr,r=warp(eta),q=1-r,dr=dwarp(eta),data=new Float64Array(6*nc),valid=new Uint8Array(nc);let hits=0;
   for(let i=0;i<nc;i++){
    const xi=(i+.5)/nc,t=warp(xi),dt=dwarp(xi),vx=A[0]+t*ex,vy=A[1]+t*ey,u=q*vx,v=q*vy;let d,m;try{d=prep.surface.differential(u,v);m=E.jetMetric(d);}catch(_){m=null;}
    if(!m){field.bad++;continue;}
    const tx=q*ex,ty=q*ey,rx=-vx,ry=-vy,normal=E.rate(m.q,tx,ty,theta),radial=E.rate(m.q,rx,ry,theta);
    const T=d.du.map((x,k)=>x*tx+d.dv[k]*ty),TT=d.duu.map((x,k)=>x*tx*tx+2*d.duv[k]*tx*ty+d.dvv[k]*ty*ty),cross=[T[1]*TT[2]-T[2]*TT[1],T[2]*TT[0]-T[0]*TT[2],T[0]*TT[1]-T[1]*TT[0]],speed2=T.reduce((s,x)=>s+x*x,0),curve=Math.hypot(...cross)/(speed2||1)/theta;
    const speed=Math.hypot(...d.du.map((x,k)=>rx*x+ry*d.dv[k]));const o=6*i;
    data[o]=bounded(Math.max(curve,normal)*dt,1/nc);data[o+1]=bounded(radial*dr,1/nr);data[o+2]=speed*dr;
    if(!curvatureMetric(d,m.n,0,data,o+3)){field.metricMissing++;data[o+3]=1;data[o+4]=0;data[o+5]=1;}
    if(!Number.isFinite(data[o]+data[o+1]+data[o+2])){field.bad++;continue;}
    const a=m.q[0],b=m.q[1],c=m.q[2],disc=Math.hypot(a-c,2*b),hi=Math.max(0,(a+c+disc)/2),lo=Math.max(0,(a+c-disc)/2),value=Math.sqrt(hi)/theta;
    field.probes.push({u,v,...m,value,anisotropy:Math.sqrt((hi+1e-8)/(lo+1e-8)),direction:.5*Math.atan2(2*b,a-c)});field.maxValue=Math.max(field.maxValue,value);valid[i]=1;hits++;
   }
   rows.push({count:nc,data,hits});if(hits&&hits<nc)for(let i=0;i<nc;i++)if(!valid[i]){let k=0,best=Infinity;for(let z=0;z<nc;z++)if(valid[z]&&Math.abs(z-i)<best){best=Math.abs(z-i);k=z;}data.set(data.subarray(6*k,6*k+6),6*i);}
  }
  if(rows.every(row=>!row.hits))throw Error('Нет действительных проб сектора '+side);
  for(let j=0;j<rows.length;j++)if(!rows[j].hits){let k=0,best=Infinity;for(let z=0;z<rows.length;z++)if(rows[z].hits&&Math.abs(z-j)<best){best=Math.abs(z-j);k=z;}for(let i=0;i<rows[j].count;i++)for(let c=0;c<6;c++)rows[j].data[6*i+c]=rowSample(rows[k],(i+.5)/rows[j].count,c);}
   
  for(const row of rows){row.radial=new Float64Array(16);for(let k=0;k<8;k++){row.radial[2*k]=rowSample(row,(k+.5)/8,1);row.radial[2*k+1]=rowSample(row,(k+.5)/8,2);}}
  field.sectors.push(rows);
 }
 const turn=new Float64Array(33),length=new Float64Array(33);for(let j=0;j<32;j++){let peak=0,speed=0;for(let side=0;side<n;side++){const rows=field.sectors[side],R=rows.length,z=clamp((j+.5)/32*R-.5,0,R-1),at=R===1?0:Math.min(R-2,Math.floor(z)),f=R===1?0:z-at,A=rows[at].radial,B=rows[Math.min(at+1,R-1)].radial;for(let k=0;k<16;k+=2){peak=Math.max(peak,A[k]*(1-f)+B[k]*f);speed=Math.max(speed,A[k+1]*(1-f)+B[k+1]*f);}}turn[j+1]=turn[j]+peak/32;length[j+1]=length[j]+speed/32;}
 field.turn=turn;field.length=length;field.demand=turn[32];field.ms=performance.now()-started;return field;
}
function build(prep,field,type='sector'){
 const start=performance.now(),n=prep.n,C=prep.domain,B=prep.uv.length/2;
 if(prep.flat){const m=new E.BufferMesh(prep,B);for(let i=1;i<n-1;i++)m.tri(prep.ids[0][0],prep.ids[i][0],prep.ids[i+1][0]);const out=m.finish(type,{flat:true,layers:0,rowCounts:[B],extraSurfaceCalls:0});out.ms=performance.now()-start;return out;}
 if(field.mode!=='ngon')throw Error('Нужен обмер N-gon');
 const requested=Math.max(1,Math.ceil(field.demand/1.35)),L=Math.min(64,requested),plan=[],cdf=new Float64Array(33);let V=B,limited=!!field.bad||L!==requested;
 for(let j=1;j<=L;j++){
  const z=j/(L+1),r=.4*z+.6*warp(inverse(field.length,z)),q=1-r,eta=unwarp(r),rows=[];
  for(let side=0;side<n;side++){
   const read=reader(field,side,eta);cdf[0]=0;for(let k=0;k<32;k++)cdf[k+1]=cdf[k]+read((k+.5)/32,0)/32;
   const w=q*q*q,desired=Math.max(1,Math.ceil(Math.max(cdf[32]/1.1,w*prep.cfg.counts[side]))),M=Math.min(512,desired),ts=new Float64Array(M+1);limited||=M!==desired;ts[M]=1;
   let bin=0;for(let k=1;k<M;k++){const z=k/M,target=z*cdf[32];while(bin<31&&cdf[bin+1]<=target)bin++;const xi=cdf[32]>1e-16?(bin+(target-cdf[bin])/(cdf[bin+1]-cdf[bin]||1))/32:z;ts[k]=.8*((1-w)*warp(xi)+w*quantile(prep.sides[side],z))+.2*z;}
   rows.push(ts);V+=M;
  }
  plan.push({r,q,rows});
 }
 V++;const mesh=new E.BufferMesh(prep,V),U=mesh.uv;let metricChoices=0;let prev=prep.ids.map(x=>Uint32Array.from(x)),prevQ=1;
 function stitch(a,b,side,qOuter,qInner){const A=C[side],Z=C[(side+1)%n],ex=Z[0]-A[0],ey=Z[1]-A[1],l=Math.hypot(ex,ey),tx=ex/l,ty=ey/l,nx=-ty,ny=tx,h=(qInner-qOuter)*(A[0]*nx+A[1]*ny),qmid=(qOuter+qInner)*.5,read=reader(field,side,unwarp(1-qmid));let i=0,j=0;
  while(i<a.length-1||j<b.length-1){let takeA;
   if(i===a.length-1)takeA=false;else if(j===b.length-1)takeA=true;
   else{
    const ai=a[i],an=a[i+1],bi=b[j],bn=b[j+1],a0=U[2*ai]*tx+U[2*ai+1]*ty,a1=U[2*an]*tx+U[2*an+1]*ty,b0=U[2*bi]*tx+U[2*bi+1]*ty,b1=U[2*bn]*tx+U[2*bn+1]*ty;
    if(type==='parameter')takeA=(a0+a1)<=(b0+b1);
    else{const u=(U[2*ai]+U[2*an]+U[2*bi]+U[2*bn])*.25,v=(U[2*ai+1]+U[2*an+1]+U[2*bi+1]+U[2*bn+1])*.25,t=clamp(((u/qmid-A[0])*ex+(v/qmid-A[1])*ey)/(l*l),0,1),xi=unwarp(t),m0=read(xi,3),m1=read(xi,4),m2=read(xi,5),mtt=m0*tx*tx+2*m1*tx*ty+m2*ty*ty,mtn=m0*tx*nx+m1*(tx*ny+ty*nx)+m2*ty*ny,D=mtt*(b0+b1-a0-a1)+2*mtn*h;takeA=D>=0;metricChoices++;}
   }
   if(takeA){mesh.tri(a[i],a[i+1],b[j]);i++;}else{mesh.tri(a[i],b[j+1],b[j]);j++;}
  }
 }
 for(const p of plan){const ids=C.map(c=>mesh.add(p.q*c[0],p.q*c[1])),next=[];
  for(let side=0;side<n;side++){const a=C[side],b=C[(side+1)%n],ts=p.rows[side],row=new Uint32Array(ts.length);row[0]=ids[side];row[row.length-1]=ids[(side+1)%n];for(let k=1;k<row.length-1;k++)row[k]=mesh.add(p.q*(a[0]+(b[0]-a[0])*ts[k]),p.q*(a[1]+(b[1]-a[1])*ts[k]));stitch(prev[side],row,side,prevQ,p.q);next.push(row);}prev=next;prevQ=p.q;
 }
 const center=mesh.add(0,0);for(const row of prev)for(let i=0;i<row.length-1;i++)mesh.tri(row[i],row[i+1],center);
 const counts=plan.map(p=>p.rows.reduce((s,x)=>s+x.length-1,0)),out=mesh.finish(type,{method:'ngon-contours',layers:L,requestedLayers:requested,limited,rowCounts:[B,...counts,1],interiorRowCounts:counts,rowLevels:[0,...plan.map(p=>p.r),1],extraSurfaceCalls:0,metricChoices});out.ms=performance.now()-start;return out;
}
return {analyze,build,reader};})();














const DigonStrips=(()=>{
  const {cross,dot}=SBCommon, L=a=>Math.hypot(...a);
  function bounds(sides,u){
    const values=[];
    for(let i=0;i<2;i++){
      const side=sides[i],t=i?1-u:u;let lo=0,hi=side.length-1;
      while(hi-lo>1){const m=(lo+hi)>>1;if(side[m].t<=t)lo=m;else hi=m;}
      const a=side[lo].t,b=side[hi].t,y0=a*(1-a),y1=b*(1-b),slope=(y1-y0)/(b-a),y=y0+(t-a)*slope;
      values.push(i?[y,-slope]:[-y,-slope]);
    }
    return {lo:values[0][0],hi:values[1][0],dl:values[0][1],dh:values[1][1]};
  }
  function wrap(kernel,sides){
    return {
      evaluate(u,y){if(u<=0)return kernel.edges[0][0];if(u>=1)return kernel.edges[0][3];const b=bounds(sides,u);return kernel.evaluate(u,(y-b.lo)/(b.hi-b.lo));},
      evaluateInto(u,y,out){if(u<=0){out[0]=kernel.edges[0][0][0];out[1]=kernel.edges[0][0][1];out[2]=kernel.edges[0][0][2];return out;}if(u>=1){out[0]=kernel.edges[0][3][0];out[1]=kernel.edges[0][3][1];out[2]=kernel.edges[0][3][2];return out;}const b=bounds(sides,u);return kernel.evaluateInto(u,(y-b.lo)/(b.hi-b.lo),out);},
      differential(u,y){const b=bounds(sides,u),d=b.hi-b.lo,v=(y-b.lo)/d,q=kernel.differential(u,v),dd=b.dh-b.dl,vu=-(b.dl+v*dd)/d,vy=1/d,vuu=-2*vu*dd/d,vuy=-dd/(d*d);
        return {p:q.p,du:q.du.map((x,k)=>x+q.dv[k]*vu),dv:q.dv.map(x=>x*vy),duu:q.duu.map((x,k)=>x+2*q.duv[k]*vu+q.dvv[k]*vu*vu+q.dv[k]*vuu),duv:q.duv.map((x,k)=>x*vy+q.dvv[k]*vu*vy+q.dv[k]*vuy),dvv:q.dvv.map(x=>x*vy*vy)};},
      parametricDifferential:(u,v)=>kernel.differential(u,v)
    };
  }
  function analyze(p){
    const start=performance.now(),N=p.cfg.probes,nx=Math.max(1,Math.floor(Math.sqrt(N))),ny=Math.ceil(N/nx),ku=new Float64Array(nx),crossSum=new Float64Array(nx),counts=new Uint32Array(nx),probes=[];
    for(let i=0;i<N;i++){
      const x=i%nx,y=Math.floor(i/nx),u=(x+.5)/nx,v=(y+.5)/ny,q=p.surface.parametricDifferential(u,v),raw=cross(q.du,q.dv),len=L(raw),n=raw.map(x=>x/(len||1));
      const a=cross(q.duu,q.dv),b=cross(q.du,q.duv),c=cross(q.duv,q.dv),d=cross(q.du,q.dvv),nu=a.map((x,k)=>x+b[k]),nv=c.map((x,k)=>x+d[k]);
      const rate=w=>len>1e-20?L(w.map((x,k)=>(x-n[k]*dot(w,n))/len)):0,U=rate(nu),V=rate(nv);
      ku[x]=Math.max(ku[x],U);crossSum[x]+=V;counts[x]++;
      const box=bounds(p.sides,u);probes.push({u,v:box.lo+(box.hi-box.lo)*v,p:q.p,n,normalRate:[U,V]});
    }
    const maxV=Math.max(...crossSum.map((s,i)=>s/(counts[i]||1)));
    return {ms:performance.now()-start,ku,maxV,probes,nx};
  }
  function build(p,f){
    const start=performance.now(),theta=p.cfg.angle*Math.PI/180,B=p.uv.length/2;
    let knots=[0,1,...p.sides[0].map(q=>q.t),...p.sides[1].map(q=>1-q.t)].sort((a,b)=>a-b);
    knots=knots.filter((u,i)=>i===0||u-knots[i-1]>1e-12);
    const rows=[0];
    for(let i=1;i<knots.length;i++){
      const a=knots[i-1],b=knots[i],k0=Math.min(f.nx-1,Math.floor(a*f.nx)),k1=Math.min(f.nx-1,Math.floor(b*f.nx));let rate=0;
      for(let k=k0;k<=k1;k++)rate=Math.max(rate,f.ku[k]);
      const count=Math.max(1,Math.ceil((b-a)*rate/theta));
      if(rows.length+count>p.cfg.maxVertices)throw Error('SurfaceBuilder: digon longitudinal vertex budget exceeded');
      for(let j=1;j<=count;j++)rows.push(j===count?b:a+(b-a)*j/count);
    }
    if(rows.length<3||!(p.area>0))throw Error('SurfaceBuilder: digon boundary approximation needs an interior sample on at least one side');
    const wanted=Math.max(1,Math.ceil(f.maxV*1.2/theta)),available=1+Math.floor((p.cfg.maxVertices-B)/(rows.length-2)),columns=Math.min(wanted,available);
    if(columns<1)throw Error('SurfaceBuilder: digon vertex budget exceeded');
    const V=B+(columns-1)*(rows.length-2),mesh=new SBCommon.BufferMesh(p,V),left=p.ids[0],right=p.ids[1].slice().reverse();
    const uAt=id=>mesh.uv[2*id];
    function stitch(a,b){let i=0,j=0;
      while(i+1<a.length||j+1<b.length){
        if(a[i]===b[j]){if(i+1===a.length||j+1===b.length)break;mesh.tri(a[i],a[i+1],b[j+1]);i++;j++;continue;}
        if(i+1<a.length&&j+1<b.length&&a[i+1]===b[j+1]){mesh.tri(a[i],a[i+1],b[j]);i++;j++;continue;}
        if(j+1===b.length||(i+1<a.length&&uAt(a[i+1])<=uAt(b[j+1]))){mesh.tri(a[i],a[i+1],b[j]);i++;}
        else{mesh.tri(a[i],b[j+1],b[j]);j++;}
      }
    }
    let previous=left;
    for(let j=1;j<columns;j++){
      const chain=[left[0]],v=j/columns;
      for(let i=1;i+1<rows.length;i++){const u=rows[i],box=bounds(p.sides,u);chain.push(mesh.add(u,box.lo+(box.hi-box.lo)*v));}
      chain.push(left.at(-1));stitch(previous,chain);previous=chain;
    }
    stitch(previous,right);
    const out=mesh.finish('digon',{method:'digon-metric-strips',longitudinalRows:rows.length,transverseStrips:columns,limited:columns<wanted,underresolved:columns<wanted,extraSurfaceCalls:0});
    out.ms=performance.now()-start;return out;
  }
  return {wrap,bounds,analyze,build};
})();

const TriContours=(()=>{
 function centered(p){const shift=1/3;return {...p,domain:p.domain.map(q=>[q[0]-shift,q[1]-shift]),uv:Float64Array.from(p.uv,x=>x-shift),surface:{differential:(u,v)=>p.surface.differential(u+shift,v+shift)}};}
 return {analyze(p){const f=NgonContours.analyze(centered(p));for(const q of f.probes){q.u+=1/3;q.v+=1/3;}return f;},build(p,f,type){const m=NgonContours.build(centered(p),f,type);for(let i=0;i<m.uv.length;i++)m.uv[i]+=1/3;m.uv.set(p.uv);m.meta.method='tri-contours';return m;}};
})();

 
 
const QuadFamilies=(()=>{
 const D=SurfacePatch,{sub,add,mul,dot,cross,len,unit}=D;
 function classify(edges){
  if(edges.length!==4||edges.some(e=>e.pieces))return null;
  const lengths=edges.map(e=>len(sub(e[3],e[0]))),scale=Math.max(...lengths),width=Math.min(...lengths);
  if(!(width>scale*1e-10))return null;
  const origin=edges[0][0],e=edges.map(c=>c.map(p=>sub(p,origin))),eps=width*1e-10;
  const translated=i=>{const A=e[i],B=e[i+2],delta=sub(B[3],A[0]);return A.every((p,k)=>len(sub(sub(B[3-k],p),delta))<=eps);};
  if(translated(0)&&translated(1))return {kind:'translate',tolerance:eps};
  function circle(c){
   const a=sub(c[1],c[0]),b=sub(c[3],c[2]),la=len(a),lb=len(b);if(!(la>eps&&lb>eps))return null;
   const t0=mul(a,1/la),t1=mul(b,1/lb),normal=cross(t0,t1),sn=len(normal),cs=dot(t0,t1);
   if(sn<1e-5)return null;const axis=mul(normal,1/sn),angle=Math.atan2(sn,cs);if(angle>Math.PI*.51)return null;
   const radial=mul(cross(axis,t0),-1),q=add(mul(radial,cs-1),mul(t0,sn)),chord=sub(c[3],c[0]),radius=dot(chord,q)/dot(q,q);
   if(!(radius>width*1e-8))return null;const center=sub(c[0],mul(radial,radius)),k=4/3*Math.tan(angle/4),end=add(center,add(mul(radial,radius*cs),mul(t0,radius*sn)));
   if(len(sub(end,c[3]))>eps||Math.abs(la-radius*k)>eps||Math.abs(lb-radius*k)>eps)return null;
   return {center,axis,angle,sn,cs};
  }
  for(let base=0;base<2;base++){
   const E=[0,1,2,3].map(i=>e[(base+i)%4]),a=circle(E[1]),b=circle(E[3].slice().reverse());if(!a||!b)continue;
   if(len(sub(a.axis,b.axis))>1e-9||Math.abs(a.angle-b.angle)*scale>eps||len(cross(sub(a.center,b.center),a.axis))>eps)continue;
   const radial=sub(E[0][0],b.center),plane=unit(cross(a.axis,radial)),R=unit(radial),chord=sub(E[0][3],E[0][0]);
   if(E[0].some(p=>Math.abs(dot(sub(p,b.center),plane))>eps||dot(sub(p,b.center),R)<=eps))continue;
    
    
   if(E[0].slice(1).some((p,i)=>dot(sub(p,E[0][i]),chord)<=eps*len(chord)))continue;
    
    
   const tangents=E[0].slice(1).map((p,i)=>unit(sub(p,E[0][i])));
   if(tangents.some((t,i)=>tangents.slice(i+1).some(q=>dot(t,q)<-.9999)))continue;
   const transform=p=>{const v=sub(p,a.center);return add(a.center,add(add(mul(v,a.cs),mul(cross(a.axis,v),a.sn)),mul(a.axis,dot(a.axis,v)*(1-a.cs))));};
   if(!E[0].every((p,k)=>len(sub(transform(p),E[2][3-k]))<=eps))continue;
   return {kind:'rotate',base,angle:a.angle,axis:a.axis,center:add(a.center,origin),tolerance:eps};
  }
  return null;
 }
 return {classify};
})();

 
 
const QuadGrid=(()=>{
 const E=SBCommon;
 function merge(a,b){const out=[0];let i=0,j=0;while(i<a.length||j<b.length){const x=j===b.length||i<a.length&&a[i]<=b[j]?a[i++]:b[j++];if(x>out.at(-1)+1e-9&&x<1-1e-9)out.push(x);}out.push(1);return out;}
 function span(knots,t){let a=0,b=knots.length-1;while(b-a>1){const m=(a+b)>>1;if(knots[m]<=t)a=m;else b=m;}return knots[b]-knots[a];}
 function analyze(p){
  const started=performance.now(),f=QuadR1.analyze(p),xs=merge(p.sides[0].map(q=>q.t),p.sides[2].slice().reverse().map(q=>1-q.t)),ys=merge(p.sides[1].map(q=>q.t),p.sides[3].slice().reverse().map(q=>1-q.t)),theta=p.cfg.angle*Math.PI/180;
  let reason=f.bad?'invalid-jet':null;
  if(p.uv.length/2+(xs.length-2)*(ys.length-2)>p.cfg.maxVertices)reason='grid-vertex-budget';
  for(const q of f.probes){
   const den=Math.hypot(...q.du)*Math.hypot(...q.dv);if(!(q.jacobian>den*.05)){reason='near-parallel-tangents';break;}
    
    
   if(Math.max(Math.sqrt(Math.max(0,q.q[0]))*span(xs,q.u),Math.sqrt(Math.max(0,q.q[2]))*span(ys,q.v))>2.5*theta){reason='interior-turn';break;}
  }
  if(reason){const g=QuadSections.analyze(p,f);g.fastRejected=reason;g.ms=performance.now()-started;return g;}
  f.mode='quad-grid';f.gridPlan={xs,ys};f.ms=performance.now()-started;return f;
 }
 function build(p,f,type='sector'){
  const start=performance.now(),B=p.uv.length/2,{xs,ys}=f.gridPlan,nx=xs.length-2,ny=ys.length-2,V=B+nx*ny,m=new E.BufferMesh(p,V);
  if(!nx||!ny){
   const vertical=!nx,a=vertical?p.ids[1]:p.ids[0],b=vertical?p.ids[3].slice().reverse():p.ids[2].slice().reverse(),coord=id=>m.uv[id*2+(vertical?1:0)];let i=0,j=0;
   while(i<a.length-1||j<b.length-1){if(j===b.length-1||i<a.length-1&&coord(a[i])+coord(a[i+1])<=coord(b[j])+coord(b[j+1])){m.tri(a[i],a[i+1],b[j]);i++;}else{m.tri(a[i],b[j+1],b[j]);j++;}}
   const out=m.finish(type,{method:'tensor-strip',family:p.family.kind,grid:[nx+2,ny+2],extraSurfaceCalls:0,limited:false});out.ms=performance.now()-start;return out;
  }
   
   
  let shear=0;for(const q of f.probes)shear+=E.dot(q.du,q.dv);
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)m.add(xs[i+1],ys[j+1]);
  for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){const a=B+j*nx+i,b=a+1,c=b+nx,d=a+nx;if(shear>0){m.tri(a,b,d);m.tri(b,c,d);}else{m.tri(a,b,c);m.tri(a,c,d);}}
  const inner=[Array.from({length:nx},(_,i)=>B+i),Array.from({length:ny},(_,j)=>B+j*nx+nx-1),Array.from({length:nx},(_,i)=>B+ny*nx-1-i),Array.from({length:ny},(_,j)=>B+(ny-1-j)*nx)];
  for(let side=0;side<4;side++){const a=p.ids[side],b=inner[side],axis=side%2,sign=side<2?1:-1,coord=id=>sign*m.uv[id*2+axis];let i=0,j=0;
   while(i<a.length-1||j<b.length-1){if(j===b.length-1||i<a.length-1&&coord(a[i])+coord(a[i+1])<=coord(b[j])+coord(b[j+1])){m.tri(a[i],a[i+1],b[j]);i++;}else{m.tri(a[i],b[j+1],b[j]);j++;}}
  }
  const out=m.finish(type,{method:'tensor-grid',family:p.family.kind,grid:[nx+2,ny+2],positionMethod:'point-evaluation',extraSurfaceCalls:0,limited:false});
  out.grid={xs:Float64Array.from(xs.slice(1,-1)),ys:Float64Array.from(ys.slice(1,-1))};out.ms=performance.now()-start;return out;
 }
 return {analyze,build};
})();

 
 
 
 
const QuadMatchedGrid=(()=>{
 const E=SBCommon,PI=Math.PI;
 function point(g,i,j,out,o=0){const b=g.b[i],l=g.l[j],du=g.t[i]-b,dv=g.r[j]-l,u=(b+du*l)/(1-du*dv);out[o]=u;out[o+1]=l+dv*u;}
 function locate(a,b,t,mix){let lo=0,hi=a.length-1;while(hi-lo>1){const i=(lo+hi)>>1;if(a[i]+(b[i]-a[i])*mix<=t)lo=i;else hi=i;}return lo;}
 function plan(p,f){
  const c=p.cfg.counts;
   
  if(!p.cfg.fastPaths||p.family||c[0]!==c[2]||c[1]!==c[3]||c[0]<2||c[1]<2)return null;
  const reject=reason=>{f.matchedRejected=reason;return null;};
  if(f.bad||f.metricMissing||f.probes.length!==f.requested)return reject('invalid-measurement');
  const nx=c[0],ny=c[1];if((nx+1)*(ny+1)>p.cfg.maxVertices)return reject('grid-vertex-budget');
  const g={nx,ny,b:Float64Array.from(p.sides[0],q=>q.t),r:Float64Array.from(p.sides[1],q=>q.t),t:Float64Array.from(p.sides[2].slice().reverse(),q=>1-q.t),l:Float64Array.from(p.sides[3].slice().reverse(),q=>1-q.t)};
  for(const [a,b] of [[g.b,g.t],[g.l,g.r]])for(let i=1;i<a.length;i++){
   const x=a[i]-a[i-1],y=b[i]-b[i-1];if(Math.min(x,y)<1e-8||Math.max(x,y)>4*Math.min(x,y))return reject('boundary-spacing');
  }
  const uv=new Float64Array(8),theta=p.cfg.angle*PI/180,turnLimit=(1.15*theta)**2;let maxTurn=0,minSine=1;
  for(const q of f.probes){
   const i=locate(g.b,g.t,q.u,q.v),j=locate(g.l,g.r,q.v,q.u);
   point(g,i,j,uv,0);point(g,i+1,j,uv,2);point(g,i+1,j+1,uv,4);point(g,i,j+1,uv,6);
   for(let k=0;k<4;k++){
    const a=2*k,b=2*((k+1)%4),x=uv[b]-uv[a],y=uv[b+1]-uv[a+1];
    const turn=q.q[0]*x*x+2*q.q[1]*x*y+q.q[2]*y*y;
    if(!Number.isFinite(turn)||turn>turnLimit)return reject('interior-turn');maxTurn=Math.max(maxTurn,turn);
   }
    
   for(let k=0;k<2;k++){const a=2*k,b=a+4,x=uv[b]-uv[a],y=uv[b+1]-uv[a+1],turn=q.q[0]*x*x+2*q.q[1]*x*y+q.q[2]*y*y;if(!Number.isFinite(turn)||turn>2*turnLimit)return reject('interior-diagonal-turn');}
  }
   
   
  for(const q of f.probes){
   const i=locate(g.b,g.t,q.u,q.v),j=locate(g.l,g.r,q.v,q.u);
   point(g,i,j,uv,0);point(g,i+1,j,uv,2);point(g,i+1,j+1,uv,4);point(g,i,j+1,uv,6);
   const A=E.dot(q.du,q.du),B=E.dot(q.du,q.dv),C=E.dot(q.dv,q.dv),J=q.jacobian;
   if(!(J>Math.sqrt(A*C)*.05))return reject('near-parallel-tangents');
   for(let k=0;k<4;k++){
    const a=2*k,b=2*((k+1)%4),d=2*((k+3)%4),x=uv[b]-uv[a],y=uv[b+1]-uv[a+1],u=uv[d]-uv[a],v=uv[d+1]-uv[a+1];
    const length2=A*x*x+2*B*x*y+C*y*y,other2=A*u*u+2*B*u*v+C*v*v,sine=J*(x*v-y*u)/Math.sqrt(length2*other2);
    if(!(sine>=.25))return reject('skewed-grid');minSine=Math.min(minSine,sine);
   }
  }
  g.maxPredictedTurn=Math.sqrt(maxTurn)*180/PI;g.minSine=minSine;return g;
 }
 function build(p,f,type='sector'){
  const start=performance.now(),g=f.matchedGrid,{nx,ny}=g,B=p.uv.length/2,m=new E.BufferMesh(p,(nx+1)*(ny+1)),q=new Float64Array(2);
  for(let j=1;j<ny;j++)for(let i=1;i<nx;i++){point(g,i,j,q);m.add(q[0],q[1]);}
  const id=(i,j)=>j===0?p.ids[0][i]:i===nx?p.ids[1][j]:j===ny?p.ids[2][nx-i]:i===0?p.ids[3][ny-j]:B+(j-1)*(nx-1)+i-1;
  const U=m.uv,unwarp=t=>Math.acos(Math.max(-1,Math.min(1,1-2*t)))/PI;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
   const a=id(i,j),b=id(i+1,j),c=id(i+1,j+1),d=id(i,j+1),x=(U[2*a]+U[2*b]+U[2*c]+U[2*d])*.25,y=(U[2*a+1]+U[2*b+1]+U[2*c+1]+U[2*d+1])*.25;
    
   const row=f.rows[Math.min(f.rows.length-1,Math.floor(unwarp(y)*f.rows.length))],o=7*Math.min(row.count-1,Math.floor(unwarp(x)*row.count))+4,M=row.data;
   const dx=U[2*c]-U[2*a],dy=U[2*c+1]-U[2*a+1],ex=U[2*d]-U[2*b],ey=U[2*d+1]-U[2*b+1];
   if(M[o]*dx*dx+2*M[o+1]*dx*dy+M[o+2]*dy*dy<=M[o]*ex*ex+2*M[o+1]*ex*ey+M[o+2]*ey*ey){m.tri(a,b,c);m.tri(a,c,d);}else{m.tri(a,b,d);m.tri(b,c,d);}
  }
  const out=m.finish(type,{method:'matched-boundary-grid',grid:[nx+1,ny+1],maxPredictedTurn:g.maxPredictedTurn,minGridSine:g.minSine,extraSurfaceCalls:0,limited:false});
  out.ms=performance.now()-start;return out;
 }
 return {plan,build};
})();

const SBAPI=(()=>{
'use strict';
const versions=Object.freeze({2:'DIGON canonical r17',3:'TRI contour ribbons r18',4:'QUAD measured grids r20',5:'N-gon canonical r17'});
const planners={2:DigonStrips,3:TriContours,4:QuadSections,5:NgonContours};
const domains=new Map(),owners=new WeakMap(),preparedSet=new WeakSet();
const finite3=p=>(Array.isArray(p)||ArrayBuffer.isView(p))&&p.length===3&&p.every(Number.isFinite);
const eq3=(a,b)=>a[0]===b[0]&&a[1]===b[1]&&a[2]===b[2];
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const clonePoint=p=>Array.from(p),dot=SBCommon.dot,cross=SBCommon.cross;
const namedError=(message)=>new Error('SurfaceBuilder: '+message);
function domain(n){
 if(!versions[n])throw new RangeError('SurfaceBuilder: supported side count is 2, 3, 4 or 5');
 if(!domains.has(n)){const q=n===2?[[0,0],[1,0]]:n===3?[[0,0],[1,0],[0,1]]:n===4?[[0,0],[1,0],[1,1],[0,1]]:Array.from({length:n},(_,i)=>[Math.cos(-Math.PI/2+2*Math.PI*i/n),Math.sin(-Math.PI/2+2*Math.PI*i/n)]);domains.set(n,Object.freeze(q.map(Object.freeze)));}
 return domains.get(n);
}
function options(input={},o={}){
 const angle=o.angleMax??input.angleMax??8,probes=o.probes??input.probes??64,maxVertices=o.maxVertices??input.maxVertices??250000,axis=o.axis??input.axis??'auto';
 if(!Number.isFinite(angle)||angle<1||angle>180||!Number.isInteger(angle))throw new RangeError('SurfaceBuilder: angleMax must be an integer in [1,180]');
 if(!Number.isSafeInteger(probes)||probes<9||probes>1024)throw new RangeError('SurfaceBuilder: probes must be in [9,1024]');
 if(!Number.isSafeInteger(maxVertices)||maxVertices<6||maxVertices>2000000)throw new RangeError('SurfaceBuilder: invalid vertex budget');
 if(!['auto','u','v'].includes(axis))throw namedError('axis must be auto, u or v');
 const fastPaths=o.fastPaths??input.fastPaths??true;if(typeof fastPaths!=='boolean')throw namedError('fastPaths must be boolean');
 return {angle,probes,maxVertices,axis,fastPaths,template:'sector'};
}
function cloneCurve(input){
 const source=Array.isArray(input)?input:input?.controlPoints;
 if(!Array.isArray(source)||source.length!==4||!source.every(finite3))throw namedError('each curve needs four finite 3D control points');
 const e=source.map(clonePoint),pieces=input.pieces||source.pieces,knots=input.knots||source.knots;
 if(pieces){
  if(!Array.isArray(pieces)||!pieces.length||!knots||knots.length!==pieces.length+1||knots[0]!==0||knots.at(-1)!==1)throw namedError('pieces require explicit increasing knots from 0 to 1');
  e.pieces=pieces.map(p=>{if(!Array.isArray(p)||p.length!==4||!p.every(finite3))throw namedError('invalid cubic piece');return p.map(clonePoint);});e.knots=Array.from(knots);
  for(let i=0;i<e.pieces.length;i++){if(!(e.knots[i+1]>e.knots[i])||!Number.isFinite(e.knots[i+1]))throw namedError('non-increasing knots');if(i&&!eq3(e.pieces[i-1][3],e.pieces[i][0]))throw namedError('pieces must share exact endpoint coordinates');}
  if(!eq3(e[0],e.pieces[0][0])||!eq3(e[3],e.pieces.at(-1)[3]))throw namedError('piece endpoints disagree with logical side');
 }
 return e;
}
function reverseCurve(input){const e=cloneCurve(input),out=e.slice().reverse();if(e.pieces){out.pieces=e.pieces.slice().reverse().map(p=>p.slice().reverse());out.knots=e.knots.slice().reverse().map(t=>1-t);}return out;}
function tangent(e,t){const d=SurfacePatch.tangentVector(e,t),L=Math.hypot(...d);return L?d.map(x=>x/L):[0,0,0];}
function sampleCurve(input,angleMax=8){
 const e=cloneCurve(input);options({angleMax});
 function sampleOne(p){const data={vertices:{a:p[0],b:p[3]},segments:{e:{a:'a',b:'b',ha:p[1].map((x,k)=>x-p[0][k]),hb:p[2].map((x,k)=>x-p[3][k]),soft:true}},approximation:{angle:angleMax}};return FrameAngleSampler.sampleSplineSegment(data,'e');}
 if(!e.pieces)return sampleOne(e);
 const out=[];
 for(let i=0;i<e.pieces.length;i++){
  const a=e.knots[i],w=e.knots[i+1]-a,samples=sampleOne(e.pieces[i]);
  for(let j=0;j<samples.length;j++){if(i&&j===0)continue;const q=samples[j];out.push({...q,t:j===samples.length-1?e.knots[i+1]:a+w*q.t,pieceIndex:i,pieceT:q.t,junction:j===samples.length-1&&i<e.pieces.length-1});}
 }
 return out;
}
function normalizeSample(q,side,index){
 if(!q||typeof q!=='object')throw namedError('invalid sample '+side+':'+index);
 const t=q.bezierT??q.t,p=q.position??q.p;
 if(!Number.isFinite(t)||t<0||t>1||!finite3(p))throw namedError('sample requires native t and finite position ('+side+':'+index+')');
 const key=q.key??null;if(key!==null&&typeof key!=='string'&&!(Number.isSafeInteger(key)&&key>=0))throw namedError('boundary keys must be strings or non-negative safe integers');
 const T=q.exactTangent??q.tangent;
 if(T!==undefined&&!finite3(T))throw namedError('invalid sample tangent');
 return {...q,t,position:clonePoint(p),exactTangent:T?clonePoint(T):null,key};
}
function straightPlanar(edges,counts){
 const O=edges[0][0],scale=Math.max(1,...edges.map(e=>distance(e[0],e[3])));let N=null,L=0;
 for(let i=1;i<edges.length-1&&!N;i++){const a=edges[i][0].map((x,k)=>x-O[k]),b=edges[i+1][0].map((x,k)=>x-O[k]),q=cross(a,b),l=Math.hypot(...q);if(l>1e-14){N=q;L=l;}}
 if(!N)return false;
 for(const e of edges){const chord=e[3].map((x,k)=>x-e[0][k]),l=Math.hypot(...chord);for(const p of e.pieces?e.pieces.flat():e){if(Math.abs(dot(N,p.map((x,k)=>x-O[k])))>1e-12*L*scale)return false;if(Math.hypot(...cross(chord,p.map((x,k)=>x-e[0][k])))>1e-12*l*scale)return false;}}
  
 let sign=0;for(let i=0;i<edges.length;i++){const a=edges[i][0],b=edges[(i+1)%edges.length][0],c=edges[(i+2)%edges.length][0],v=dot(N,cross(b.map((x,k)=>x-a[k]),c.map((x,k)=>x-b[k])));if(Math.abs(v)<1e-20)return false;if(!sign)sign=Math.sign(v);else if(Math.sign(v)!==sign)return false;}
 return true;
}
function prepare(input,o={}){
 const start=performance.now();if(!input||!Array.isArray(input.edges))throw namedError('prepare requires edges');
 const cfg=options(input,o),edges=input.edges.map(cloneCurve),n=edges.length,C=domain(n);
 for(let i=0;i<n;i++){
  const e=edges[i];if(!eq3(e[3],edges[(i+1)%n][0]))throw namedError('adjacent sides must use the same endpoint coordinates');
  if(!(distance(e[0],e[3])>1e-9))throw namedError('degenerate chord at side '+i);
 }
 const samplingStart=performance.now(),supplied=input.samples!==undefined;
 if(supplied&&(!Array.isArray(input.samples)||input.samples.length!==n))throw namedError('one sample array per logical side is required');
 const rawSides=edges.map((e,i)=>{
  const src=supplied?input.samples[i]:sampleCurve(e,cfg.angle);
  if(!Array.isArray(src)||src.length<2)throw namedError('each side requires both endpoint samples');
  const r=src.map((q,j)=>normalizeSample(q,i,j));
  if(r[0].t!==0||r.at(-1).t!==1)throw namedError('sample parameters must include exact 0 and 1');
  if(!eq3(r[0].position,e[0])||!eq3(r.at(-1).position,e[3]))throw namedError('sample endpoints disagree with curve endpoints');
  for(let j=0;j<r.length;j++){
   if(j&&(!(r[j].t>r[j-1].t)||distance(r[j].position,r[j-1].position)===0))throw namedError('samples must be strictly ordered and spatially distinct');
   if(!r[j].exactTangent)r[j].exactTangent=tangent(e,r[j].t);
  }
  if(e.pieces)for(const k of e.knots.slice(1,-1))if(!r.some(q=>Math.abs(q.t-k)<1e-12))throw namedError('missing original piece-junction sample; builder will not insert it');
  return r;
 });
 for(let i=0;i<n;i++){const a=rawSides[i].at(-1),b=rawSides[(i+1)%n][0];if(a.key!==null&&b.key!==null&&a.key!==b.key)throw namedError('conflicting keys at a shared corner');if(a.key===null)a.key=b.key;if(b.key===null)b.key=a.key;}
 const approximationMs=supplied?0:performance.now()-samplingStart,sides=[],ids=[],uv=[],P=[],boundaryKeys=[];
 for(let i=0;i<n;i++){
  let cum=0;const raw=rawSides[i],side=[],row=[];
  for(let j=0;j<raw.length;j++){if(j)cum+=distance(raw[j].position,raw[j-1].position);side.push({...raw[j],t:raw[j].t,bezierT:raw[j].t,p:raw[j].position.slice(),s:cum});}
  if(!(cum>0))throw namedError('degenerate perimeter side');
  if(n!==4)for(let j=0;j<side.length;j++)side[j].t=j===side.length-1?1:side[j].s/cum;
  for(let j=0;j<side.length-1;j++){const q=side[j],t=q.t;row.push(uv.length/2);if(n===2)uv.push(i?1-t:t,(i?1:-1)*t*(1-t));else uv.push(C[i][0]+(C[(i+1)%n][0]-C[i][0])*t,C[i][1]+(C[(i+1)%n][1]-C[i][1])*t);P.push(...q.p);boundaryKeys.push(q.key);}
  sides.push(side);ids.push(row);
 }
 for(let i=0;i<n;i++)ids[i].push(ids[(i+1)%n][0]);
 cfg.counts=sides.map(x=>x.length-1);cfg.n=n;
 if(boundaryKeys.length>cfg.maxVertices)throw namedError('perimeter exceeds vertex budget');
 const seenKeys=new Set();for(const k of boundaryKeys)if(k!==null){if(seenKeys.has(k))throw namedError('one boundary key refers to multiple points within a cell');seenKeys.add(k);}
 const tKernel=performance.now(),surfaceOptions=n===4?{fieldMode:'linear',length:'span',edgeSamples:sides}:{fieldMode:'linear',length:'span',arcMaps:sides,edgeSamples:sides.map(s=>s.map(q=>({...q,t:q.bezierT})))};
 const family=cfg.fastPaths&&n===4?QuadFamilies.classify(edges):null,kernel=SurfacePatch.make(edges,{...surfaceOptions,quadFamily:family,interactive:input.preview===true});
 if(n===4){kernel.differential=FrameQuadJet.differential(kernel);kernel.tangents=FrameQuadJet.tangents(kernel);}else if(n>4){kernel.differential=FrameNgonJet.make(kernel);kernel.tangents=kernel.differential;}
 let position=0,differential=0;
 const mapped=n===2?DigonStrips.wrap(kernel,sides):kernel;
 const surface={evaluate(u,v){position++;return mapped.evaluate(u,v);},evaluateInto(u,v,out){position++;if(mapped.evaluateInto)return mapped.evaluateInto(u,v,out);const q=mapped.evaluate(u,v);out[0]=q[0];out[1]=q[1];out[2]=q[2];return out;},differential(u,v){differential++;return mapped.differential(u,v);},parametricDifferential(u,v){differential++;return kernel.differential(u,v);},evaluateGrid(mesh,out){if(!mapped.evaluateGrid||!mapped.evaluateGrid(mesh.grid.xs,mesh.grid.ys,out,mesh.boundaryCount*3))return false;position+=mesh.vertexCount-mesh.boundaryCount;return true;},counts(){return {position,differential};},reset(){position=differential=0;},kernel};
 const p={n,cfg,family,edges,rawSides,sides,ids,uv:Float64Array.from(uv),positions:Float64Array.from(P),boundaryKeys,domain:C,area:n===2?Math.abs(uv.reduce((sum,x,i)=>i%2?sum:sum+x*uv[(i+3)%uv.length]-uv[i+1]*uv[(i+2)%uv.length],0))/2:n===3?.5:n===4?1:n*Math.sin(2*Math.PI/n)/2,surface,flat:straightPlanar(edges,cfg.counts)&&sides.every((side,i)=>{const e=edges[i],d=e[3].map((x,k)=>x-e[0][k]);let prev=-Infinity;return side.every(q=>{const t=dot(q.p.map((x,k)=>x-e[0][k]),d);const ok=t>prev;prev=t;return ok;});}),parameterization:n===2?'digon-arc-length-lens':n===4?'bezier':'polyline-arc-length',approximationMs,kernelMs:performance.now()-tKernel,prepareMs:performance.now()-start,suppliedSamples:supplied};
 preparedSet.add(p);return p;
}
function checkPrepared(p){if(!preparedSet.has(p))throw namedError('use prepare() to create a cell; raw demo configs are not mesher input');}
function analyze(p){checkPrepared(p);const f=p.family&&!p.flat?QuadGrid.analyze(p):planners[p.n].analyze(p);f.n=p.n;f.domain=p.domain;owners.set(f,p);return f;}
 
 
function flatWithSamples(p){
 const start=performance.now(),B=p.uv.length/2,m=new SBCommon.BufferMesh(p,B),U=p.uv,poly=Array.from({length:B},(_,i)=>i);
 const orient=(a,b,c)=>(U[2*b]-U[2*a])*(U[2*c+1]-U[2*a+1])-(U[2*b+1]-U[2*a+1])*(U[2*c]-U[2*a]);
 while(poly.length>3){let found=false;for(let i=0;i<poly.length;i++){const a=poly[(i+poly.length-1)%poly.length],b=poly[i],c=poly[(i+1)%poly.length];if(!(orient(a,b,c)>1e-20))continue;let blocked=false;for(const q of poly)if(q!==a&&q!==b&&q!==c&&orient(a,b,q)>=-1e-18&&orient(b,c,q)>=-1e-18&&orient(c,a,q)>=-1e-18){blocked=true;break;}if(!blocked){m.tri(a,b,c);poly.splice(i,1);found=true;break;}}if(!found)throw namedError('flat perimeter could not be triangulated without losing samples');}
 m.tri(poly[0],poly[1],poly[2]);const out=m.finish('sector',{flat:true,layers:0,method:'flat-preserved-boundary',extraSurfaceCalls:0});out.ms=performance.now()-start;return out;
}
function withOptions(p,o={}){checkPrepared(p);if(o.angleMax!==undefined&&o.angleMax!==p.cfg.angle)throw namedError('changing angleMax requires a newly supplied / sampled boundary');if(o.fastPaths!==undefined&&o.fastPaths!==p.cfg.fastPaths)throw namedError('changing fastPaths requires prepare()');const cfg={...p.cfg,...options({angleMax:p.cfg.angle,probes:p.cfg.probes,maxVertices:p.cfg.maxVertices,axis:p.cfg.axis,fastPaths:p.cfg.fastPaths},o)};const q={...p,cfg};preparedSet.add(q);return q;}
function build(p,f){checkPrepared(p);if(owners.get(f)!==p)throw namedError('field does not belong to this prepared cell');const m=p.flat&&p.uv.length/2>p.n?flatWithSamples(p):f.mode==='quad-grid'?QuadGrid.build(p,f,'sector'):planners[p.n].build(p,f,'sector');m.meta.algorithm=versions[p.n];if(f.fastRejected)m.meta.fastRejected=f.fastRejected;m.meta.angleMax=p.cfg.angle;m.meta.probeBudget=p.cfg.probes;m.meta.qualityGuaranteed=false;m.boundaryKeys=p.boundaryKeys.slice();m.sideIndices=p.ids.map(s=>Uint32Array.from(s));m.boundary=m.boundaryKeys.flatMap((key,i)=>key===null?[]:[[key,i]]);return m;}
function evaluatePositions(p,m){checkPrepared(p);return SBCommon.evaluatePositions(p,m);}
function meshPrepared(p){const start=performance.now(),field=analyze(p),mesh=build(p,field),q=evaluatePositions(p,mesh);mesh.positions=q.positions;mesh.positionMs=q.ms;mesh.timing={analyzeMs:field.ms,topologyMs:mesh.ms,positionMs:q.ms,totalMs:performance.now()-start};return {prepared:p,field,mesh};}
function buildCell(input,o){const p=prepare(input,o),r=meshPrepared(p);return {...r.mesh,prepared:p,field:r.field,timing:{...r.mesh.timing,prepareMs:p.prepareMs,approximationMs:p.approximationMs,kernelMs:p.kernelMs}};}
function prepareDisplay(f){if(f.n===3&&f.mode==='three')TriThreeCurves.prepareDisplay(f);return f;}
 
function createBoundaryRegistry(angleMax=8){options({angleMax});const data=new Map();
 return Object.freeze({
  register(id,curve,startKey,endKey){if(data.has(id))throw namedError('edge id already registered');if((typeof id!=='string'&&!Number.isSafeInteger(id))||startKey===undefined||endKey===undefined)throw namedError('registry requires explicit edge and endpoint ids');const e=cloneCurve(curve),samples=sampleCurve(e,angleMax);for(let j=0;j<samples.length;j++)samples[j].key=j===0?startKey:j===samples.length-1?endKey:'e:'+typeof id+':'+String(id)+':'+j;data.set(id,{curve:e,samples});return this;},
  oriented(id,reversed=false){const d=data.get(id);if(!d)throw namedError('unknown edge id');return {curve:reversed?reverseCurve(d.curve):cloneCurve(d.curve),samples:reversed?d.samples.slice().reverse().map(q=>({...q,t:1-q.t,position:q.position.slice(),exactTangent:q.exactTangent.map(x=>-x)})):d.samples.map(q=>({...q,position:q.position.slice(),exactTangent:q.exactTangent.slice()}))};},
  get size(){return data.size;}
 });
}
 
function assemble(parts){
 if(!Array.isArray(parts)||!parts.length)throw namedError('assemble requires cell results');
 let cap=0,nIndices=0;for(const p of parts){const m=p.mesh||p;if(!m.positions||!m.indices)throw namedError('assemble requires evaluated positions');cap+=m.positions.length/3;nIndices+=m.indices.length;}
 const positions=new Float64Array(cap*3),indices=new Uint32Array(nIndices),maps=[],ranges=[],registry=new Map();let V=0,T=0;
 for(let ci=0;ci<parts.length;ci++){
  const part=parts[ci],m=part.mesh||part,keys=part.boundaryKeys||m.boundaryKeys||[],rev=!!part.reverse,map=new Uint32Array(m.positions.length/3),start=T;
  for(let i=0;i<map.length;i++){
   const k=i<m.boundaryCount?keys[i]:null;let id=k===undefined||k===null?undefined:registry.get(k);
   if(id===undefined){id=V++;positions.set(m.positions.subarray(3*i,3*i+3),id*3);if(k!==null&&k!==undefined)registry.set(k,id);}
   else for(let c=0;c<3;c++)if(positions[3*id+c]!==m.positions[3*i+c])throw namedError('shared boundary key has conflicting coordinates: '+k);
   map[i]=id;
  }
  for(let i=0;i<m.indices.length;i+=3){indices[T++]=map[m.indices[i]];indices[T++]=map[m.indices[i+(rev?2:1)]];indices[T++]=map[m.indices[i+(rev?1:2)]];}
  maps.push(map);ranges.push({cell:ci,firstIndex:start,indexCount:T-start});
 }
 return {positions:positions.subarray(0,V*3),indices,vertexCount:V,triangleCount:T/3,maps,ranges,sharedBoundaryVertices:registry.size};
}
function encode(input){return JSON.stringify(input,(k,v)=>ArrayBuffer.isView(v)?Array.from(v):Array.isArray(v)&&v.pieces?{controlPoints:Array.from(v),pieces:v.pieces,knots:v.knots}:v,null,2);}
function decode(text){const v=JSON.parse(text);if(!v||!Array.isArray(v.edges))throw namedError('JSON must contain edges');return v;}
return {version:'1.3.2-frame-r20',versions,domain,prepare,withOptions,analyze,build,evaluatePositions,meshPrepared,buildCell,prepareDisplay,sampleCurve,cloneCurve,reverseCurve,createBoundaryRegistry,assemble,encode,decode,SurfacePatch,FrameAngleSampler,FrameQuadJet,FrameNgonJet,algorithms:Object.freeze({digon:DigonStrips,tri:TriContours,quad:QuadSections,ngon:NgonContours}),_common:SBCommon};
})();

root.SurfaceBuilder=SBAPI;
if(typeof module!=='undefined'&&module.exports)module.exports=SBAPI;
})(globalThis);
 
