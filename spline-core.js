const EPS=1e-9;
const v3=(a=[0,0,0])=>[+a[0]||0,+a[1]||0,+a[2]||0];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const n=len(a);return n>EPS?mul(a,1/n):[0,0,0];};
const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const dist=(a,b)=>len(sub(a,b));
const close=(a,b,e=1e-7)=>dist(a,b)<=e;
const finite=a=>Array.isArray(a)&&a.length>=3&&a.slice(0,3).every(Number.isFinite);

export function normalizeSplineData(data){
  if(!data||typeof data!=='object')throw new Error('invalid spline data');
  data.version=Math.max(2,Math.round(+data.version||0));
  data.approximation={angle:Math.max(1,Math.round(+data.approximation?.angle||5))};
  data.vertices=data.vertices||{};data.segments=data.segments||{};data.sequences=Array.isArray(data.sequences)?data.sequences:[];data.freeHandles=data.freeHandles||{};
  return data;
}
export function createSplineData(approximation={angle:5}){
  return normalizeSplineData({version:2,approximation:{angle:Math.max(1,Math.round(+approximation.angle||5))},next:1,vertices:{},segments:{},sequences:[],freeHandles:{}});
}
export function cloneSplineData(data){return normalizeSplineData(JSON.parse(JSON.stringify(data)));}
const id=(d,p)=>p+(d.next++).toString(36);
export function addSplineVertex(data,position){const h=id(data,'v');data.vertices[h]=v3(position);return h;}
export function addSplineSequence(data,closed=false){const q={id:id(data,'q'),segments:[],closed:!!closed,first:null};data.sequences.push(q);return q.id;}
export function addSplineSegment(data,sequenceId,a,b,ha=[0,0,0],hb=[0,0,0]){
  if(!data.vertices[a]||!data.vertices[b]||a===b)throw new Error('invalid spline segment endpoints');
  const q=data.sequences.find(x=>x.id===sequenceId);if(!q)throw new Error('spline sequence not found');
  const h=id(data,'s');data.segments[h]={id:h,a,b,ha:v3(ha),hb:v3(hb),sequence:sequenceId};q.segments.push(h);if(!q.first)q.first=a;return h;
}
export function segmentPoints(data,segmentOrId){const s=typeof segmentOrId==='string'?data.segments[segmentOrId]:segmentOrId;if(!s)return null;const a=data.vertices[s.a],b=data.vertices[s.b];if(!a||!b)return null;return [a,add(a,s.ha),add(b,s.hb),b];}
export function cubicPoint(points,t){const [a,b,c,d]=points,u=1-t,uu=u*u,tt=t*t;return [u*uu*a[0]+3*uu*t*b[0]+3*u*tt*c[0]+tt*t*d[0],u*uu*a[1]+3*uu*t*b[1]+3*u*tt*c[1]+tt*t*d[1],u*uu*a[2]+3*uu*t*b[2]+3*u*tt*c[2]+tt*t*d[2]];}
export function cubicDerivative(points,t){const [a,b,c,d]=points,u=1-t;return [3*u*u*(b[0]-a[0])+6*u*t*(c[0]-b[0])+3*t*t*(d[0]-c[0]),3*u*u*(b[1]-a[1])+6*u*t*(c[1]-b[1])+3*t*t*(d[1]-c[1]),3*u*u*(b[2]-a[2])+6*u*t*(c[2]-b[2])+3*t*t*(d[2]-c[2])];}
export function cubicSecondDerivative(points,t){const [a,b,c,d]=points;return [6*((1-t)*(c[0]-2*b[0]+a[0])+t*(d[0]-2*c[0]+b[0])),6*((1-t)*(c[1]-2*b[1]+a[1])+t*(d[1]-2*c[1]+b[1])),6*((1-t)*(c[2]-2*b[2]+a[2])+t*(d[2]-2*c[2]+b[2]))];}
function splitPoints(p,t=.5){const a=lerp(p[0],p[1],t),b=lerp(p[1],p[2],t),c=lerp(p[2],p[3],t),d=lerp(a,b,t),e=lerp(b,c,t),m=lerp(d,e,t);return [[p[0],a,d,m],[m,e,c,p[3]]];}
function tangentAt(points,t,side=0){let d=cubicDerivative(points,t),n=len(d);if(n>1e-11)return mul(d,1/n);const direction=side||(t>=1?-1:1);for(let h=1e-8;h<=1e-2;h*=10){const q=Math.max(0,Math.min(1,t+direction*h));d=cubicDerivative(points,q);n=len(d);if(n>1e-11)return mul(d,1/n);}return[0,0,0];}
function angularSpeed(points,t){const d=cubicDerivative(points,t),n2=dot(d,d);if(n2<1e-22)return 0;return len(cross(d,cubicSecondDerivative(points,t)))/n2;}
function simpsonAngle(points,a,b){const m=(a+b)/2;return (b-a)*(angularSpeed(points,a)+4*angularSpeed(points,m)+angularSpeed(points,b))/6;}
function angleLeaves(points,a,b,tol,depth=0,whole=simpsonAngle(points,a,b),out=[]){const m=(a+b)/2,l=simpsonAngle(points,a,m),r=simpsonAngle(points,m,b),sum=l+r;if(depth>=22||Math.abs(sum-whole)<=15*tol){out.push({a,b,theta:Math.max(0,sum+(sum-whole)/15)});return out;}angleLeaves(points,a,m,tol/2,depth+1,l,out);angleLeaves(points,m,b,tol/2,depth+1,r,out);return out;}
function stationaryParameters(points){const scale=Math.max(1,...points.slice(1).map((p,i)=>dist(p,points[i]))),eps=scale*1e-9,candidates=[];let previous=len(cubicDerivative(points,0));for(let i=1;i<256;i++){const t=i/256,current=len(cubicDerivative(points,t)),next=len(cubicDerivative(points,(i+1)/256));if(current<=previous&&current<=next){let a=(i-1)/256,b=(i+1)/256;for(let k=0;k<40;k++){const m1=a+(b-a)/3,m2=b-(b-a)/3;if(len(cubicDerivative(points,m1))<len(cubicDerivative(points,m2)))b=m2;else a=m1;}const root=(a+b)/2;if(len(cubicDerivative(points,root))<=eps&&!candidates.some(x=>Math.abs(x-root)<1e-6))candidates.push(root);}previous=current;}return candidates;}
function angleMap(points){const stationary=stationaryParameters(points),cuts=[0,...stationary,1].sort((a,b)=>a-b),leaves=[];for(let i=1;i<cuts.length;i++){const a=cuts[i-1],b=cuts[i];if(b-a>1e-12)angleLeaves(points,a,b,1e-9,0,simpsonAngle(points,a,b),leaves);}let total=0,table=[{t:0,theta:0}];for(const leaf of leaves){total+=leaf.theta;table.push({t:leaf.b,theta:total});}return {table,total,stationary};}
function invertAngle(points,map,target){if(target<=0)return 0;if(target>=map.total)return 1;let lo=0,hi=map.table.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(map.table[m].theta<target)lo=m;else hi=m;}const row=map.table[lo],end=map.table[hi],base=row.theta,baseT=row.t;let a=baseT,b=end.t,t=a+(b-a)*(target-base)/(end.theta-base);for(let i=0;i<24;i++){const theta=base+angleLeaves(points,baseT,t,1e-10,0,simpsonAngle(points,baseT,t),[]).reduce((v,x)=>v+x.theta,0),f=theta-target;if(Math.abs(f)<1e-10)return t;if(f>0)b=t;else a=t;const w=angularSpeed(points,t),next=w>1e-12?t-f/w:NaN;t=Number.isFinite(next)&&next>a&&next<b?next:(a+b)/2;}return t;}
const angleSampleCache=new Map(),ANGLE_CACHE_LIMIT=2048;
function cachedAngleSamples(points,angle){const key=angle+'|'+JSON.stringify(points),old=angleSampleCache.get(key);if(old){angleSampleCache.delete(key);angleSampleCache.set(key,old);return old;}const map=angleMap(points),angleMax=angle*Math.PI/180,n=Math.max(1,Math.ceil(map.total/angleMax)),parameters=[0];for(let i=1;i<n;i++)parameters.push(invertAngle(points,map,i*map.total/n));for(const t of map.stationary)if(t>1e-9&&t<1-1e-9&&!parameters.some(x=>Math.abs(x-t)<1e-7))parameters.push(t);parameters.push(1);parameters.sort((a,b)=>a-b);const samples=parameters.map(t=>({t,position:cubicPoint(points,t),exactTangent:tangentAt(points,t),stationary:map.stationary.some(x=>Math.abs(x-t)<1e-7)}));angleSampleCache.set(key,samples);if(angleSampleCache.size>ANGLE_CACHE_LIMIT)angleSampleCache.delete(angleSampleCache.keys().next().value);return samples;}
export function sampleSplineSegment(data,segmentId,approx=data.approximation){const points=segmentPoints(data,segmentId),segment=data.segments[segmentId];if(!points||!segment)return[];const angle=Math.max(1,Math.round(+approx?.angle||5));return cachedAngleSamples(points,angle).map(sample=>({...sample,position:sample.position.slice(),exactTangent:sample.exactTangent.slice(),originalSpanID:segmentId,hardOrSoft:(sample.t<=1e-9||sample.t>=1-1e-9)?(segment.soft?'soft':'hard'):'soft'}));}
export function approximateSpline(data){const sequences=[];for(const q of data.sequences){const points=[];for(let si=0;si<q.segments.length;si++){const sid=q.segments[si],samples=sampleSplineSegment(data,sid);for(let i=si?1:0;i<samples.length;i++){const sample=samples[i],item={sequenceId:q.id,segmentId:sid,...sample};if(points.length&&close(points.at(-1).position,item.position,1e-10))points[points.length-1]=item;else points.push(item);}}if(q.closed&&points.length>1&&close(points[0].position,points.at(-1).position))points.pop();sequences.push({id:q.id,closed:q.closed,first:q.first,points});}return sequences;}
export function closestSplinePoint(data,segmentId,project,x,y){const p=segmentPoints(data,segmentId);if(!p)return null;let best={t:0,d2:Infinity,screen:null,position:null};const N=32;for(let i=0;i<=N;i++){const t=i/N,pos=cubicPoint(p,t),s=project(pos),d2=(s[0]-x)**2+(s[1]-y)**2;if(d2<best.d2)best={t,d2,screen:s,position:pos};}let span=1/N;for(let k=0;k<7;k++){const a=Math.max(0,best.t-span),b=Math.min(1,best.t+span),t1=a+(b-a)/3,t2=b-(b-a)/3;for(const t of [a,t1,t2,b]){const pos=cubicPoint(p,t),s=project(pos),d2=(s[0]-x)**2+(s[1]-y)**2;if(d2<best.d2)best={t,d2,screen:s,position:pos};}span*=.45;}return best;}
export function splitSplineSegment(data,segmentId,t){
  const s=data.segments[segmentId],q=s&&data.sequences.find(x=>x.id===s.sequence);if(!s||!q)throw new Error('spline segment not found');t=Math.max(1e-6,Math.min(1-1e-6,+t||.5));const p=segmentPoints(data,s),linear=len(s.ha)<EPS&&len(s.hb)<EPS,[l,r]=splitPoints(p,t),v=addSplineVertex(data,l[3]),left={id:segmentId,a:s.a,b:v,ha:linear?[0,0,0]:sub(l[1],l[0]),hb:linear?[0,0,0]:sub(l[2],l[3]),sequence:s.sequence},rightId=id(data,'s'),right={id:rightId,a:v,b:s.b,ha:linear?[0,0,0]:sub(r[1],r[0]),hb:linear?[0,0,0]:sub(r[2],r[3]),sequence:s.sequence};
  for(const spec of data.patchCells||[]){if(!Array.isArray(spec?.vertices)||!Array.isArray(spec.edges))continue;for(let side=0;side<spec.edges.length;side++){const refs=Array.isArray(spec.edges[side])?spec.edges[side].slice():[spec.edges[side]],at=refs.indexOf(segmentId);if(at<0)continue;let current=spec.vertices[side],forward=null;for(let i=0;i<=at;i++){const edge=data.segments[refs[i]];if(!edge){current=null;break;}if(i===at){forward=edge.a===current;break;}current=edge.a===current?edge.b:(edge.b===current?edge.a:null);if(current==null)break;}if(forward==null)continue;refs.splice(at,1,...(forward?[segmentId,rightId]:[rightId,segmentId]));spec.edges[side]=refs;}}
  data.segments[segmentId]=left;data.segments[rightId]=right;const at=q.segments.indexOf(segmentId);q.segments.splice(at+1,0,rightId);return {vertex:v,left:segmentId,right:rightId,t};
}
export function cleanupSpline(data){const used=new Set();for(const sid of Object.keys(data.segments)){const s=data.segments[sid];if(!s||!data.vertices[s.a]||!data.vertices[s.b]||s.a===s.b){delete data.segments[sid];continue;}used.add(s.a);used.add(s.b);}for(const q of data.sequences){q.segments=q.segments.filter(sid=>data.segments[sid]?.sequence===q.id);if(q.segments.length){const first=data.segments[q.segments[0]],last=data.segments[q.segments.at(-1)];q.first=first.a;q.closed=q.segments.length>=2&&last.b===first.a;}else{q.first=null;q.closed=false;}}data.sequences=data.sequences.filter(q=>q.segments.length);for(const vid of Object.keys(data.vertices))if(!used.has(vid))delete data.vertices[vid];if(data.freeHandles)for(const vid of Object.keys(data.freeHandles))if(!data.vertices[vid])delete data.freeHandles[vid];return data;}
export function deleteSplineElements(data,{vertices=[],segments=[]}={}){const dropV=new Set(vertices),dropS=new Set(segments);for(const [sid,s] of Object.entries(data.segments))if(dropV.has(s.a)||dropV.has(s.b))dropS.add(sid);for(const sid of dropS)delete data.segments[sid];for(const q of data.sequences){const groups=[];let cur=[];for(const sid of q.segments){if(dropS.has(sid)){if(cur.length)groups.push(cur);cur=[];}else cur.push(sid);}if(cur.length)groups.push(cur);if(q.closed&&groups.length>1&&q.segments.length&&dropS.size){const first=q.segments[0],last=q.segments[q.segments.length-1];if(!dropS.has(first)&&!dropS.has(last)){groups[0]=groups[groups.length-1].concat(groups[0]);groups.pop();}}q.segments=groups.shift()||[];q.closed=false;for(const g of groups){const nq={id:id(data,'q'),segments:g,closed:false,first:data.segments[g[0]]?.a||null};for(const sid of g)data.segments[sid].sequence=nq.id;data.sequences.push(nq);}}for(const v of dropV)delete data.vertices[v];cleanupSpline(data);return {vertices:[...dropV],segments:[...dropS]};}
export function weldSplineVertices(data,keep,remove){if(keep===remove||!data.vertices[keep]||!data.vertices[remove])return keep;for(const s of Object.values(data.segments)){if(s.a===remove)s.a=keep;if(s.b===remove)s.b=keep;}for(const q of data.sequences)if(q.first===remove)q.first=keep;if(data.freeHandles?.[remove]&&!data.freeHandles[keep])data.freeHandles[keep]=data.freeHandles[remove];if(data.freeHandles)delete data.freeHandles[remove];delete data.vertices[remove];for(const [sid,s] of Object.entries(data.segments))if(s.a===s.b){delete data.segments[sid];for(const q of data.sequences)q.segments=q.segments.filter(x=>x!==sid);}cleanupSpline(data);return keep;}
export function reverseSplineSequence(data,sequenceId){const q=data.sequences.find(x=>x.id===sequenceId);if(!q)return false;q.segments.reverse();for(const sid of q.segments){const s=data.segments[sid],a=s.a,ha=s.ha;s.a=s.b;s.b=a;s.ha=s.hb;s.hb=ha;}q.first=q.segments.length?data.segments[q.segments[0]].a:null;return true;}
export function setSegmentsAsSequence(data,segmentIds){
  const chosen=[...new Set((segmentIds||[]).filter(sid=>data.segments[sid]))];
  if(!chosen.length)return {ok:false,reason:'no-segments'};
  const chosenSet=new Set(chosen),adj=new Map(),add=(v,sid)=>{let a=adj.get(v);if(!a)adj.set(v,a=[]);a.push(sid);};
  for(const sid of chosen){const s=data.segments[sid];add(s.a,sid);add(s.b,sid);}
  if([...adj.values()].some(a=>a.length>2))return {ok:false,reason:'branched-selection'};
  const endpoints=[...adj].filter(([,a])=>a.length===1).map(([v])=>v);
  if(endpoints.length!==0&&endpoints.length!==2)return {ok:false,reason:'disconnected-selection'};
  const firstSegment=data.segments[chosen[0]],targetId=firstSegment.sequence;
  let start=endpoints.find(v=>v===firstSegment.a)||endpoints.find(v=>v===firstSegment.b)||firstSegment.a;
  const ordered=[],orientations=[],visited=new Set();let vertex=start;
  while(ordered.length<chosen.length){
    const sid=(adj.get(vertex)||[]).find(x=>!visited.has(x));
    if(!sid)break;
    const s=data.segments[sid],reversed=s.a!==vertex;
    ordered.push(sid);orientations.push(reversed);visited.add(sid);vertex=reversed?s.a:s.b;
  }
  if(ordered.length!==chosen.length)return {ok:false,reason:'disconnected-selection'};
  const closed=endpoints.length===0&&vertex===start;
  const originals=data.sequences.slice(),target=originals.find(q=>q.id===targetId);
  if(!target)return {ok:false,reason:'missing-sequence'};
  for(let i=0;i<ordered.length;i++)if(orientations[i]){const s=data.segments[ordered[i]],a=s.a,ha=s.ha;s.a=s.b;s.b=a;s.ha=s.hb;s.hb=ha;}
  const splitRuns=q=>{
    const runs=[];let run=[];
    for(const sid of q.segments){if(chosenSet.has(sid)){if(run.length)runs.push(run);run=[];}else run.push(sid);}
    if(run.length)runs.push(run);
    if(q.closed&&runs.length>1&&!chosenSet.has(q.segments[0])&&!chosenSet.has(q.segments.at(-1))){runs[0]=runs.at(-1).concat(runs[0]);runs.pop();}
    return runs;
  };
  const result=[];
  for(const q of originals){
    const affected=q.segments.some(sid=>chosenSet.has(sid));
    if(!affected){result.push(q);continue;}
    const runs=splitRuns(q);
    if(q.id===targetId){
      target.segments=ordered;target.closed=closed;target.first=data.segments[ordered[0]].a;
      for(const sid of ordered)data.segments[sid].sequence=target.id;
      result.push(target);
      for(const run of runs){const nq={id:id(data,'q'),segments:run,closed:false,first:data.segments[run[0]].a};for(const sid of run)data.segments[sid].sequence=nq.id;result.push(nq);}
    }else if(runs.length){
      q.segments=runs.shift();q.closed=false;q.first=data.segments[q.segments[0]].a;for(const sid of q.segments)data.segments[sid].sequence=q.id;result.push(q);
      for(const run of runs){const nq={id:id(data,'q'),segments:run,closed:false,first:data.segments[run[0]].a};for(const sid of run)data.segments[sid].sequence=nq.id;result.push(nq);}
    }
  }
  data.sequences=result;
  return {ok:true,sequence:target.id,segments:ordered.slice(),closed};
}

function selectedSplineChains(data,segmentIds){
  const ids=[...new Set(segmentIds||[])].filter(sid=>data.segments[sid]).sort(),chosen=new Set(ids),adj=new Map(),addEdge=(vid,sid)=>{let list=adj.get(vid);if(!list)adj.set(vid,list=[]);list.push(sid);};
  if(!ids.length)return {ok:false,reason:'no-segments',chains:[]};
  for(const sid of ids){const s=data.segments[sid];addEdge(s.a,sid);addEdge(s.b,sid);}
  for(const list of adj.values()){list.sort();if(list.length>2)return {ok:false,reason:'branched-selection',chains:[]};}
  const visited=new Set(),chains=[],walk=start=>{const edges=[],vertices=[start];let current=start;
    while(true){const sid=(adj.get(current)||[]).find(x=>chosen.has(x)&&!visited.has(x));if(!sid)break;visited.add(sid);const s=data.segments[sid],reversed=s.a!==current,next=reversed?s.a:s.b;edges.push({id:sid,reversed,s});vertices.push(next);current=next;if(current===start)break;}
    const closed=edges.length>1&&current===start;if(closed)vertices.pop();return {closed,edges,vertices};};
  const endpoints=[...adj].filter(([,list])=>list.length===1).map(([vid])=>vid).sort();
  for(const start of endpoints)if((adj.get(start)||[]).some(sid=>!visited.has(sid)))chains.push(walk(start));
  while(visited.size<ids.length){const sid=ids.find(x=>!visited.has(x)),s=data.segments[sid],start=[s.a,s.b].sort()[0];chains.push(walk(start));}
  if(chains.some(c=>!c.edges.length)||chains.reduce((n,c)=>n+c.edges.length,0)!==ids.length)return {ok:false,reason:'disconnected-selection',chains:[]};
  return {ok:true,reason:null,chains};
}
function stableLinePlane(points,preferredNormal=null){let a=null,b=null,best=0;for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){const d=dist(points[i],points[j]);if(d>best){best=d;a=points[i];b=points[j];}}if(!a||best<EPS)return null;const u=norm(sub(b,a));let normal=preferredNormal&&norm(v3(preferredNormal));if(!normal||len(cross(u,normal))<1e-7){const axes=[[1,0,0],[0,1,0],[0,0,1]].sort((x,y)=>Math.abs(dot(u,x))-Math.abs(dot(u,y)));normal=norm(cross(u,axes[0]));}else normal=norm(sub(normal,mul(u,dot(normal,u))));let dominant=0;if(Math.abs(normal[1])>Math.abs(normal[dominant]))dominant=1;if(Math.abs(normal[2])>Math.abs(normal[dominant]))dominant=2;if(!preferredNormal&&normal[dominant]<0)normal=mul(normal,-1);const origin=points.reduce((sum,p)=>add(sum,p),[0,0,0]).map(x=>x/points.length),v=norm(cross(normal,u));return {origin,normal,u,v,maxError:0,tolerance:Math.max(1e-7,best*1e-6),planar:true,collinear:true};}
export function analyzeSplineOutline(data,segmentIds,{normal=null,tolerance=null}={}){
  const graph=selectedSplineChains(data,segmentIds);if(!graph.ok)return graph;
  const points=[];for(const chain of graph.chains)for(const edge of chain.edges){const p=segmentPoints(data,edge.id);if(p)points.push(...p);}
  let plane=null;if(normal&&len(v3(normal))>EPS){const n=norm(v3(normal)),origin=points.reduce((sum,p)=>add(sum,p),[0,0,0]).map(x=>x/Math.max(1,points.length)),scale=Math.max(1,...points.map(p=>dist(p,origin))),tol=Number.isFinite(tolerance)?Math.max(EPS,+tolerance):Math.max(1e-7,scale*1e-6),maxError=Math.max(0,...points.map(p=>Math.abs(dot(sub(p,origin),n))));let u=null,best=0;for(const p of points){const q=sub(p,origin),projected=sub(q,mul(n,dot(q,n))),l=len(projected);if(l>best){best=l;u=norm(projected);}}if(!u){const axis=[[1,0,0],[0,1,0],[0,0,1]].sort((a,b)=>Math.abs(dot(n,a))-Math.abs(dot(n,b)))[0];u=norm(cross(axis,n));}plane={origin,normal:n,u,v:norm(cross(n,u)),maxError,tolerance:tol,planar:maxError<=tol};}
  else plane=deterministicPlane(points)||stableLinePlane(points);
  if(!plane)return {ok:false,reason:'degenerate-selection',chains:graph.chains,plane:null};
  if(!plane.planar)return {ok:false,reason:'non-planar-selection',chains:graph.chains,plane};
  return {ok:true,reason:null,chains:graph.chains,plane};
}
function orientedSegmentPoints(data,edge){const p=segmentPoints(data,edge.id);return edge.reversed?p.slice().reverse():p;}
function robustCubicTangent(points,t){let d=cubicDerivative(points,t);if(len(d)>EPS)return norm(d);const step=1e-4,a=cubicPoint(points,Math.max(0,t-step)),b=cubicPoint(points,Math.min(1,t+step));d=sub(b,a);if(len(d)>EPS)return norm(d);return norm(sub(points[3],points[0]));}
function outlineNormal(planeNormal,tangent){const n=cross(planeNormal,tangent);return len(n)>EPS?norm(n):[0,0,0];}
function offsetLineIntersection(point,d0,d1,n0,n1,distance,plane){const p0=add(point,mul(n0,distance)),p1=add(point,mul(n1,distance)),to2=p=>[dot(sub(p,plane.origin),plane.u),dot(sub(p,plane.origin),plane.v)],a=to2(p0),b=to2(p1),u=[dot(d0,plane.u),dot(d0,plane.v)],v=[dot(d1,plane.u),dot(d1,plane.v)],den=u[0]*v[1]-u[1]*v[0];if(Math.abs(den)>1e-8){const q=[b[0]-a[0],b[1]-a[1]],t=(q[0]*v[1]-q[1]*v[0])/den,hit=add(p0,mul(d0,t));if(finite(hit))return hit;}const sum=add(n0,n1),fallback=len(sum)>1e-7?norm(sum):(len(n1)>EPS?n1:n0);return add(point,mul(fallback,distance));}
function chainOffsetVertices(data,chain,distance,plane){const result=[],count=chain.vertices.length;for(let i=0;i<count;i++){const vid=chain.vertices[i],point=data.vertices[vid],prev=chain.closed?chain.edges[(i-1+chain.edges.length)%chain.edges.length]:(i?chain.edges[i-1]:null),next=chain.closed?chain.edges[i%chain.edges.length]:(i<chain.edges.length?chain.edges[i]:null);if(!prev||!next){const edge=prev||next,p=orientedSegmentPoints(data,edge),t=prev?1:0,tangent=robustCubicTangent(p,t),normal=outlineNormal(plane.normal,tangent);result.push(add(point,mul(normal,distance)));continue;}const pp=orientedSegmentPoints(data,prev),np=orientedSegmentPoints(data,next),incoming=robustCubicTangent(pp,1),outgoing=robustCubicTangent(np,0),n0=outlineNormal(plane.normal,incoming),n1=outlineNormal(plane.normal,outgoing),soft=!!prev.s.soft&&!!next.s.soft;if(soft){let tangent=add(incoming,outgoing);if(len(tangent)<1e-7)tangent=outgoing;result.push(add(point,mul(outlineNormal(plane.normal,norm(tangent)),distance)));}else result.push(offsetLineIntersection(point,incoming,outgoing,n0,n1,distance,plane));}return result;}
function fitOffsetSegment(data,edge,start,end,distance,plane){const p=orientedSegmentPoints(data,edge),linear=len(edge.s.ha)<EPS&&len(edge.s.hb)<EPS;if(linear)return {ha:[0,0,0],hb:[0,0,0],soft:!!edge.s.soft};const targets=[1/3,2/3].map(t=>{const point=cubicPoint(p,t),tangent=robustCubicTangent(p,t);return add(point,mul(outlineNormal(plane.normal,tangent),distance));}),b0=8/27,b3=1/27,c1=sub(targets[0],add(mul(start,b0),mul(end,b3))),c2=sub(targets[1],add(mul(start,b3),mul(end,b0))),a=4/9,b=2/9,det=a*a-b*b,p1=mul(sub(mul(c1,a),mul(c2,b)),1/det),p2=mul(sub(mul(c2,a),mul(c1,b)),1/det);return {ha:sub(p1,start),hb:sub(p2,end),soft:!!edge.s.soft};}
export function applySplineOutline(data,segmentIds,{distance=0,normal=null,tolerance=null,weldTolerance=1e-6}={}){
  distance=Number(distance);if(!Number.isFinite(distance))throw new Error('outline distance must be finite');if(Math.abs(distance)<EPS)return {data:cloneSplineData(data),generated:{vertices:[],segments:[],components:[]},plane:null,remap:{}};
  const analysis=analyzeSplineOutline(data,segmentIds,{normal,tolerance});if(!analysis.ok){const error=new Error(`outline ${analysis.reason}`);error.reason=analysis.reason;throw error;}
  const out=cloneSplineData(data),generatedVertices=[],generatedSegments=[],componentResults=[];
  for(const sourceChain of analysis.chains){let chain=sourceChain;if(!chain.closed){const organized=setSegmentsAsSequence(out,chain.edges.map(e=>e.id));if(!organized.ok){const error=new Error(`outline ${organized.reason}`);error.reason=organized.reason;throw error;}const q=out.sequences.find(x=>x.id===organized.sequence),edges=q.segments.map(sid=>({id:sid,reversed:false,s:out.segments[sid]})),vertices=[out.segments[edges[0].id].a,...edges.map(e=>out.segments[e.id].b)];chain={closed:false,edges,vertices,sequence:q};}
    else chain={closed:true,edges:sourceChain.edges.map(e=>({id:e.id,reversed:e.reversed,s:out.segments[e.id]})),vertices:sourceChain.vertices.slice()};
    const positions=chainOffsetVertices(out,chain,distance,analysis.plane),offsetVertices=positions.map(p=>{const vid=addSplineVertex(out,p);generatedVertices.push(vid);return vid;}),offsetCurves=chain.edges.map((edge,i)=>fitOffsetSegment(out,edge,positions[i],positions[(i+1)%positions.length],distance,analysis.plane));
    if(chain.closed){const qid=addSplineSequence(out,true),offsetSegments=[];for(let i=0;i<chain.edges.length;i++){const curve=offsetCurves[i],sid=addSplineSegment(out,qid,offsetVertices[i],offsetVertices[(i+1)%offsetVertices.length],curve.ha,curve.hb);if(curve.soft)out.segments[sid].soft=true;generatedSegments.push(sid);offsetSegments.push(sid);}for(let i=0;i<chain.edges.length;i++)if(chain.edges[(i-1+chain.edges.length)%chain.edges.length].s.soft&&chain.edges[i].s.soft)equalSplineTangentDirection(out,[offsetVertices[i]]);componentResults.push({closed:true,sourceSegments:chain.edges.map(e=>e.id),vertices:offsetVertices,segments:offsetSegments});}
    else {const q=chain.sequence,sourceStart=chain.vertices[0],sourceEnd=chain.vertices.at(-1),offsetStart=offsetVertices[0],offsetEnd=offsetVertices.at(-1),capEnd=addSplineSegment(out,q.id,sourceEnd,offsetEnd),offsetSegments=[];generatedSegments.push(capEnd);for(let i=chain.edges.length-1;i>=0;i--){const curve=offsetCurves[i],sid=addSplineSegment(out,q.id,offsetVertices[i+1],offsetVertices[i],curve.hb,curve.ha);if(curve.soft)out.segments[sid].soft=true;generatedSegments.push(sid);offsetSegments.push(sid);}for(let i=1;i<chain.edges.length;i++)if(chain.edges[i-1].s.soft&&chain.edges[i].s.soft)equalSplineTangentDirection(out,[offsetVertices[i]]);const capStart=addSplineSegment(out,q.id,offsetStart,sourceStart);generatedSegments.push(capStart);q.closed=true;q.first=sourceStart;componentResults.push({closed:false,sourceSegments:chain.edges.map(e=>e.id),vertices:offsetVertices,segments:[capEnd,...offsetSegments,capStart]});}
  }
  const remap=weldCoincidentSplineVertices(out,Object.keys(out.vertices),Math.max(EPS,+weldTolerance||1e-6));cleanupSpline(out);return {data:out,generated:{vertices:generatedVertices.map(v=>remap[v]||v).filter(v=>out.vertices[v]),segments:generatedSegments.filter(s=>out.segments[s]),components:componentResults},plane:analysis.plane,remap};
}
export function setSplineFirst(data,sequenceId,vertexId){const q=data.sequences.find(x=>x.id===sequenceId);if(!q||!data.vertices[vertexId]||!q.segments.length)return false;let at=q.segments.findIndex(sid=>data.segments[sid]?.a===vertexId);if(at<0)return false;if(q.closed){q.segments=q.segments.slice(at).concat(q.segments.slice(0,at));q.first=vertexId;return true;}if(at===0){q.first=vertexId;return true;}const oldFirst=data.segments[q.segments[0]].a,oldLast=data.segments[q.segments[q.segments.length-1]].b,cut=q.segments[at-1],bridge=id(data,'s');data.segments[bridge]={id:bridge,a:oldLast,b:oldFirst,ha:[0,0,0],hb:[0,0,0],sequence:q.id};delete data.segments[cut];q.segments=q.segments.slice(at).concat([bridge],q.segments.slice(0,at-1));q.first=vertexId;return true;}
function incident(data,vid){const out=[];for(const s of Object.values(data.segments)){if(s.a===vid)out.push({s,side:'a',incoming:false,other:s.b,key:'ha'});if(s.b===vid)out.push({s,side:'b',incoming:true,other:s.a,key:'hb'});}return out;}
function tangentAxis(data,vid,activeHandle=null){const list=incident(data,vid);if(activeHandle){const q=list.find(x=>x.s.id===activeHandle.segment&&x.side===activeHandle.side),v=q&&q.s[q.key];if(v&&len(v)>EPS)return norm(q.incoming?mul(v,-1):v);}let best=null,bestL=0;for(const q of list){const v=q.s[q.key],n=len(v);if(n>bestL){bestL=n;best=q.incoming?mul(v,-1):v;}}if(best)return norm(best);const sum=[0,0,0];for(const q of list){const chord=sub(data.vertices[q.other],data.vertices[vid]),forward=q.incoming?mul(chord,-1):chord;const n=norm(forward);sum[0]+=n[0];sum[1]+=n[1];sum[2]+=n[2];}if(len(sum)>EPS)return norm(sum);for(const q of list){const c=sub(data.vertices[q.other],data.vertices[vid]);if(len(c)>EPS)return norm(q.incoming?mul(c,-1):c);}return [1,0,0];}
export function equalSplineTangentDirection(data,vertices,activeHandle=null){for(const vid of vertices){const axis=tangentAxis(data,vid,activeHandle);for(const q of incident(data,vid)){const n=len(q.s[q.key]);q.s[q.key]=mul(axis,q.incoming?-n:n);}}}
export function equalSplineTangentLength(data,vertices,activeHandle=null){for(const vid of vertices){const list=incident(data,vid);if(!list.length)continue;let target=null;if(activeHandle){const q=list.find(x=>x.s.id===activeHandle.segment&&x.side===activeHandle.side);if(q)target=len(q.s[q.key]);}if(target===null)target=list.reduce((n,q)=>n+len(q.s[q.key]),0)/list.length;const axis=tangentAxis(data,vid,activeHandle);for(const q of list){const d=len(q.s[q.key])>EPS?norm(q.s[q.key]):mul(axis,q.incoming?-1:1);q.s[q.key]=mul(d,target);}}}
export function setSplineSoft(data,vertices,soft=true,activeHandle=null){for(const vid of vertices){const list=incident(data,vid);for(const q of list)q.s.soft=!!soft;if(!soft){for(const q of list)q.s[q.key]=[0,0,0];continue;}const arms=list.map((q,i)=>({q,i,dir:norm(sub(data.vertices[q.other],data.vertices[vid])),length:dist(data.vertices[vid],data.vertices[q.other])/3})),remaining=new Set(arms.map((_,i)=>i));while(remaining.size>=2){let pair=null,best=Infinity;for(const i of remaining)for(const j of remaining)if(i<j){const score=dot(arms[i].dir,arms[j].dir);if(score<best){best=score;pair=[i,j];}}if(!pair||((arms.length>2)&&best>-.15))break;const [i,j]=pair,axis=norm(sub(arms[i].dir,arms[j].dir));arms[i].q.s[arms[i].q.key]=mul(axis,arms[i].length);arms[j].q.s[arms[j].q.key]=mul(axis,-arms[j].length);remaining.delete(i);remaining.delete(j);}for(const i of remaining){const arm=arms[i];arm.q.s[arm.q.key]=mul(arm.dir,arm.length);}}}
export function duplicateSplineSegments(data,segmentIds){const chosen=new Set(segmentIds.filter(x=>data.segments[x])),vmap=new Map(),newSegments=[],newSequences=[],copyVertex=v=>{if(!vmap.has(v))vmap.set(v,addSplineVertex(data,data.vertices[v]));return vmap.get(v);},copyRun=(run,closed=false)=>{if(!run.length)return;const nq=addSplineSequence(data,closed);newSequences.push(nq);for(const sid of run){const s=data.segments[sid],ns=addSplineSegment(data,nq,copyVertex(s.a),copyVertex(s.b),s.ha,s.hb);if(s.soft)data.segments[ns].soft=true;newSegments.push(ns);}};for(const q of data.sequences.slice()){let runs=[],run=[];for(const sid of q.segments){if(chosen.has(sid))run.push(sid);else if(run.length){runs.push(run);run=[];}}if(run.length)runs.push(run);if(q.closed&&runs.length>1&&chosen.has(q.segments[0])&&chosen.has(q.segments.at(-1))){runs[0]=runs.at(-1).concat(runs[0]);runs.pop();}const all=q.closed&&q.segments.length>0&&q.segments.every(sid=>chosen.has(sid));for(const ids of runs)copyRun(ids,all&&ids.length===q.segments.length);}for(const sid of chosen)if(!newSegments.some(ns=>{const s=data.segments[ns],old=data.segments[sid];return s&&old&&vmap.get(old.a)===s.a&&vmap.get(old.b)===s.b;}))copyRun([sid],false);return {vertices:[...vmap.values()],segments:newSegments,sequences:newSequences};}
export function transformSplineSelection(data,selection,matrix){const vertices=new Set(selection.vertices||[]),handles=selection.handles||[],segments=selection.segments||[];for(const sid of segments){const s=data.segments[sid];if(s){vertices.add(s.a);vertices.add(s.b);}}const tr=p=>{const x=p[0],y=p[1],z=p[2],w=matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15]||1;return [(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])/w,(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])/w,(matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14])/w];};if(vertices.size){for(const vid of vertices){const p=data.vertices[vid];if(!p)continue;const old=p.slice(),np=tr(p);data.vertices[vid]=np;for(const q of incident(data,vid)){const hp=add(old,q.s[q.key]);q.s[q.key]=sub(tr(hp),np);}}return;}for(const h of handles){const s=data.segments[h.segment];if(!s)continue;const vid=h.side==='a'?s.a:s.b,key=h.side==='a'?'ha':'hb',p=data.vertices[vid];s[key]=sub(tr(add(p,s[key])),p);}}

function graphAdjacency(data){const adj=new Map(Object.keys(data.vertices).map(v=>[v,[]]));for(const [sid,s] of Object.entries(data.segments)){if(!adj.has(s.a)||!adj.has(s.b))continue;adj.get(s.a).push({sid,other:s.b});adj.get(s.b).push({sid,other:s.a});}for(const a of adj.values())a.sort((x,y)=>x.sid.localeCompare(y.sid));return adj;}
function cycleKey(vertices){const variants=[],n=vertices.length;for(const source of [vertices,vertices.slice().reverse()])for(let i=0;i<n;i++)variants.push(source.slice(i).concat(source.slice(0,i)).join('|'));return variants.sort()[0];}
function orientedCycle(data,vertices,adj){const edges=[];for(let i=0;i<vertices.length;i++){const from=vertices[i],to=vertices[(i+1)%vertices.length],edge=(adj.get(from)||[]).find(x=>x.other===to);if(!edge)return null;const s=data.segments[edge.sid];edges.push({id:edge.sid,from,to,reversed:s.a!==from});}return {id:'cell:'+cycleKey(vertices),vertices:vertices.slice(),edges};}
function cycleControlPoints(data,cycle){const points=[];for(const edge of cycle.edges){const p=segmentPoints(data,edge.id);if(!p)continue;const q=edge.reversed?p.slice().reverse():p;points.push(q[0],q[1],q[2]);}return points;}
function deterministicPlane(points){if(points.length<3)return null;let ai=0,bi=1,best=-1;for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){const d=dist(points[i],points[j]);if(d>best){best=d;ai=i;bi=j;}}if(best<EPS)return null;const axis=sub(points[bi],points[ai]);let ci=-1,crossBest=-1,normal=null;for(let i=0;i<points.length;i++){const c=[axis[1]*(points[i][2]-points[ai][2])-axis[2]*(points[i][1]-points[ai][1]),axis[2]*(points[i][0]-points[ai][0])-axis[0]*(points[i][2]-points[ai][2]),axis[0]*(points[i][1]-points[ai][1])-axis[1]*(points[i][0]-points[ai][0])],n=len(c);if(n>crossBest){crossBest=n;ci=i;normal=c;}}if(crossBest<EPS)return null;normal=norm(normal);let dominant=0;if(Math.abs(normal[1])>Math.abs(normal[dominant]))dominant=1;if(Math.abs(normal[2])>Math.abs(normal[dominant]))dominant=2;if(normal[dominant]<0)normal=mul(normal,-1);const origin=points.reduce((a,p)=>add(a,p),[0,0,0]).map(x=>x/points.length),u=norm(axis),v=norm([normal[1]*u[2]-normal[2]*u[1],normal[2]*u[0]-normal[0]*u[2],normal[0]*u[1]-normal[1]*u[0]]),scale=Math.max(best,1),maxError=Math.max(...points.map(p=>Math.abs(dot(sub(p,origin),normal)))),tolerance=Math.max(1e-7,scale*1e-6);return {origin,normal,u,v,maxError,tolerance,planar:maxError<=tolerance};}
function findComponents(data,adj){const out=[],seen=new Set();for(const start of adj.keys()){if(seen.has(start)||!(adj.get(start)||[]).length)continue;const vertices=[],edges=new Set(),queue=[start];seen.add(start);while(queue.length){const v=queue.shift();vertices.push(v);for(const q of adj.get(v)||[]){edges.add(q.sid);if(!seen.has(q.other)){seen.add(q.other);queue.push(q.other);}}}out.push({vertices,edges:[...edges]});}return out;}
function branchlessCycle(data,component,adj){if(component.vertices.some(v=>(adj.get(v)||[]).length!==2)||component.edges.length!==component.vertices.length)return null;const start=component.vertices.slice().sort()[0],vertices=[start],used=new Set();let current=start,previous=null;while(used.size<component.edges.length){const edge=(adj.get(current)||[]).find(q=>!used.has(q.sid)&&q.other!==previous)||(adj.get(current)||[]).find(q=>!used.has(q.sid));if(!edge)return null;used.add(edge.sid);previous=current;current=edge.other;if(current===start)break;vertices.push(current);}return current===start&&used.size===component.edges.length?orientedCycle(data,vertices,adj):null;}
function smallCycles(data,component,adj){const allowed=new Set(component.vertices),found=new Map(),max=4;const walk=(start,current,path)=>{if(path.length>max)return;for(const q of adj.get(current)||[]){if(!allowed.has(q.other))continue;if(q.other===start&&path.length>=3){const c=orientedCycle(data,path,adj);if(c)found.set(cycleKey(c.vertices),c);continue;}if(path.length<max&&!path.includes(q.other))walk(start,q.other,path.concat(q.other));}};for(const start of component.vertices)walk(start,start,[start]);return [...found.values()].filter(c=>c.vertices.length===3||c.vertices.length===4);}
function flipCycle(cycle){const reverseEdge=e=>({id:e.id,from:e.to,to:e.from,reversed:!e.reversed}),sides=(cycle.sides||cycle.edges.map(edge=>[edge])).slice().reverse().map(side=>side.slice().reverse().map(reverseEdge));return {...cycle,vertices:[cycle.vertices[0]].concat(cycle.vertices.slice(1).reverse()),sides,edges:sides.flat()};}
function orientPatchCells(data,cells){
  const edgeMap=new Map();
  for(let i=0;i<cells.length;i++)for(const edge of cells[i].edges){
    let owners=edgeMap.get(edge.id);
    if(!owners)edgeMap.set(edge.id,owners=[]);
    owners.push(i);
  }
  const done=new Set();
  for(let seed=0;seed<cells.length;seed++){
    if(done.has(seed))continue;
    const raw=cycleControlPoints(data,cells[seed]),plane=deterministicPlane(raw);
    if(plane&&raw.length>=7){
      const a=raw[0],b=raw[3]||raw[1],c=raw[6]||raw[2];
      const n=norm([(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])]);
      if(dot(n,plane.normal)<0)cells[seed]=flipCycle(cells[seed]);
    }
    const queue=[seed];
    done.add(seed);
    while(queue.length){
      const i=queue.shift(),cell=cells[i];
      for(const edge of cell.edges)for(const j of edgeMap.get(edge.id)||[]){
        if(j===i||done.has(j))continue;
        const other=cells[j].edges.find(e=>e.id===edge.id);
        if(other&&other.from===edge.from)cells[j]=flipCycle(cells[j]);
        done.add(j);
        queue.push(j);
      }
    }
  }
  return cells;
}
function exactClosedCellCover(candidates,edgeIds,limit=150000){
  const byEdge=new Map(edgeIds.map(id=>[id,[]]));candidates.forEach((cell,i)=>cell.edges.forEach(edge=>byEdge.get(edge.id)?.push(i)));if([...byEdge.values()].some(list=>list.length<2))return null;
  const counts=new Map(edgeIds.map(id=>[id,0])),chosen=new Set();let steps=0;
  const valid=i=>!chosen.has(i)&&candidates[i].edges.every(edge=>(counts.get(edge.id)||0)<2),possible=()=>{for(const [edgeId,list] of byEdge){const count=counts.get(edgeId)||0;if(count>2)return false;let available=0;for(const i of list)if(valid(i))available++;if(count+available<2)return false;}return true;};
  const solve=()=>{if(++steps>limit)return false;let target=null,options=null;for(const [edgeId,list] of byEdge){if((counts.get(edgeId)||0)>=2)continue;const usable=list.filter(valid);if(!usable.length)return false;if(!options||usable.length<options.length){target=edgeId;options=usable;if(usable.length===1)break;}}if(!target)return true;for(const i of options){chosen.add(i);for(const edge of candidates[i].edges)counts.set(edge.id,(counts.get(edge.id)||0)+1);if(possible()&&solve())return true;for(const edge of candidates[i].edges)counts.set(edge.id,counts.get(edge.id)-1);chosen.delete(i);}return false;};
  return solve()?[...chosen].map(i=>candidates[i]):null;
}
function explicitPatchSide(data,value,from,to){const ids=(Array.isArray(value)?value:[value]).map(String);if(!ids.length)return null;const edges=[];let vertex=from;for(const sid of ids){const s=data.segments[sid];if(!s)return null;const next=s.a===vertex?s.b:(s.b===vertex?s.a:null);if(!next)return null;edges.push({id:sid,from:vertex,to:next,reversed:s.a!==vertex});vertex=next;}return vertex===to?edges:null;}
function explicitPatchCell(data,spec,vertices){if(!Array.isArray(spec?.edges)||spec.edges.length!==vertices.length)return null;const sides=[];for(let i=0;i<vertices.length;i++){const side=explicitPatchSide(data,spec.edges[i],vertices[i],vertices[(i+1)%vertices.length]);if(!side)return null;sides.push(side);}const edges=sides.flat();return {id:'cell:'+cycleKey(vertices)+':'+sides.map(side=>side.map(x=>x.id).join('+')).join('|'),vertices:vertices.slice(),sides,edges,surfaceControls:Array.isArray(spec.controls)?spec.controls.map(([key,p])=>[key,p.slice()]):null,chartDescriptor:spec.chartDescriptor||null,sourceSpec:spec};}
export function resolveSplineTopology(data){
  const adj=graphAdjacency(data),components=findComponents(data,adj),contours=[],patchCells=[],warnings=[];
  if(Array.isArray(data.patchCells)&&data.patchCells.length){
    const explicit=[];
    for(const spec of data.patchCells){
      const vertices=Array.isArray(spec)?spec:spec?.vertices;if(!Array.isArray(vertices)||vertices.length<3||vertices.some(v=>!data.vertices[v]))continue;
      let cell=!Array.isArray(spec)?explicitPatchCell(data,spec,vertices):null;if(!cell){cell=orientedCycle(data,vertices,adj);if(cell)cell.sides=cell.edges.map(edge=>[edge]);}
      if(!cell)continue;const plane=deterministicPlane(cycleControlPoints(data,cell));cell.plane=plane;cell.planar=!!plane?.planar;explicit.push(cell);
    }
    const edgeUse=new Map();for(const cell of explicit)for(const edge of cell.edges)edgeUse.set(edge.id,(edgeUse.get(edge.id)||0)+1);for(const fill of data.planarFills||[])for(const ref of fill.edges||[]){const id=typeof ref==='string'?ref:ref.id;edgeUse.set(id,(edgeUse.get(id)||0)+1);}
    if(explicit.length===data.patchCells.length&&Object.keys(data.segments).every(id=>(edgeUse.get(id)||0)===2)){if(!explicit.some(cell=>cell.surfaceControls))orientPatchCells(data,explicit);return {components:components.map(c=>({vertices:c.vertices.slice(),edges:c.edges.slice()})),contours:[],planarContours:[],patchCells:explicit,warnings};}
    warnings.push('generated patch-cell cache is stale; topology was resolved automatically');
  }
  for(const component of components){const loop=branchlessCycle(data,component,adj);if(loop){loop.sides=loop.edges.map(edge=>[edge]);const plane=deterministicPlane(cycleControlPoints(data,loop));loop.plane=plane;loop.planar=!!plane?.planar;contours.push(loop);continue;}const candidates=smallCycles(data,component,adj).sort((a,b)=>a.vertices.length-b.vertices.length||a.id.localeCompare(b.id)),closed=exactClosedCellCover(candidates,component.edges),edgeUse=new Map(),cells=closed||[];if(!closed)for(const cell of candidates){if(cell.edges.some(edge=>(edgeUse.get(edge.id)||0)>=2))continue;cells.push(cell);for(const edge of cell.edges)edgeUse.set(edge.id,(edgeUse.get(edge.id)||0)+1);}if(!cells.length&&component.edges.length-component.vertices.length+1>0)warnings.push('ambiguous cyclic cage component');for(const cell of cells){cell.sides=cell.edges.map(edge=>[edge]);const plane=deterministicPlane(cycleControlPoints(data,cell));cell.plane=plane;cell.planar=!!plane?.planar;patchCells.push(cell);}}
  orientPatchCells(data,patchCells);return {components:components.map(c=>({vertices:c.vertices.slice(),edges:c.edges.slice()})),contours,planarContours:contours.filter(c=>c.planar),patchCells,warnings};
}

const orientedEdgePoints=(data,edge)=>{const p=segmentPoints(data,edge.id);return edge.reversed?p.slice().reverse():p.slice();};
const edgeDirection=(points,start=true)=>{
  const endpoint=start?points[0]:points[3],handle=start?points[1]:points[2],other=start?points[3]:points[0],h=sub(handle,endpoint);
  return len(h)>EPS?h:sub(other,endpoint);
};
function sharedVertexNormal(data,vertex){
  const dirs=incident(data,vertex).map(q=>{const h=q.s[q.key],chord=sub(data.vertices[q.other],data.vertices[vertex]);return norm(len(h)>EPS?h:chord);}).filter(x=>len(x)>EPS);
  if(dirs.length<2)return null;
  let candidate=null,best=0;
  for(let i=0;i<dirs.length;i++)for(let j=i+1;j<dirs.length;j++){const c=cross(dirs[i],dirs[j]),n=len(c);if(n>best){best=n;candidate=mul(c,1/n);}}
  if(!candidate||best<1e-5)return null;
  const residual=Math.max(...dirs.map(d=>Math.abs(dot(d,candidate))));
  return residual<.12?candidate:null;
}
const elevateCubicToQuartic=p=>[p[0],lerp(p[0],p[1],.75),lerp(p[1],p[2],.5),lerp(p[2],p[3],.25),p[3]];
const bernstein3=(i,t)=>{const u=1-t;return i===0?u*u*u:i===1?3*u*u*t:i===2?3*u*t*t:t*t*t;};
const bernstein4=(i,t)=>{const u=1-t;return i===0?u*u*u*u:i===1?4*u*u*u*t:i===2?6*u*u*t*t:i===3?4*u*t*t*t:t*t*t*t;};
const curvePoint=(controls,t,degree)=>controls.reduce((p,c,i)=>add(p,mul(c,(degree===3?bernstein3:bernstein4)(i,t))),[0,0,0]);
function solveLinearSystem(matrix,rhs){
  const n=rhs.length,a=matrix.map((row,i)=>row.slice().concat(rhs[i]));
  for(let col=0;col<n;col++){
    let pivot=col;for(let row=col+1;row<n;row++)if(Math.abs(a[row][col])>Math.abs(a[pivot][col]))pivot=row;
    if(Math.abs(a[pivot][col])<1e-12)continue;
    [a[col],a[pivot]]=[a[pivot],a[col]];const scale=a[col][col];for(let j=col;j<=n;j++)a[col][j]/=scale;
    for(let row=0;row<n;row++)if(row!==col){const factor=a[row][col];if(Math.abs(factor)<1e-14)continue;for(let j=col;j<=n;j++)a[row][j]-=factor*a[col][j];}
  }
  return a.map((row,i)=>Number.isFinite(row[n])?row[n]:rhs[i]);
}
function leastSquares(rows,values,baseline,regularization=2e-4){
  const n=baseline.length,matrix=Array.from({length:n},()=>Array(n).fill(0)),rhs=Array(n).fill(0);
  for(let r=0;r<rows.length;r++)for(let i=0;i<n;i++){rhs[i]+=rows[r][i]*values[r];for(let j=0;j<n;j++)matrix[i][j]+=rows[r][i]*rows[r][j];}
  for(let i=0;i<n;i++){matrix[i][i]+=regularization;rhs[i]+=regularization*baseline[i];}
  return solveLinearSystem(matrix,rhs);
}
function cellCornerNormals(data,cell,edgePoints){
  const fallback=[];
  for(let i=0;i<3;i++){
    const next=edgeDirection(edgePoints[i],true),previous=edgeDirection(edgePoints[(i+2)%3],false),n=norm(cross(next,previous));
    fallback.push(n);
  }
  let reference=norm(fallback.reduce((sum,n)=>add(sum,n),[0,0,0]));
  if(len(reference)<EPS)reference=norm(cross(sub(data.vertices[cell.vertices[1]],data.vertices[cell.vertices[0]]),sub(data.vertices[cell.vertices[2]],data.vertices[cell.vertices[0]])));
  return cell.vertices.map((vertex,i)=>{let n=sharedVertexNormal(data,vertex)||fallback[i]||reference;if(dot(n,reference)<0)n=mul(n,-1);return n;});
}
function edgeRibbonNormal(points,n0,n1,t){
  if(dot(n0,n1)<0)n1=mul(n1,-1);
  let n=norm(lerp(n0,n1,t)),tangent=cubicDerivative(points,t);tangent=norm(tangent);
  if(len(tangent)>EPS)n=norm(sub(n,mul(tangent,dot(n,tangent))));
  return len(n)>EPS?n:norm(cross(tangent,[Math.abs(tangent[0])<.8?1:0,Math.abs(tangent[0])<.8?0:1,0]));
}

// A quartic triangular patch has enough interior freedom to honor the three
// cubic cage boundaries and their shared tangent ribbons.  The boundary curves
// are degree-elevated exactly; only the three interior controls are solved.
export function createTriangularSplinePatch(data,cell){
  if(!cell||cell.edges?.length!==3)return null;
  const ep=cell.edges.map(edge=>orientedEdgePoints(data,edge)),boundary=ep.map(elevateCubicToQuartic),corners=cell.vertices.map(id=>data.vertices[id]),controls=new Map(),put=(i,j,k,p)=>controls.set(`${i},${j},${k}`,p.slice());
  const boundaryKeys=[[[4,0,0],[3,1,0],[2,2,0],[1,3,0],[0,4,0]],[[0,4,0],[0,3,1],[0,2,2],[0,1,3],[0,0,4]],[[0,0,4],[1,0,3],[2,0,2],[3,0,1],[4,0,0]]];
  for(let side=0;side<3;side++)for(let i=0;i<5;i++)put(...boundaryKeys[side][i],boundary[side][i]);
  const baselineControls=[
    mul(add(add(mul(corners[0],2),corners[1]),corners[2]),.25),
    mul(add(add(corners[0],mul(corners[1],2)),corners[2]),.25),
    mul(add(add(corners[0],corners[1]),mul(corners[2],2)),.25)
  ],baseline=baselineControls.flat(),rows=[],values=[],normals=cellCornerNormals(data,cell,ep),edgeVars=[[0,1],[1,2],[2,0]],edgeKnown=[[boundary[2][3],boundary[1][1]],[boundary[0][3],boundary[2][1]],[boundary[1][3],boundary[0][1]]];
  for(let side=0;side<3;side++)for(const t of [.125,.25,.375,.5,.625,.75,.875]){
    const b=[0,1,2,3].map(i=>bernstein3(i,t)),normal=edgeRibbonNormal(ep[side],normals[side],normals[(side+1)%3],t),fixed=add(mul(edgeKnown[side][0],b[0]),mul(edgeKnown[side][1],b[3])),target=curvePoint(boundary[side],t,4),row=Array(9).fill(0);
    for(let q=0;q<3;q++){row[edgeVars[side][0]*3+q]=b[1]*normal[q];row[edgeVars[side][1]*3+q]=b[2]*normal[q];}
    rows.push(row);values.push(dot(sub(target,fixed),normal));
  }
  const solved=leastSquares(rows,values,baseline),interior=[solved.slice(0,3),solved.slice(3,6),solved.slice(6,9)];
  put(2,1,1,interior[0]);put(1,2,1,interior[1]);put(1,1,2,interior[2]);
  return {degree:4,controls,cornerNormals:normals};
}

const factorial=[1,1,2,6,24];
export function evaluateTriangularSplinePatch(patch,u,v,w=1-u-v){
  if(!patch)return null;const sum=u+v+w||1;u/=sum;v/=sum;w/=sum;let p=[0,0,0];
  for(const [key,c] of patch.controls){const [i,j,k]=key.split(',').map(Number),coefficient=factorial[4]/(factorial[i]*factorial[j]*factorial[k])*u**i*v**j*w**k;p=add(p,mul(c,coefficient));}
  return p;
}

function cubicSplitAt(points,t){
  const a=lerp(points[0],points[1],t),b=lerp(points[1],points[2],t),c=lerp(points[2],points[3],t),d=lerp(a,b,t),e=lerp(b,c,t),m=lerp(d,e,t);
  return [[points[0],a,d,m],[m,e,c,points[3]]];
}
export function cubicSubsegment(points,t0=0,t1=1){
  t0=Math.max(0,Math.min(1,t0));t1=Math.max(t0,Math.min(1,t1));
  if(t0<=EPS&&t1>=1-EPS)return points.map(p=>p.slice());
  const left=cubicSplitAt(points,t1)[0];
  return t0<=EPS?left:cubicSplitAt(left,t0/Math.max(t1,EPS))[1];
}
function cubicLengthTable(points,steps=96){const samples=[{t:0,s:0,p:points[0]}];let total=0,previous=points[0];for(let i=1;i<=steps;i++){const t=i/steps,p=cubicPoint(points,t);total+=dist(previous,p);samples.push({t,s:total,p});previous=p;}return {samples,total};}
function cubicParameterAtDistance(table,distance){
  const target=Math.max(0,Math.min(table.total,distance));let lo=0,hi=table.samples.length-1;
  while(lo+1<hi){const mid=(lo+hi)>>1;if(table.samples[mid].s<target)lo=mid;else hi=mid;}
  const a=table.samples[lo],b=table.samples[hi],span=b.s-a.s,t=span>EPS?(target-a.s)/span:0;
  return a.t+(b.t-a.t)*t;
}
function addIndependentSegment(data,a,b,ha=[0,0,0],hb=[0,0,0],soft=false){
  if(a===b||!data.vertices[a]||!data.vertices[b])return null;
  const q=addSplineSequence(data,false),sid=addSplineSegment(data,q,a,b,ha,hb);if(soft)data.segments[sid].soft=true;return sid;
}
function copyVertexIfNeeded(out,data,vid){if(!out.vertices[vid]&&data.vertices[vid])out.vertices[vid]=data.vertices[vid].slice();return vid;}
function bevelArmRay(data,arm){const points=segmentPoints(data,arm.s),tangent=robustCubicTangent(points,arm.side==='a'?0:1);return arm.side==='a'?tangent:mul(tangent,-1);}
function coalesceNonbranchedSplineComponents(data){const adjacency=new Map(),add=(v,sid)=>{let list=adjacency.get(v);if(!list)adjacency.set(v,list=[]);list.push(sid);};for(const s of Object.values(data.segments)){add(s.a,s.id);add(s.b,s.id);}const visited=new Set();for(const start of Object.keys(data.segments).sort()){if(visited.has(start))continue;const component=[],queue=[start];visited.add(start);while(queue.length){const sid=queue.shift(),s=data.segments[sid];if(!s)continue;component.push(sid);for(const vertex of [s.a,s.b])for(const next of adjacency.get(vertex)||[])if(!visited.has(next)){visited.add(next);queue.push(next);}}const vertices=new Set(component.flatMap(sid=>{const s=data.segments[sid];return [s.a,s.b];}));if(component.length>1&&[...vertices].every(v=>(adjacency.get(v)||[]).filter(sid=>component.includes(sid)).length<=2))setSegmentsAsSequence(data,component);}return data;}

export function applySplineVertexBevel(data,vertexIds,{profile='round',radius=0}={}){
  radius=Math.max(0,+radius||0);if(radius<EPS)return cloneSplineData(data);
  const candidates=[...new Set(vertexIds||[])].filter(vid=>data.vertices[vid]&&incident(data,vid).length===2).sort(),tables=new Map(),lengthOf=sid=>{let q=tables.get(sid);if(!q){q=cubicLengthTable(segmentPoints(data,sid));tables.set(sid,q);}return q.total;},trim=new Map(),angles=new Map(),selected=[];
  for(const vid of candidates){const arms=incident(data,vid).sort((a,b)=>a.s.id.localeCompare(b.s.id)),rays=arms.map(q=>bevelArmRay(data,q)),theta=Math.acos(Math.max(-1,Math.min(1,dot(rays[0],rays[1])))),distance=profile==='round'?radius/Math.max(Math.tan(theta*.5),1e-6):radius,limit=Math.min(...arms.map(q=>lengthOf(q.s.id)*.5)),effective=Math.min(Math.max(0,distance),Math.max(0,limit));if(effective<=EPS)continue;trim.set(vid,effective);angles.set(vid,theta);selected.push(vid);}
  if(!selected.length)return cloneSplineData(data);const chosen=new Set(selected);
  const out=createSplineData(data.approximation);out.next=Math.max(1,data.next||1);out.freeHandles={};const half=new Map(),ensureOld=vid=>copyVertexIfNeeded(out,data,vid);
  for(const s of Object.values(data.segments).sort((a,b)=>a.id.localeCompare(b.id))){
    const table=tables.get(s.id)||cubicLengthTable(segmentPoints(data,s.id)),ta=chosen.has(s.a)?cubicParameterAtDistance(table,trim.get(s.a)):0,tb=chosen.has(s.b)?cubicParameterAtDistance(table,table.total-trim.get(s.b)):1,p=segmentPoints(data,s);
    if(chosen.has(s.a)&&chosen.has(s.b)&&tb-ta<=1e-7){const t=Math.max(0,Math.min(1,(ta+tb)*.5)),v=addSplineVertex(out,cubicPoint(p,t));half.set(s.id+':a',{vertex:v,t});half.set(s.id+':b',{vertex:v,t});continue;}
    const av=chosen.has(s.a)?addSplineVertex(out,cubicPoint(p,ta)):ensureOld(s.a),bv=chosen.has(s.b)?addSplineVertex(out,cubicPoint(p,tb)):ensureOld(s.b);half.set(s.id+':a',{vertex:av,t:ta});half.set(s.id+':b',{vertex:bv,t:tb});
    if(av!==bv&&tb-ta>1e-8){const subcurve=cubicSubsegment(p,ta,tb);addIndependentSegment(out,av,bv,sub(subcurve[1],subcurve[0]),sub(subcurve[2],subcurve[3]),!!s.soft);}
  }
  for(const vid of selected){const arms=incident(data,vid).sort((a,b)=>a.s.id.localeCompare(b.s.id)),refs=arms.map(q=>half.get(q.s.id+':'+q.side));if(refs.some(x=>!x)||refs[0].vertex===refs[1].vertex)continue;const a=refs[0].vertex,b=refs[1].vertex,v=data.vertices[vid],ra=norm(sub(out.vertices[a],v)),rb=norm(sub(out.vertices[b],v));let ha=[0,0,0],hb=[0,0,0];
    if(profile==='round'){const theta=angles.get(vid),effective=trim.get(vid),circleRadius=effective*Math.tan(theta*.5),turn=Math.max(0,Math.PI-theta),handle=4/3*circleRadius*Math.tan(turn*.25);if(Number.isFinite(handle)){ha=mul(ra,-handle);hb=mul(rb,-handle);}}
    addIndependentSegment(out,a,b,ha,hb,profile==='round');
  }
  for(const [vid,h] of Object.entries(data.freeHandles||{}))if(out.vertices[vid])out.freeHandles[vid]=JSON.parse(JSON.stringify(h));
  cleanupSpline(out);coalesceNonbranchedSplineComponents(out);cleanupSpline(out);return out;
}

export function applySplineBevelTag(data,tag){
  if(!tag||tag.type!==2)return cloneSplineData(data);
  if(tag.domain==='vertex')return applySplineVertexBevel(data,tag.targets,{profile:tag.profile,radius:tag.radius});
  return cloneSplineData(data);
}

export function weldCoincidentSplineVertices(data,vertexIds,tolerance=1e-6){
  const ids=[...new Set(vertexIds||[])].filter(id=>data.vertices[id]).sort(),groups=[];
  for(const vid of ids){const p=data.vertices[vid],group=groups.find(g=>dist(data.vertices[g[0]],p)<=tolerance);if(group)group.push(vid);else groups.push([vid]);}
  const remap={};for(const group of groups)if(group.length>1){const keep=group[0];for(let i=1;i<group.length;i++){remap[group[i]]=keep;weldSplineVertices(data,keep,group[i]);}}
  cleanupSpline(data);return remap;
}
export function validateSpline(data){const errors=[],warnings=[],vertexIds=new Set(Object.keys(data.vertices)),segmentIds=new Set(Object.keys(data.segments)),used=new Set();for(const [vid,p] of Object.entries(data.vertices))if(!finite(p))errors.push(`vertex ${vid} is not finite`);for(const [vid,h] of Object.entries(data.freeHandles||{})){if(!vertexIds.has(vid))errors.push(`free handles reference missing vertex ${vid}`);if(!h||!finite(h.in)||!finite(h.out))errors.push(`vertex ${vid} has invalid free handles`);}for(const [sid,s] of Object.entries(data.segments)){if(!vertexIds.has(s.a)||!vertexIds.has(s.b))errors.push(`segment ${sid} has missing endpoint`);if(s.a===s.b)errors.push(`segment ${sid} is a self loop`);if(!finite(s.ha)||!finite(s.hb))errors.push(`segment ${sid} has invalid handles`);used.add(s.a);used.add(s.b);}for(const vid of vertexIds)if(!used.has(vid))errors.push(`vertex ${vid} is orphaned`);for(const q of data.sequences){if(!q.segments.length){warnings.push(`sequence ${q.id} is empty`);continue;}for(const sid of q.segments)if(!segmentIds.has(sid))errors.push(`sequence ${q.id} references ${sid}`);for(let i=1;i<q.segments.length;i++){const a=data.segments[q.segments[i-1]],b=data.segments[q.segments[i]];if(a&&b&&a.b!==b.a)errors.push(`sequence ${q.id} is discontinuous at ${i}`);}const first=data.segments[q.segments[0]],last=data.segments[q.segments[q.segments.length-1]];if(first&&q.first!==first.a)errors.push(`sequence ${q.id} has invalid first point`);if(q.closed&&first&&last&&last.b!==first.a)errors.push(`sequence ${q.id} is not geometrically closed`);}const approx=approximateSpline(data);for(const q of approx){for(let i=1;i<q.points.length;i++)if(close(q.points[i-1].position,q.points[i].position,1e-10))warnings.push(`sequence ${q.id} has duplicate approximation points`);if(q.closed&&q.points.length>1&&close(q.points[0].position,q.points[q.points.length-1].position,1e-10))errors.push(`sequence ${q.id} duplicates its first approximation point`);}return {ok:errors.length===0,errors,warnings,vertices:vertexIds.size,segments:segmentIds.size,sequences:data.sequences.length,approximationPoints:approx.reduce((n,q)=>n+q.points.length,0)};}
export function createSplineStressData(){const d=createSplineData({angle:4});
  const seq=(pts,handles=[],closed=false)=>{const q=addSplineSequence(d,closed),vs=pts.map(p=>addSplineVertex(d,p));if(closed)vs.push(vs[0]);for(let i=1;i<vs.length;i++)addSplineSegment(d,q,vs[i-1],vs[i],handles[i-1]?.[0]||[0,0,0],handles[i-1]?.[1]||[0,0,0]);return {q,vs};};
  const main=seq([[-900,0,-300],[-450,180,50],[0,0,-120],[450,260,100],[900,80,-250]],[[[180,0,0],[-140,-90,0]],[[160,110,40],[-170,40,-60]],[[170,-40,80],[-130,-160,0]],[[0,0,0],[0,0,0]]]);
  const loop=seq([[-350,420,500],[250,520,520],[500,260,520],[100,80,500]],[[[160,100,0],[-180,0,0]],[[180,0,0],[0,140,0]],[[0,-140,0],[150,-80,0]],[[-150,80,0],[0,0,0]]],true);
  const branch=seq([[0,0,-120],[0,480,-500],[420,720,-200]],[[[0,180,-120],[0,-120,80]],[[180,80,80],[-120,-50,-50]]]);
  weldSplineVertices(d,branch.vs[0],main.vs[2]);setSplineSoft(d,[main.vs[1],main.vs[2],loop.vs[1]],true);return d;}

export function createSplineCageStressData(){
  const d=createSplineData({angle:5});
  const grid=[
    [[-900,-80,-700],[-150,170,-760],[650,-40,-690]],
    [[-980,120,0],[-110,430,40],[760,90,20]],
    [[-880,-30,720],[-80,210,810],[700,-110,690]]
  ].map(row=>row.map(p=>addSplineVertex(d,p)));
  const smoothSegment=(q,a,b,bend=0)=>{
    const chord=sub(d.vertices[b],d.vertices[a]),ha=mul(chord,1/3),hb=mul(chord,-1/3);
    ha[1]+=bend;hb[1]-=bend;
    return addSplineSegment(d,q,a,b,ha,hb);
  };
  for(let row=0;row<3;row++){
    const q=addSplineSequence(d,false);
    smoothSegment(q,grid[row][0],grid[row][1],row===1?55:-25);
    smoothSegment(q,grid[row][1],grid[row][2],row===1?-45:20);
  }
  for(let col=0;col<3;col++){
    const q=addSplineSequence(d,false);
    smoothSegment(q,grid[0][col],grid[1][col],col===1?35:-20);
    smoothSegment(q,grid[1][col],grid[2][col],col===1?-30:18);
  }
  const center=[1450,150,0],tiltedCircle=radius=>{const cq=addSplineSequence(d,true),k=radius*.5522847498307936,cv=[
    addSplineVertex(d,[center[0]+radius,center[1],center[2]]),
    addSplineVertex(d,[center[0],center[1]+radius*.55,center[2]+radius*.835]),
    addSplineVertex(d,[center[0]-radius,center[1],center[2]]),
    addSplineVertex(d,[center[0],center[1]-radius*.55,center[2]-radius*.835])
  ],tangent=[[0,k*.55,k*.835],[-k,0,0],[0,-k*.55,-k*.835],[k,0,0]];for(let i=0;i<4;i++)addSplineSegment(d,cq,cv[i],cv[(i+1)%4],tangent[i],mul(tangent[(i+1)%4],-1));};
  tiltedCircle(330);tiltedCircle(145);
  return d;
}

export function createSplineThreeCircleConflictData(){
  const d=createSplineData({angle:5}),r=500,k=r*.5522847498307936;
  const circle=(u,v)=>{
    const q=addSplineSequence(d,true),point=(a,b)=>[u[0]*a+v[0]*b,u[1]*a+v[1]*b,u[2]*a+v[2]*b],vertices=[[r,0],[0,r],[-r,0],[0,-r]].map(([a,b])=>addSplineVertex(d,point(a,b))),tangents=[[0,k],[-k,0],[0,-k],[k,0]].map(([a,b])=>point(a,b));
    for(let i=0;i<4;i++)addSplineSegment(d,q,vertices[i],vertices[(i+1)%4],tangents[i],mul(tangents[(i+1)%4],-1));
  };
  circle([1,0,0],[0,1,0]);circle([0,1,0],[0,0,1]);circle([0,0,1],[1,0,0]);
  return d;
}

export function createSplineQuadClosedData(){
  const d=createSplineData({angle:5}),r=500,vertices={};
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])vertices[`${x},${y},${z}`]=addSplineVertex(d,[x*r,y*r,z*r]);
  const edgeMap=new Map(),edge=(a,b)=>{const key=[a,b].sort().join('|');if(edgeMap.has(key))return edgeMap.get(key);const q=addSplineSequence(d,false),sid=addSplineSegment(d,q,vertices[a],vertices[b]);edgeMap.set(key,sid);return sid;};
  const faces=[
    ['-1,-1,-1','1,-1,-1','1,1,-1','-1,1,-1'],['-1,-1,1','-1,1,1','1,1,1','1,-1,1'],
    ['-1,-1,-1','-1,-1,1','1,-1,1','1,-1,-1'],['-1,1,-1','1,1,-1','1,1,1','-1,1,1'],
    ['-1,-1,-1','-1,1,-1','-1,1,1','-1,-1,1'],['1,-1,-1','1,-1,1','1,1,1','1,1,-1']
  ];
  for(const face of faces)for(let i=0;i<4;i++)edge(face[i],face[(i+1)%4]);
  d.patchCells=faces.map(names=>({vertices:names.map(x=>vertices[x]),edges:names.map((x,i)=>edgeMap.get([x,names[(i+1)%4]].sort().join('|')))}));
  return d;
}

export function createSplineNgonClosedData(sideCount=5,{irregular=false,warped=false}={}){
  const d=createSplineData({angle:8}),n=Math.max(5,Math.round(+sideCount||5)),base=[];
  for(let i=0;i<n;i++){const a=Math.PI*2*i/n,r=420*(irregular?(1+.16*Math.sin(i*2.173)+.07*Math.cos(i*1.319)):1),z=warped?45*Math.sin(a*2)+18*Math.cos(a*3):0;base.push(addSplineVertex(d,[r*Math.cos(a),r*Math.sin(a),z]));}
  const apex=addSplineVertex(d,[0,0,620]),edgeMap=new Map(),key=(a,b)=>a<b?`${a}|${b}`:`${b}|${a}`,edge=(a,b)=>{const k=key(a,b);if(edgeMap.has(k))return edgeMap.get(k);const q=addSplineSequence(d,false),sid=addSplineSegment(d,q,a,b);edgeMap.set(k,sid);return sid;};
  for(let i=0;i<n;i++)edge(base[i],base[(i+1)%n]);for(const v of base)edge(v,apex);const cell=vertices=>({vertices:vertices.slice(),edges:vertices.map((v,i)=>edge(v,vertices[(i+1)%vertices.length]))});d.patchCells=[cell(base),...base.map((v,i)=>cell([v,apex,base[(i+1)%n]]))];return d;
}

export function createSplineSphereCageData(){
  const d=createSplineData({angle:5}),r=520,k=r*.5522847498307936,axis={
    xp:addSplineVertex(d,[r,0,0]),xn:addSplineVertex(d,[-r,0,0]),yp:addSplineVertex(d,[0,r,0]),yn:addSplineVertex(d,[0,-r,0]),zp:addSplineVertex(d,[0,0,r]),zn:addSplineVertex(d,[0,0,-r])
  };
  const circles=[
    [['xp','yp','xn','yn'],[[0,k,0],[-k,0,0],[0,-k,0],[k,0,0]]],
    [['yp','zp','yn','zn'],[[0,0,k],[0,-k,0],[0,0,-k],[0,k,0]]],
    [['zp','xp','zn','xn'],[[k,0,0],[0,0,-k],[-k,0,0],[0,0,k]]]
  ];
  const edgeMap=new Map(),edgeKey=(a,b)=>[a,b].sort().join('|');for(const [names,tangents] of circles){const q=addSplineSequence(d,true);for(let i=0;i<4;i++){const a=names[i],b=names[(i+1)%4],sid=addSplineSegment(d,q,axis[a],axis[b],tangents[i],mul(tangents[(i+1)%4],-1));edgeMap.set(edgeKey(a,b),sid);}}
  const faces=[['xp','yp','zp'],['yp','xn','zp'],['xn','yn','zp'],['yn','xp','zp'],['xp','zn','yp'],['yp','zn','xn'],['xn','zn','yn'],['yn','zn','xp']];d.patchCells=faces.map(names=>({vertices:names.map(x=>axis[x]),edges:names.map((x,i)=>edgeMap.get(edgeKey(x,names[(i+1)%3])))}));
  return d;
}

export function createSplineMixedClosedData(){
  const d=createSplineData({angle:5}),r=520,z=430,vertices={};
  for(const side of [-1,1])for(let i=0;i<3;i++){const a=Math.PI/2+i*Math.PI*2/3;vertices[`${side}:${i}`]=addSplineVertex(d,[Math.cos(a)*r,Math.sin(a)*r,side*z]);}
  const edgeMap=new Map(),edge=(a,b)=>{const key=[a,b].sort().join('|');if(edgeMap.has(key))return edgeMap.get(key);const q=addSplineSequence(d,false),sid=addSplineSegment(d,q,vertices[a],vertices[b]);edgeMap.set(key,sid);return sid;},faces=[
    ['-1:0','-1:2','-1:1'],['1:0','1:1','1:2'],
    ['-1:0','-1:1','1:1','1:0'],['-1:1','-1:2','1:2','1:1'],['-1:2','-1:0','1:0','1:2']
  ];
  for(const face of faces)for(let i=0;i<face.length;i++)edge(face[i],face[(i+1)%face.length]);
  return d;
}

export function createExtrudeProfileTestData(){const d=createSplineData({angle:5}),q=addSplineSequence(d,true),v=[[-120,-80,0],[120,-80,0],[120,80,0],[-120,80,0]].map(p=>addSplineVertex(d,p));for(let i=0;i<v.length;i++)addSplineSegment(d,q,v[i],v[(i+1)%v.length]);return d;}
export function createClosedTwoVertexTestData(){const d=createSplineData({angle:3}),q=addSplineSequence(d,true),a=addSplineVertex(d,[-100,0,0]),b=addSplineVertex(d,[100,0,0]);addSplineSegment(d,q,a,b,[80,100,0],[-80,100,0]);addSplineSegment(d,q,b,a,[80,-100,0],[-80,-100,0]);return d;}
export function createLatheProfileTestData(){const d=createSplineData({angle:5}),q=addSplineSequence(d,false),v=[[0,-140,0],[75,-105,0],[105,0,0],[65,95,0],[0,145,0]].map(p=>addSplineVertex(d,p));for(let i=0;i<v.length-1;i++){const sid=addSplineSegment(d,q,v[i],v[i+1]);if(i===1||i===2){d.segments[sid].soft=true;setSplineSoft(d,[v[i],v[i+1]],true);}}return d;}
export function createSweepProfileTestData(){const d=createSplineData({angle:5}),q=addSplineSequence(d,true),r=45,k=r*.5522847498307936,v=[[r,0,0],[0,r,0],[-r,0,0],[0,-r,0]].map(p=>addSplineVertex(d,p)),handles=[[[0,k,0],[k,0,0]],[[-k,0,0],[0,k,0]],[[0,-k,0],[-k,0,0]],[[k,0,0],[0,-k,0]]];for(let i=0;i<4;i++){const sid=addSplineSegment(d,q,v[i],v[(i+1)%4],handles[i][0],handles[i][1]);d.segments[sid].soft=true;}return d;}
export function createSweepPathTestData(){const d=createSplineData({angle:5}),q=addSplineSequence(d,false),v=[[0,0,0],[0,110,100],[120,210,180],[30,330,300]].map(p=>addSplineVertex(d,p));for(let i=0;i<v.length-1;i++){const chord=mul(sub(d.vertices[v[i+1]],d.vertices[v[i]]),1/3),sid=addSplineSegment(d,q,v[i],v[i+1],chord,mul(chord,-1));d.segments[sid].soft=true;}return d;}
export function createCompoundProfileTestData(){const d=createSplineData({angle:5}),circle=(r,reverse=false)=>{const q=addSplineSequence(d,true),k=r*.5522847498307936,raw=[[r,0,0],[0,r,0],[-r,0,0],[0,-r,0]],v=(reverse?raw.slice().reverse():raw).map(p=>addSplineVertex(d,p));for(let i=0;i<4;i++){const a=d.vertices[v[i]],b=d.vertices[v[(i+1)%4]],ta=norm([-a[1],a[0],0]),tb=norm([-b[1],b[0],0]),sign=reverse?-1:1,sid=addSplineSegment(d,q,v[i],v[(i+1)%4],mul(ta,k*sign),mul(tb,-k*sign));d.segments[sid].soft=true;}};circle(90);circle(38,true);return d;}
export function createNestedProfileTestData(){const d=createSplineData({angle:5}),origin=[35,-20,15],u=norm([1,.2,.35]),normal=norm([-.25,.9,.3]),v=norm([normal[1]*u[2]-normal[2]*u[1],normal[2]*u[0]-normal[0]*u[2],normal[0]*u[1]-normal[1]*u[0]]),point=(x,y)=>add(origin,add(mul(u,x),mul(v,y))),circle=(r,reverse=false)=>{const q=addSplineSequence(d,true),k=r*.5522847498307936,raw=[[r,0],[0,r],[-r,0],[0,-r]],items=reverse?raw.slice().reverse():raw,vertices=items.map(([x,y])=>addSplineVertex(d,point(x,y)));for(let i=0;i<4;i++){const [x0,y0]=items[i],[x1,y1]=items[(i+1)%4],sign=reverse?-1:1,ta=add(mul(u,-y0/r),mul(v,x0/r)),tb=add(mul(u,-y1/r),mul(v,x1/r)),sid=addSplineSegment(d,q,vertices[i],vertices[(i+1)%4],mul(ta,k*sign),mul(tb,-k*sign));d.segments[sid].soft=true;}};circle(130);circle(72,true);circle(28);return d;}
export function createClosedSweepPathTestData(){const d=createSplineData({angle:5}),q=addSplineSequence(d,true),r=240,k=r*.5522847498307936,v=[[r,0,0],[0,0,r],[-r,0,0],[0,0,-r]].map(p=>addSplineVertex(d,p)),handles=[[[0,0,k],[k,0,0]],[[-k,0,0],[0,0,k]],[[0,0,-k],[-k,0,0]],[[k,0,0],[0,0,-k]]];for(let i=0;i<4;i++){const sid=addSplineSegment(d,q,v[i],v[(i+1)%4],handles[i][0],handles[i][1]);d.segments[sid].soft=true;}return d;}

export const splineMath={add,sub,mul,dot,cross,len,norm,dist,lerp};
