/** Spline cage -> face loops. No dependencies, ES2020. See the supplied handoff for guarantees. */
const add=(a,b)=>a.map((v,i)=>v+b[i]), sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,s)=>a.map(v=>v*s), dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(...a), unit=a=>mul(a,1/len(a));
const reverse=loop=>loop.slice().reverse().map(h=>h^1);
const key=loops=>loops.flat().map(h=>h>>1).sort((a,b)=>a-b).join(',');
function inside(p,poly){let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
 const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
const area=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-a[1]*b[0];},0)/2;
function normalize(input,o){
 const ids=new Map();const nodes=input.nodes.map((n,i)=>{if(ids.has(n.id))throw Error('Duplicate node id');ids.set(n.id,i);if(!Array.isArray(n.p)||n.p.length!==3||!n.p.every(Number.isFinite))throw Error('Invalid position');return n.p.slice();});
 if(!nodes.length)throw Error('Empty cage');
 const scale=Math.max(...[0,1,2].map(k=>Math.max(...nodes.map(p=>p[k]))-Math.min(...nodes.map(p=>p[k]))))||1;
 const eps=o.tolerance*scale, edgeIds=new Set();
 const edges=input.edges.map((e,i)=>{if(edgeIds.has(e.id))throw Error('Duplicate edge id');edgeIds.add(e.id);const a=ids.get(e.a),b=ids.get(e.b);
 if(a===undefined||b===undefined||a===b)throw Error('Unknown endpoint or self-loop');
 const chord=sub(nodes[b],nodes[a]);if(len(chord)<eps)throw Error('Coincident endpoints');
 const ta=e.ta??chord,tb=e.tb??chord;
 if(![ta,tb].every(t=>Array.isArray(t)&&t.length===3&&t.every(Number.isFinite)))throw Error('Invalid derivative');
 return {id:e.id,a,b,boundary:!!e.boundary,cp:[nodes[a],add(nodes[a],mul(ta,1/3)),sub(nodes[b],mul(tb,1/3)),nodes[b]]};});
 const adj=nodes.map(()=>[]),from=h=>h&1?edges[h>>1].b:edges[h>>1].a,to=h=>from(h^1);
 edges.forEach((e,i)=>{adj[e.a].push(i*2);adj[e.b].push(i*2+1);});
 function samples(h){const cp=edges[h>>1].cp,out=[];for(let j=0;j<=o.curveSamples;j++){const t=j/o.curveSamples,s=1-t;out.push([0,1,2].map(k=>s*s*s*cp[0][k]+3*s*s*t*cp[1][k]+3*s*t*t*cp[2][k]+t*t*t*cp[3][k]));}return h&1?out.reverse():out;}
 function plane(points){const p=points[0];let a=null,n=null;for(const q of points){const v=sub(q,p);if(len(v)>eps){a=v;break;}}if(!a)return null;
 for(const q of points){const v=cross(a,sub(q,p));if(len(v)>eps*len(a)){n=unit(v);break;}}if(!n)return null;
 if(points.some(q=>Math.abs(dot(n,sub(q,p)))>eps))return null;
 const k=n.findIndex(v=>Math.abs(v)>1e-10);if(n[k]<0)n=mul(n,-1);
 const u=unit(Math.abs(n[0])<.8?cross(n,[1,0,0]):cross(n,[0,1,0])),v=cross(n,u);
 return {n,d:dot(n,p),project:q=>[dot(sub(q,p),u),dot(sub(q,p),v)]};}
 return {nodes,edges,adj,from,to,samples,plane,eps,scale};
}
function planarCandidates(g,addFace,diag){
 const {edges,adj,plane,eps,from,to,samples}=g,planes=[];
 for(const hs of adj)for(let i=0;i<hs.length;i++)for(let j=i+1;j<hs.length;j++){
 const p=plane([...edges[hs[i]>>1].cp,...edges[hs[j]>>1].cp]);
 if(p&&!planes.some(q=>len(sub(p.n,q.n))<1e-8&&Math.abs(p.d-q.d)<eps))planes.push(p);}
 for(const p of planes){
 const eligible=edges.map(e=>e.cp.every(q=>Math.abs(dot(p.n,q)-p.d)<=eps));
 const pa=adj.map(hs=>hs.filter(h=>eligible[h>>1]).sort((a,b)=>{
 const direction=h=>{const ss=samples(h),s=p.project(ss[0]);let d=[0,0];for(let i=1;i<ss.length;i++){const q=p.project(ss[i]);d=[q[0]-s[0],q[1]-s[1]];if(Math.hypot(...d)>eps)break;}return Math.atan2(d[1],d[0]);};return direction(a)-direction(b)||a-b;}));
 const components=new Int32Array(adj.length).fill(-1);let nc=0;
 for(let v=0;v<pa.length;v++)if(pa[v].length&&components[v]<0){const stack=[v];components[v]=nc;while(stack.length)for(const h of pa[stack.pop()])if(components[to(h)]<0){components[to(h)]=nc;stack.push(to(h));}nc++;}
 const seen=new Set(),loops=[];
 for(let h=0;h<edges.length*2;h++)if(eligible[h>>1]&&!seen.has(h)){
 const loop=[];let cur=h;
 while(!seen.has(cur)){seen.add(cur);loop.push(cur);const hs=pa[to(cur)],at=hs.indexOf(cur^1);cur=hs[(at+hs.length-1)%hs.length];}
 if(cur!==h||loop.length<2||new Set(loop.map(x=>x>>1)).size!==loop.length)continue;
 const poly=loop.flatMap(x=>samples(x).slice(0,-1).map(p.project)),a=area(poly);
 if(a>eps*eps)loops.push({loop,poly,area:a,component:components[from(h)],parent:-1});
 }
 for(let i=0;i<loops.length;i++){let best=Infinity;for(let j=0;j<loops.length;j++)if(i!==j&&loops[i].component!==loops[j].component&&loops[j].area>loops[i].area&&loops[j].area<best&&inside(loops[i].poly[0],loops[j].poly)){loops[i].parent=j;best=loops[j].area;}}
 for(let i=0;i<loops.length;i++){let depth=0,j=loops[i].parent;while(j>=0){depth++;j=loops[j].parent;}if(depth%2)continue;
 const holes=loops.filter(x=>x.parent===i);addFace([loops[i].loop,...holes.map(x=>reverse(x.loop))],true,loops[i].area-holes.reduce((s,x)=>s+x.area,0));}
 }
 diag.planes=planes.length;
}
function spatialCandidates(g,o,addFace,diag){
 const {adj,to,edges,plane}=g;let visits=0,stop=false;
 for(let start=0;start<adj.length&&!stop;start++){
 const used=new Set([start]),path=[],usedEdges=new Set();
 function visit(v){if(++visits>o.maxCycleVisits){stop=true;return;}
 for(const h of adj[v]){if(stop)return;const w=to(h),e=h>>1;if(usedEdges.has(e)||w<start)continue;
 if(w===start){if(path.length>=1&&path.length+1<=o.maxCandidateSides){const loop=[...path,h];if(loop[0]<(h^1)&&!plane(loop.flatMap(x=>edges[x>>1].cp)))addFace([loop],false,null);}continue;}
 if(used.has(w)||path.length+1>=o.maxCandidateSides)continue;
 used.add(w);usedEdges.add(e);path.push(h);visit(w);path.pop();usedEdges.delete(e);used.delete(w);
 }}visit(start);
 }
 diag.cycleVisits=visits;diag.cycleSearchComplete=!stop;
}
/** Validate a CLOSED combinatorial surface: edge degree, vertex links, orientability, connectedness. */
function validate(g,faces,selected){
 const incidence=g.edges.map(()=>[]),links=g.nodes.map(()=>new Map());
 selected.forEach((fi,si)=>{for(const loop of faces[fi].loops)for(let j=0;j<loop.length;j++){
 const h=loop[j],prev=loop[(j+loop.length-1)%loop.length],v=g.from(h),a=prev>>1,b=h>>1;
 incidence[b].push({si,sign:h&1});const m=links[v];if(!m.has(a))m.set(a,[]);if(!m.has(b))m.set(b,[]);m.get(a).push(b);m.get(b).push(a);
 }});
 if(incidence.some(xs=>xs.length!==2))return null;
 for(let v=0;v<links.length;v++){const m=links[v];if(!m.size||[...m.values()].some(xs=>xs.length!==2))return null;const seen=new Set(),stack=[m.keys().next().value];while(stack.length){const x=stack.pop();if(seen.has(x))continue;seen.add(x);stack.push(...m.get(x));}if(seen.size!==m.size)return null;}
 const graph=selected.map(()=>[]);for(const [a,b] of incidence){graph[a.si].push([b.si,a.sign===b.sign?1:0]);graph[b.si].push([a.si,a.sign===b.sign?1:0]);}
 const flip=new Int8Array(selected.length).fill(-1);flip[0]=0;const stack=[0];while(stack.length){const a=stack.pop();for(const [b,d] of graph[a]){const need=flip[a]^d;if(flip[b]<0){flip[b]=need;stack.push(b);}else if(flip[b]!==need)return null;}}
 if(flip.some(x=>x<0))return null;return {flip,incidence};
}
function solve(g,faces,o,diag){
 const byEdge=g.edges.map(()=>[]);faces.forEach((f,i)=>f.edgeIds.forEach(e=>byEdge[e].push(i)));
 const count=new Uint8Array(g.edges.length),chosen=new Uint8Array(faces.length),selected=[];
 let best=null,bestCost=Infinity,steps=0,limit=false,valid=0;
 const feasible=i=>!chosen[i]&&faces[i].edgeIds.every(e=>count[e]<2);
 const banned=new Uint8Array(faces.length);
 function dfs(cost){if(++steps>o.maxSearchNodes){limit=true;return;}if(cost>=bestCost)return;
 let options=null,need=0;
 for(let e=0;e<count.length;e++)if(count[e]<2){const xs=byEdge[e].filter(i=>!banned[i]&&feasible(i)),n=2-count[e];if(xs.length<n)return;if(!options||xs.length<options.length){options=xs;need=n;}}
 if(!options){const check=validate(g,faces,selected);if(check&&(!o.acceptShell||o.acceptShell(selected.map((fi,si)=>({planar:faces[fi].planar,loops:faces[fi].loops.map(l=>(check.flip[si]?reverse(l):l).map(h=>({edge:g.edges[h>>1].id,reversed:!!(h&1)})))}))))){valid++;best=selected.slice();bestCost=cost;}return;}
 options.sort((a,b)=>faces[a].cost-faces[b].cost||a-b);
 const excluded=[];
 for(let k=0;k<=options.length-need;k++){const i=options[k];chosen[i]=1;selected.push(i);for(const e of faces[i].edgeIds)count[e]++;
 dfs(cost+faces[i].cost);
 for(const e of faces[i].edgeIds)count[e]--;selected.pop();chosen[i]=0;banned[i]=1;excluded.push(i);if(limit)break;}
 for(const i of excluded)banned[i]=0;
 }dfs(0);
 diag.searchNodes=steps;diag.selectionSearchComplete=!limit;diag.improvingSolutions=valid;diag.score=bestCost===Infinity?null:bestCost;
 return best;
}
export function extractCells(input,options={}){
 const o={maxSides:6,maxCandidateSides:12,tolerance:1e-7,curveSamples:16,maxCycleVisits:500000,maxCandidates:30000,maxSearchNodes:200000,...options};
 for(const k of ['maxSides','maxCandidateSides','curveSamples','maxCycleVisits','maxCandidates','maxSearchNodes'])if(!Number.isInteger(o[k])||o[k]<1)throw Error('Invalid option '+k);
 if(!(o.tolerance>0&&Number.isFinite(o.tolerance)))throw Error('Invalid tolerance');
 let g=normalize(input,o);
 if(!g.edges.length)return {status:'unresolved',fills:[],holes:[],discarded:[],shell:[],boundaryEdges:[],unusedEdges:[],diagnostics:{reason:'no-edges',geometricIntersectionCheck:false}};
 const degree=g.adj.map(hs=>hs.length),removed=new Set(),queue=[];
 degree.forEach((d,i)=>{if(d<2)queue.push(i);});
 while(queue.length){const v=queue.pop();for(const h of g.adj[v]){const e=h>>1;if(removed.has(e))continue;removed.add(e);const w=g.to(h);degree[v]--;if(--degree[w]===1)queue.push(w);}}
 const danglingEdges=[...removed].map(i=>g.edges[i].id);
 if(removed.size){const remaining=input.edges.filter((_,i)=>!removed.has(i)),nodes=input.nodes.filter((_,i)=>degree[i]>0);
 if(!remaining.length)return {status:'unresolved',fills:[],holes:[],discarded:[],shell:[],boundaryEdges:[],unusedEdges:input.edges.map(e=>e.id),diagnostics:{reason:'no-cycles',geometricIntersectionCheck:false}};
 g=normalize({nodes,edges:remaining},o);}
 else if(degree.some(d=>d===0))g=normalize({nodes:input.nodes.filter((_,i)=>degree[i]>0),edges:input.edges},o);
 const faces=[],keys=new Set(),diagnostics={geometricIntersectionCheck:false,externalShellValidator:typeof o.acceptShell==='function',guarantee:'combinatorial-only',maxCandidateSides:o.maxCandidateSides};
 let capped=false;
 function addFace(loops,planar,a){const k=key(loops);if(keys.has(k))return;if(faces.length>=o.maxCandidates){capped=true;return;}keys.add(k);
 const edgeIds=loops.flat().map(h=>h>>1);if(new Set(edgeIds).size!==edgeIds.length)return;
 const sides=edgeIds.length,cost=planar?1:1+sides*sides;
 faces.push({loops,planar,area:a,sides,cost,edgeIds});}
 if(!o.spatialOnly)planarCandidates(g,addFace,diagnostics);
 spatialCandidates(g,o,addFace,diagnostics);
 diagnostics.candidates=faces.length;diagnostics.candidateCapReached=capped;
 let selected=solve(g,faces,o,diagnostics),closed=!!selected,check=selected?validate(g,faces,selected):null;
 if(!selected){const flat=g.plane(g.edges.flatMap(e=>e.cp));selected=flat?faces.map((f,i)=>f.planar?i:-1).filter(i=>i>=0):[];}
 const publicFace=(fi,si)=>{const f=faces[fi],flip=check?.flip[si]===1;
 return {id:fi,planar:f.planar,sides:f.sides,area:f.area,loops:f.loops.map(l=>(flip?reverse(l):l).map(h=>({edge:g.edges[h>>1].id,reversed:!!(h&1)}))),_edges:f.edgeIds};};
 const shell=selected.map(publicFace),holes=shell.filter(f=>!f.planar&&f.sides>o.maxSides),holeIds=new Set(holes.map(f=>f.id));
 const active=shell.filter(f=>!holeIds.has(f.id)),incidence=new Map();active.forEach((f,i)=>f._edges.forEach(e=>{if(!incidence.has(e))incidence.set(e,[]);incidence.get(e).push(i);}));
 const graph=active.map(()=>[]);for(const [e,xs] of incidence)if(!g.edges[e].boundary)for(const a of xs)for(const b of xs)if(a!==b)graph[a].push(b);
 const seen=new Set(),components=[];for(let i=0;i<active.length;i++)if(!seen.has(i)){const comp=[],stack=[i];seen.add(i);while(stack.length){const x=stack.pop();comp.push(x);for(const y of graph[x])if(!seen.has(y)){seen.add(y);stack.push(y);}}components.push(comp);}
 components.sort((a,b)=>b.length-a.length||a[0]-b[0]);const keep=new Set(!closed&&!g.edges.some(e=>e.boundary)?active.map((_,i)=>i):(components[0]??[]));
 const fills=active.filter((_,i)=>keep.has(i)),discarded=active.filter((_,i)=>!keep.has(i));
 const outCount=new Map();fills.forEach(f=>f._edges.forEach(e=>outCount.set(e,(outCount.get(e)??0)+1)));
 const unresolvedBoundary=g.edges.filter((e,i)=>e.boundary&&(outCount.get(i)??0)===2).map(e=>e.id);
 diagnostics.unresolvedBoundary=unresolvedBoundary;
 diagnostics.eulerCharacteristic=closed?g.nodes.length-g.edges.length+shell.reduce((s,f)=>s+2-f.loops.length,0):null;
 diagnostics.genus=closed?(2-diagnostics.eulerCharacteristic)/2:null;
 const clean=f=>{const {_edges,...rest}=f;return rest;};
 return {status:closed?(unresolvedBoundary.length?'boundary-unresolved':'closed-candidate'):fills.length?'planar-open':'unresolved',fills:fills.map(clean),holes:holes.map(clean),discarded:discarded.map(clean),shell:shell.map(clean),boundaryEdges:g.edges.filter((e,i)=>outCount.get(i)===1).map(e=>e.id),unusedEdges:[...danglingEdges,...g.edges.filter((e,i)=>!outCount.has(i)).map(e=>e.id)],diagnostics};
}
