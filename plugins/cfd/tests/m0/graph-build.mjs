import {sitesFromMetric,buildGraph} from './voronoi.mjs';
import {metricSampler} from './metric.mjs';

export function pressureHierarchy(fine){
  const levels=[fine];
  while((levels.length<4||levels.at(-1).diag.length>96)&&levels.at(-1).diag.length>20){
    const l=levels.at(-1),n=l.diag.length,group=new Int32Array(n).fill(-1);let groups=0;
    for(let i=0;i<n;i++){
      if(group[i]>=0)continue;
      const members=[i];group[i]=groups;
      for(let k=0;k<members.length&&members.length<8;k++){
        const v=members[k],neighbours=[];
        for(let e=l.offset[v];e<l.offset[v+1];e++)if(group[l.nbr[e]]<0)neighbours.push(e);
        neighbours.sort((a,b)=>l.c[b]-l.c[a]);
        for(const e of neighbours){const j=l.nbr[e];if(group[j]<0){group[j]=groups;members.push(j);}if(members.length===8)break;}
      }groups++;
    }
    if(groups===n)break;
    const adjacency=Array.from({length:groups},()=>new Map()),boundary=new Float64Array(groups);
    const membership=Array.from({length:groups},()=>[]);
    for(let i=0;i<n;i++){
      const g=group[i];membership[g].push(i);boundary[g]+=l.boundary[i];
      for(let e=l.offset[i];e<l.offset[i+1];e++){const h=group[l.nbr[e]];if(h!==g)adjacency[g].set(h,(adjacency[g].get(h)??0)+l.c[e]);}
    }
    const rows=adjacency.map(m=>[...m]),next=scalarLevel(rows,boundary);
    l.parent=Uint32Array.from(group);l.children=Uint32Array.from(membership.flat());
    l.childOffset=offsets(membership);levels.push(next);
  }
  return levels;
}
function offsets(rows){const off=new Uint32Array(rows.length+1);rows.forEach((row,i)=>off[i+1]=off[i]+row.length);return off;}
function scalarLevel(rows,boundary){
  const offset=offsets(rows),num=offset.at(-1),nbr=new Uint32Array(num),c=new Float32Array(num),diag=new Float32Array(rows.length);
  for(let i=0;i<rows.length;i++){let d=boundary[i];rows[i].forEach(([j,v],k)=>{nbr[offset[i]+k]=j;c[offset[i]+k]=v;d+=v;});diag[i]=d;}
  return {offset,nbr,c,diag,boundary};
}
const isOpen=(type,f)=>type>0&&type<=6&&!(type===1&&!f.rotor)&&!(type===3&&f.name==='ahmed');

export function packGraph(graph,f){
  const nodes=graph.nodes,rows=nodes.map(n=>n.links),offset=offsets(rows),m=offset.at(-1),n=nodes.length;
  const nbr=new Uint32Array(m),kind=new Uint32Array(m),linkFace=new Int32Array(m),coeff=new Float32Array(4*m),pos=new Float32Array(4*n),wallDist=new Float32Array(n);
  const pressureRows=[],boundary=new Float64Array(n);let dt=Infinity;
  for(let i=0;i<n;i++){
    const cell=nodes[i],row=[];pos.set([...cell.p,cell.vol],4*i);let area=0,sumC=0,nearestWall=Infinity;
    rows[i].forEach((link,k)=>{
      const e=offset[i]+k;const size=Math.hypot(...link.A);area+=size;sumC+=link.c;
      nbr[e]=link.j<0?i:link.j;kind[e]=link.type;linkFace[e]=link.face;coeff.set([...link.A,link.c],4*e);
      if(link.j>=0)row.push([link.j,link.c]);else if(isOpen(link.type,f))boundary[i]+=link.c;
      if(link.type===7 || (link.type===3&&f.name==='ahmed'))nearestWall=Math.min(nearestWall,size/link.c);
    });
    wallDist[i]=nearestWall;
    dt=Math.min(dt,.75*cell.vol/(.5*f.maxSpeed*area+2*f.nu*sumC));
    pressureRows.push(row);
  }
  // A pressure reference is required in each isolated Neumann component.
  const seen=new Uint8Array(n);let components=0,gauges=0;
  for(let seed=0;seed<n;seed++)if(!seen[seed]){
    const todo=[seed];seen[seed]=1;let dirichlet=false;components++;
    for(let k=0;k<todo.length;k++){const i=todo[k];if(boundary[i]>0)dirichlet=true;
      for(const [j] of pressureRows[i])if(!seen[j]){seen[j]=1;todo.push(j);}}
    if(!dirichlet){boundary[seed]+=pressureRows[seed].reduce((a,e)=>a+e[1],0)||1;gauges++;}
  }
  return {offset,nbr,kind,linkFace,faces:graph.faces,coeff,pos,dt,components,gauges,wallDist,
    levels:pressureHierarchy(scalarLevel(pressureRows,boundary))};
}

export function graphFromField(f,field){
  const t=performance.now(),metric=metricSampler(f,field),cloud=sitesFromMetric(metric),seedsMs=performance.now()-t;
  const graph=buildGraph(cloud,metric,null,true);
  const voronoiMs=performance.now()-t-seedsMs,packed=packGraph(graph,f);
  for(let i=0;i<graph.nodes.length;i++)if(!Number.isFinite(packed.wallDist[i]))packed.wallDist[i]=Math.max(f.h*.1,metric.sample(graph.nodes[i].p));
  return {packed,stats:{sites:graph.nodes.length,edges:graph.edges,blockedEdges:graph.cuts,maxDegree:graph.maxDegree,
    maxRelativeClosure:graph.maxClosure,minVolumeM3:graph.minVolume,anchors:cloud.anchors,tangentM:cloud.tangent,firstLayerM:cloud.firstLayer,
    components:packed.components,gauges:packed.gauges,levels:packed.levels.map(l=>l.diag.length),seedsMs,voronoiMs,totalCpuMs:performance.now()-t}};
}
if(typeof WorkerGlobalScope!=='undefined' && self instanceof WorkerGlobalScope){
  self.onmessage=({data})=>{try{
    const result=graphFromField(data.f,data.field),transfer=new Set();
    function collect(obj){if(ArrayBuffer.isView(obj))transfer.add(obj.buffer);else if(obj&&typeof obj==='object')Object.values(obj).forEach(collect);}
    collect(result);self.postMessage(result,[...transfer]);
  }catch(e){self.postMessage({error:e.stack});}};
}
