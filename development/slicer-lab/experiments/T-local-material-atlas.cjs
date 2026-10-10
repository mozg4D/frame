'use strict';
// Restrict a reviewed all-point P certificate to four rigid local domains.
// The remaining arbitrarily long rectangles are proved from fresh source-only
// nominal-W strips. No complete-contour cache, sampling or fitted material target.
const crypto=require('crypto'),fs=require('fs'),path=require('path'),R=require('../core/rational.cjs'),A=require('../core/accuracy-contract.cjs'),{dense}=require('./T-dense-input.cjs'),{hull}=require('../core/trajectory-union-accuracy.cjs'),{planTBody}=require('../core/T-fill-candidate.cjs'),{hash}=require('../core/mesh-section.cjs');
const PIN='a5ce71b8cf9553a1e3ee5986804eaa08c7c51554ee0e4d96b156d4cb02580f63',P=q=>q.map(R.parse),abs=A.abs,minimum=A.min,maximum=A.max;
const PROJECTION_PIN='c03704f2bbce5f1e97b448b270270cd2863563d189c70c7295ffd44f3d7b0375';
const num=q=>q.map(R.number),same=(a,b)=>a.every((q,i)=>R.cmp(q,b[i])===0),unit=d=>d.map(q=>R.rat(!q.n?0n:q.n>0n?1n:-1n)),half=R.rat(1n,2n),Q=n=>R.rat(BigInt(n));
function frame(a){const bars=a.plan.body.rows.filter(q=>q.role==='bar-body'&&q.depth===0),stems=a.plan.body.rows.filter(q=>q.role==='stem-body'&&q.depth===0),w=R.exact(a.W),L=P(bars[0].exactTo),B=P(bars[0].exactFrom),SL=P(stems[0].exactFrom),TL=P(stems[0].exactTo),u=unit(R.vec(B,L)),v=unit(R.vec(TL,SL)),
 O=L.map((q,k)=>R.sub(q,R.mul(R.add(u[k],v[k]),R.mul(w,half)))),relative=p=>[R.div(R.dot(R.vec(p,O),u),w),R.div(R.dot(R.vec(p,O),v),w)],x1=R.sub(relative(SL)[0],half),x3=R.add(R.dot(R.vec(B,L),u),w),width=R.div(x3,w),yt=R.add(relative(TL)[1],half);
 if(a.plan.barRows!==7||a.plan.stemRows!==7||R.cmp(x1,R.rat(41n,4n))<=0||R.cmp(R.sub(width,R.add(x1,Q(7))),R.rat(23n,4n))<=0||R.cmp(yt,R.rat(49n,4n))<=0)throw Error('separated local T source domains required');
 return{w,O,u,v,relative,x1,x2:R.add(x1,Q(7)),x3:width,yt};}
const rectPoly=b=>[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]],bounds=p=>[0,1].map(k=>p.reduce((s,q)=>minimum(s,q[k]),p[0][k])).concat([0,1].map(k=>p.reduce((s,q)=>maximum(s,q[k]),p[0][k]))),
 clamp=(q,a,b)=>maximum(a,minimum(b,q)),distanceToRect=(p,b)=>p.reduce((s,q,k)=>R.add(s,abs(R.sub(q,clamp(q,b[k],b[k+2])))),R.zero),close=p=>p[0].map((q,k)=>q);
function atlasZones(f){return[{name:'left-cap',origin:[R.zero,R.zero],box:[R.zero,R.zero,Q(4),Q(7)]},{name:'junction',origin:[f.x1,R.zero],box:[R.rat(-3n,2n),R.zero,R.rat(17n,2n),Q(8)]},
 {name:'right-cap',origin:[f.x3,R.zero],box:[Q(-4),R.zero,R.zero,Q(7)]},{name:'stem-cap',origin:[f.x1,f.yt],box:[R.zero,Q(-4),Q(7),R.zero]}];}
function innerRect(p,axis){const b=bounds(p),low=axis===0?b[0]:b[1],high=axis===0?b[2]:b[3],transverse=1-axis,at=t=>p.filter(q=>R.cmp(q[axis],t)===0).map(q=>q[transverse]);
 const a=at(low),z=at(high);if(a.length!==2||z.length!==2)throw Error('cardinal constant ribbon required');b[transverse]=maximum(a.reduce(minimum),z.reduce(minimum));b[transverse+2]=minimum(a.reduce(maximum),z.reduce(maximum));return b;}
function views(a,r,f){const global=r.cells.map(q=>q.polygon.map(p=>f.relative(p.map(R.exact)))),zones=atlasZones(f),result=[];let proxyError=R.zero;const ideal=[];
 const constant=r.cells.map((cell,i)=>{if(cell.kind!=='ribbon')return null;const q=a.commands[cell.command];if(q.role==='source-owned-half-W-closure')return{closure:true};const A0=P(q.exactFrom),B0=P(q.exactTo),d=R.vec(B0,A0);
  if(R.cmp(R.parse(q.exactWidthStart),f.w)||R.cmp(R.parse(q.exactWidthEnd),f.w)||d[0].n&&d[1].n)return null;
  const aa=f.relative(A0),bb=f.relative(B0),axis=R.cmp(aa[0],bb[0])!==0?0:1,actual=innerRect(global[i],axis),base=[minimum(aa[0],bb[0]),minimum(aa[1],bb[1]),maximum(aa[0],bb[0]),maximum(aa[1],bb[1])];base[1-axis]=R.sub(base[1-axis],half);base[3-axis]=R.add(base[3-axis],half);
  ideal.push(base);for(const p of rectPoly(base))proxyError=maximum(proxyError,distanceToRect(p,actual));return{axis,line:aa[1-axis],actual};});
 for(const zone of zones){const halo=zone.box.map((q,k)=>R.add(q,R.rat(k<2?-1n:1n,8n))),strips=new Map(),complex=new Map();
  for(let i=0;i<r.cells.length;i++){const q=r.cells[i],poly=global[i].map(p=>p.map((v,k)=>R.sub(v,zone.origin[k]))),b=bounds(poly);if(R.cmp(b[2],halo[0])<0||R.cmp(b[0],halo[2])>0||R.cmp(b[3],halo[1])<0||R.cmp(b[1],halo[3])>0)continue;const c=constant[i];if(c?.closure)continue;
   if(c){const a=c.actual.map((v,k)=>R.sub(v,zone.origin[k%2])),clipped=[maximum(a[0],halo[0]),maximum(a[1],halo[1]),minimum(a[2],halo[2]),minimum(a[3],halo[3])];if(R.cmp(clipped[0],clipped[2])>=0||R.cmp(clipped[1],clipped[3])>=0)continue;
    const key=c.axis+':'+R.str(R.sub(c.line,zone.origin[1-c.axis]));if(!strips.has(key))strips.set(key,{axis:c.axis,rects:[]});strips.get(key).rects.push(clipped);
   }else{if([0,1].some(k=>R.cmp(b[k],halo[k])<0||R.cmp(b[k+2],halo[k+2])>0))throw Error('nonlocal curved T primitive');complex.set(q.kind+':'+q.command,poly);}
  }
  const merged=new Map();for(const [key,s]of strips){const k=1-s.axis,lo=s.rects.reduce((v,b)=>maximum(v,b[k]),s.rects[0][k]),hi=s.rects.reduce((v,b)=>minimum(v,b[k+2]),s.rects[0][k+2]);if(R.cmp(lo,hi)>=0)throw Error('collapsed source strip');
   for(const b of s.rects)proxyError=maximum(proxyError,maximum(abs(R.sub(lo,b[k])),abs(R.sub(hi,b[k+2]))));
   const intervals=s.rects.map(b=>[b[s.axis],b[s.axis+2]]).sort((a,b)=>R.cmp(a[0],b[0])),ranges=[];for(const p of intervals){const old=ranges.at(-1);if(old&&R.cmp(p[0],old[1])<=0)old[1]=maximum(old[1],p[1]);else ranges.push(p.slice());}
   merged.set(key,ranges.map(p=>s.axis===0?[p[0],lo,p[1],hi]:[lo,p[0],hi,p[1]]));
  }
  result.push({name:zone.name,complex,merged,origin:zone.origin,box:zone.box});
 }
 return{zones:result,proxyError,ideal,global,constant};}
function proveRectUnion(target,rects){const rows=rects.filter(b=>R.cmp(b[2],target[0])>0&&R.cmp(b[0],target[2])<0&&R.cmp(b[3],target[1])>0&&R.cmp(b[1],target[3])<0),cuts=[target[1],target[3]];
 for(const b of rows)for(const y of [b[1],b[3]])if(R.cmp(y,target[1])>0&&R.cmp(y,target[3])<0)cuts.push(y);cuts.sort(R.cmp);let work=0;
 for(let k=1;k<cuts.length;k++){if(R.cmp(cuts[k-1],cuts[k])===0)continue;const spans=rows.filter(b=>R.cmp(b[1],cuts[k-1])<=0&&R.cmp(b[3],cuts[k])>=0).map(b=>[b[0],b[2]]).sort((a,b)=>R.cmp(a[0],b[0]));let end=target[0];for(const [a,b]of spans){work++;if(R.cmp(a,end)>0)break;end=maximum(end,b);if(R.cmp(end,target[2])>=0)break;}if(R.cmp(end,target[2])<0)return{covered:false,work};}return{covered:true,work};}
function vertexMatch(reference,actual){let error=R.zero;for(const p of reference){let minimumDistance=null;for(const q of actual){const d=p.reduce((s,v,k)=>R.add(s,abs(R.sub(v,q[k]))),R.zero);minimumDistance=minimumDistance?minimum(minimumDistance,d):d;}if(!minimumDistance)throw Error('missing local T polygon');error=maximum(error,minimumDistance);}
 // Avoid exact half-space work when an already rigorous vertex bound is small.
 // This threshold controls work only: every retained bound enters the budget.
 if(R.cmp(error,R.rat(1n,10000n))<=0)return error;const poly=hull(actual);error=R.zero;
 for(const p of reference){if(poly.length>=3&&poly.every((q,i)=>R.cross(R.vec(poly[(i+1)%poly.length],q),R.vec(p,q)).n>=0n))continue;let nearest=null;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],d=R.vec(b,a),length=R.dot(d,d),t=length.n?maximum(R.zero,minimum(R.one,R.div(R.dot(R.vec(p,a),d),length))):R.zero,q=a.map((v,k)=>R.add(v,R.mul(t,d[k]))),distance=p.reduce((s,v,k)=>R.add(s,abs(R.sub(v,q[k]))),R.zero);nearest=nearest?minimum(nearest,distance):distance;}error=maximum(error,nearest);}return error;}
function createTLocalMaterialAtlas(bytes){const dir=path.resolve(__dirname,'../core'),h=crypto.createHash('sha256');for(const n of fs.readdirSync(dir).filter(n=>/\.(cjs|js)$/.test(n)).sort()){h.update(n);h.update(fs.readFileSync(path.join(dir,n)));}if(h.digest('hex')!=='9ea9e79aebe55061e637b1e137f9836406b6119d0946ce7b622db6aa14db757f')throw Error('reviewed unchanged core required for local atlas');
 if(!Buffer.isBuffer(bytes)||bytes.length>16000000)throw Error('reviewed unit T certificate required');const digest=crypto.createHash('sha256').update(bytes).digest('hex');if(digest!==PIN&&digest!==PROJECTION_PIN)throw Error('reviewed unit T certificate required');const proof=JSON.parse(bytes),a=proof.availableCandidateAllocation,templateKernelRevision=proof.kernelRevision;
 if(digest===PROJECTION_PIN&&(proof.kind!=='synthetic-T-local-material-projection-v1'||proof.originalProofSHA256!==PIN||proof.coreRevision!=='9ea9e79aebe55061e637b1e137f9836406b6119d0946ce7b622db6aa14db757f'))throw Error('projection provenance mismatch');
 if(!proof.checked2DGeometryPassed||!a.completePrescribedMaterialConstructionCertified||a.W!==1||!a.accuracy.accepted)throw Error('complete reviewed unit P proof required');const readReference=views(a,proof.runtime,frame(a)),reference={zones:readReference.zones,proxyError:readReference.proxyError},baseError=R.parse(a.accuracy.totalExactUpperBoundMM);
 if(reference.proxyError.n)throw Error('reviewed nominal strips must have zero proxy loss');
 // Duplicate closure tails contribute no unique source material.
 for(const q of a.plan.courses.filter(q=>q.closed)){const tail=proof.runtime.cells[q.endCommand-1].polygon.map(p=>p.map(R.exact)),first=proof.runtime.cells[q.startCommand].polygon.map(p=>p.map(R.exact));if(vertexMatch(tail,first).n)throw Error('closure material not independently redundant');}
 return{qualify(source,candidate,runtime){require('./T-runtime-commands.cjs').assertOwnedTExecution(runtime,candidate);dense(source,{min:8,max:4096,name:'source contour'});if(candidate.source.length!==source.length||JSON.stringify(candidate.source)!==JSON.stringify(source)||runtime.commands.length!==candidate.commands.length)throw Error('changed atlas source or command graph');
  if(hash(planTBody(source,candidate.W,candidate.count))!==hash(candidate.plan.body))throw Error('changed independent source body');
  const f=frame(candidate),actual=views(candidate,runtime,f);let local=R.zero,matched=0;
  for(let z=0;z<4;z++){const ref=reference.zones[z],now=actual.zones[z];for(const [key,polys]of ref.merged){const current=now.merged.get(key);if(!current||current.length!==polys.length)throw Error('changed local nominal strip partition');for(let i=0;i<polys.length;i++){local=maximum(local,vertexMatch(rectPoly(polys[i]),rectPoly(current[i])));matched++;}}
   for(const [key,poly]of ref.complex){const p=now.complex.get(key);let bound=p?vertexMatch(poly,p):null;const command=Number(key.split(':')[1]);
    // A numerically degenerate bevel may change hull vertices. Transfer its
    // ENTIRE convex polygon to one incident actual cell, never omit it.
    if(bound===null||R.cmp(bound,R.rat(1n,10000n))>0)for(let i=0;i<runtime.cells.length;i++){const cell=runtime.cells[i];if(Math.abs(cell.command-command)>1||runtime.commands[cell.command].component!==runtime.commands[command].component)continue;
     const target=actual.global[i].map(p=>p.map((v,k)=>R.sub(v,now.origin[k]))),distance=vertexMatch(poly,target);bound=bound?minimum(bound,distance):distance;if(!bound.n)break;}
    if(bound===null)throw Error('missing complete local convex correspondence');
    local=maximum(local,bound);matched++;}
  }
  const sourceBodies=[[Q(4),R.zero,R.sub(f.x1,R.rat(3n,2n)),Q(7)],[R.add(f.x2,R.rat(3n,2n)),R.zero,R.sub(f.x3,Q(4)),Q(7)],[f.x1,Q(8),f.x2,R.sub(f.yt,Q(4))]],body=sourceBodies.map(b=>proveRectUnion(b,actual.ideal));
  if(body.some(b=>!b.covered))throw Error('complete fresh source straight material not covered');const error=maximum(R.add(baseError,R.add(reference.proxyError,local)),actual.proxyError),passed=R.cmp(error,R.rat(1n,50n))<=0;
  return{kind:'four-local-domain-and-fresh-straight-source-P-certificate',passed,completePrescribedMaterialConstructionCertified:passed,sourceOriginalCAndPUnchanged:true,
   templateProofSHA256:PIN,templateProofKernelRevision:templateKernelRevision,referenceErrorExactW:R.str(baseError),localMatchedPolygons:matched,exactLocalDirectedVertexErrorW:R.str(local),
   wholeStraightSourceDomains:body,wholeSourceBodyExactCoverage:true,representationErrorExactW:R.str(actual.proxyError),totalExactUpperBoundW:R.str(error),totalUpperBoundW:R.number(error),
   totalExactUpperBoundMM:R.str(R.mul(error,f.w)),sourceFrame:{origin:num(f.O),u:num(f.u),v:num(f.v),leftStemW:R.number(f.x1),barWidthW:R.number(f.x3),heightW:R.number(f.yt)},
   completeContourCacheUsed:false,pointSamplingUsed:false,proof:'reviewed complete P restricted to fixed source domains with halo1/8W; convex vertex correspondence transfers every point; source-only interval sweeps cover all remaining straight domains'};
 }};
}
module.exports={createTLocalMaterialAtlas,frame,proveRectUnion,views};
