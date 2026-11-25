import {crossesMetric} from './metric.mjs';

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const addScaled=(a,b,s)=>[a[0]+s*b[0],a[1]+s*b[1],a[2]+s*b[2]];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>Math.sqrt(dot(a,a));
const unit=a=>{const n=norm(a);return a.map(v=>v/n);};
const average=points=>points.reduce((a,b)=>addScaled(a,b,1/points.length),[0,0,0]);

class Buckets{
  constructor(h){this.h=h;this.map=new Map();}
  key(p){return p.map(x=>Math.floor(x/this.h));}
  put(p,id){const k=this.key(p).join('/');if(!this.map.has(k))this.map.set(k,[]);this.map.get(k).push(id);}
  near(p,r,visit){const lo=this.key(p.map(v=>v-r)),hi=this.key(p.map(v=>v+r));
    for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++){
      const ids=this.map.get(x+'/'+y+'/'+z);if(ids)for(const id of ids)visit(id);
    }}
}
function morton(p,lo,hi){
  const q=p.map((x,i)=>Math.max(0,Math.min(1023,Math.floor(1023*(x-lo[i])/(hi[i]-lo[i])))));
  let result=0;for(let b=0;b<10;b++)for(let a=0;a<3;a++)result+=((q[a]>>b)&1)*2**(3*b+a);
  return result;
}

export function surfaceAnchors(metric){
  const {f,field,normal}=metric,h=f.h,d=f.dims;
  const tangent=f.graphTangentM??2.25*h,surface=[],hash=new Buckets(tangent);
  const n=d[0]*d[1]*d[2], stride=[1,d[0],d[0]*d[1]];
  for(let i=0;i<n;i++){
    const q=[i%d[0],Math.floor(i/d[0])%d[1],Math.floor(i/stride[2])];
    for(let axis=0;axis<3;axis++){
      if(q[axis]+1>=d[axis])continue;
      const a=field[i],b=field[i+stride[axis]];if((a<0)===(b<0))continue;
      const p=q.map((x,k)=>f.origin[k]+(x+.5)*h);p[axis]+=h*a/(a-b);
      let near=false;hash.near(p,tangent,j=>{if(norm(sub(p,surface[j].p))<tangent)near=true;});
      if(near)continue;
      const normalAt=normal(p);if(!normalAt)continue;
      hash.put(p,surface.length);surface.push({p,n:normalAt});
    }
  }
  return surface;
}

export function graphLayerDistances(f){
  const h=f.h,background=(f.domain?.h??2*h)/2;
  const layers=f.graphWallLayers?[...f.graphWallLayers]:[.32*h,1.15*h,2.8*h,5.2*h];
  if(f.graphWallLayers||f.graphTangentM){
    for(let offset=1.7*layers.at(-1);offset<4.4*background;offset*=1.7)layers.push(offset);
    if(5.2*background>1.25*layers.at(-1))layers.push(5.2*background);
  }
  return layers;
}

export function sitesFromMetric(metric,fitted=null){
  const {f,sample}=metric,h=f.h,domain=f.domain??f,lo=domain.origin,hi=domain.dims.map((v,k)=>lo[k]+v*domain.h);
  const tangent=f.graphTangentM??2.25*h,background=(f.domain?.h??2*h)/2,coarse=6*background;
  const surface=fitted??surfaceAnchors(metric),layers=graphLayerDistances(f),offsets=[-layers[0],...layers],all=new Buckets(h),points=[];
  const minLayerWidth=Math.min(...layers.map((d,i)=>d-(i?layers[i-1]:0)));
  const tolerance=f.graphWallLayers?Math.min(.18*h,.2*minLayerWidth):.18*h;
  function insert(p,solid,layer){
    if(p.some((v,k)=>v<=lo[k]+h*.01||v>=hi[k]-h*.01))return;
    let duplicate=false;all.near(p,tolerance,j=>{if(norm(sub(p,points[j].p))<tolerance)duplicate=true;});
    if(!duplicate){all.put(p,points.length);points.push({p,solid,layer});}
  }
  for(const s of surface){
    for(const [k,offset] of offsets.entries()){
      const p=addScaled(s.p,s.n,offset);
      if(s.clear?s.clear[k]:(sample(p)<0)===(offset<0))insert(p,offset<0,offset/h);
    }
  }
  const nd=hi.map((v,k)=>Math.max(1,Math.round((v-lo[k])/coarse)));
  for(let z=0;z<nd[2];z++)for(let y=0;y<nd[1];y++)for(let x=0;x<nd[0];x++){
    const p=[x,y,z].map((v,k)=>lo[k]+(v+.5)*(hi[k]-lo[k])/nd[k]);
    if(sample(p)>Math.min(4.4*background,0.85*layers.at(-1)))insert(p,false,Infinity);
  }
  points.sort((a,b)=>morton(a.p,lo,hi)-morton(b.p,lo,hi));
  return {points,lo,hi,spacing:coarse,anchors:surface.length,tangent,firstLayer:layers[0],layers};
}

function boxFaces(lo,hi){
  return Array.from({length:6},(_,i)=>{
    const a=Math.floor(i/2),b=(a+1)%3,c=(a+2)%3;
    const vertices=[[0,0],[1,0],[1,1],[0,1]].map(([s,t])=>{
      const p=[0,0,0];p[a]=i%2?hi[a]:lo[a];p[b]=s?hi[b]:lo[b];p[c]=t?hi[c]:lo[c];return p;
    });
    return {id:-i-1,vertices};
  });
}
function clip(faces,site,direction,offset,eps){
  const out=[],cap=[];
  for(const face of faces){
    const input=face.vertices,vertices=[];let a=input.at(-1),da=dot(a,direction)-offset;
    for(const b of input){
      const db=dot(b,direction)-offset;
      if((da>eps)!==(db>eps)){
        const p=addScaled(a,sub(b,a),Math.min(1,Math.max(0,da/(da-db))));vertices.push(p);
        if(!cap.some(q=>norm(sub(q,p))<eps*4))cap.push(p);
      }
      if(db<=eps)vertices.push(b);a=b;da=db;
    }
    if(vertices.length>=3)out.push({id:face.id,vertices});
  }
  if(cap.length>=3){
    const center=average(cap),t=unit(cross(direction,Math.abs(direction[0])<.8?[1,0,0]:[0,1,0])),b=cross(direction,t);
    const angle=p=>Math.atan2(dot(sub(p,center),b),dot(sub(p,center),t));
    cap.sort((a,b)=>angle(a)-angle(b));out.push({id:site,vertices:cap});
  }
  return out;
}
function cellFaces(i,cloud,bins){
  const {points,lo,hi,spacing}=cloud,p=points[i].p,eps=spacing*1e-9;
  let faces=boxFaces(sub(lo,p),sub(hi,p)),radius=2*(Number.isFinite(points[i].layer)?cloud.tangent??spacing:spacing),processed=0;
  let extent=norm(lo.map((v,k)=>Math.max(p[k]-v,hi[k]-p[k])));
  while(true){
    const neighbours=[];bins.near(p,radius,j=>{
      const v=sub(points[j].p,p),d=norm(v);if(j!==i&&d>processed&&d<=radius)neighbours.push({j,v,d});
    });
    neighbours.sort((a,b)=>a.d-b.d);
    for(let k=0;k<neighbours.length;k++){
      const {j,v,d}=neighbours[k];
      if(d>2*extent+2*eps)break;
      faces=clip(faces,j,v.map(x=>x/d),.5*d,eps);
      if(k%8===7||k===neighbours.length-1){
        extent=0;for(const face of faces)for(const vertex of face.vertices)extent=Math.max(extent,norm(vertex));
      }
    }
    if(2*extent<=radius+eps)break;
    processed=radius;radius=Math.min(2*extent+eps,radius*2);
  }
  return faces.map(({id,vertices})=>{
    const n=id>=0?unit(sub(points[id].p,p)):[0,1,2].map(k=>Math.floor((-1-id)/2)===k?((-1-id)%2?1:-1):0);
    let area=0;for(let j=1;j+1<vertices.length;j++)area+=.5*Math.abs(dot(cross(sub(vertices[j],vertices[0]),sub(vertices[j+1],vertices[0])),n));
    return {id,n,area,dist:dot(vertices[0],n),vertices};
  }).filter(face=>face.area>eps*eps*100);
}

// Construct each bisector once for the flux table. Keep all neighbours in CSR;
// a degree cap can open the control volume. Areas and volumes are in SI.
export function buildGraph(cloud,metric,certificate=null,keepFaces=false){
  const {points,spacing}=cloud,bins=new Buckets(spacing),index=new Int32Array(points.length).fill(-1),nodes=[];
  points.forEach((s,i)=>{bins.put(s.p,i);if(!s.solid){index[i]=nodes.length;nodes.push({p:s.p,vol:0,links:[],layer:s.layer});}});
  let cuts=0,maxClosure=0,minVolume=Infinity,maxDegree=0,edges=0;
  const corners=[],starts=[0],planes=[];
  function canonical(face,distance){
    if(!keepFaces)return 0;
    const id=planes.length/4;planes.push(...face.n,distance);
    for(const p of face.vertices)corners.push(...p,0);
    starts.push(corners.length/4);return id;
  }
  for(let i=0;i<points.length;i++){
    const k=index[i];if(k<0)continue;
    const cell=nodes[k];
    for(const face of cellFaces(i,cloud,bins)){
      const {id,n,area,dist}=face;cell.vol+=area*dist/3;
      const A=n.map(v=>v*area);
      if(id<0||index[id]<0){cell.links.push({j:-1,type:id<0?-id:7,A,c:area/dist,face:canonical(face,dist)});continue;}
      const j=index[id];if(j<=k)continue;
      const through=certificate?.(cell.p,nodes[j].p)||(!metric.f?.graphNative&&crossesMetric(metric,cell.p,nodes[j].p));
      const c=area/(2*dist),minus=A.map(v=>-v),faceId=canonical(face,through?dist:2*dist);
      if(through){
        cuts++;cell.links.push({j:-1,type:7,A,c:2*c,face:faceId});nodes[j].links.push({j:-1,type:7,A:minus,c:2*c,face:~faceId});
      }else{
        edges++;cell.links.push({j,type:0,A,c,face:faceId});nodes[j].links.push({j:k,type:0,A:minus,c,face:~faceId});
      }
    }
  }
  for(const cell of nodes){
    let total=0,net=[0,0,0];for(const l of cell.links){total+=norm(l.A);net=addScaled(net,l.A,1);}
    maxClosure=Math.max(maxClosure,norm(net)/total);minVolume=Math.min(minVolume,cell.vol);maxDegree=Math.max(maxDegree,cell.links.length);
  }
  if(!(maxClosure<2e-6&&minVolume>0))throw Error('Invalid Voronoi volume or area closure: '+JSON.stringify({maxClosure,minVolume}));
  return {nodes,edges,cuts,maxClosure,minVolume,maxDegree,
    faces:keepFaces?{starts:Uint32Array.from(starts),corners:Float32Array.from(corners),planes:Float32Array.from(planes)}:null};
}
