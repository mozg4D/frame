const add=(a,b)=>a.length===3?[a[0]+b[0],a[1]+b[1],a[2]+b[2]]:a.map((x,i)=>x+b[i]);
const sub=(a,b)=>a.length===3?[a[0]-b[0],a[1]-b[1],a[2]-b[2]]:a.map((x,i)=>x-b[i]);
const mul=(a,s)=>a.length===3?[a[0]*s,a[1]*s,a[2]*s]:a.map(x=>x*s);
const dot=(a,b)=>a.length===3?a[0]*b[0]+a[1]*b[1]+a[2]*b[2]:a.reduce((v,x,i)=>v+x*b[i],0);
const len=a=>a.length===3?Math.hypot(a[0],a[1],a[2]):Math.sqrt(dot(a,a));
const unit=a=>{const l=len(a);return l>0?mul(a,1/l):[0,0,0];};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const reject=(v,axis)=>sub(v,mul(axis,dot(v,axis)));
const rotate=(v,axis,angle)=>{const c=Math.cos(angle),s=Math.sin(angle);return add(add(mul(v,c),mul(cross(axis,v),s)),mul(axis,dot(axis,v)*(1-c)));};
const signedAngle=(a,b,axis)=>Math.atan2(dot(axis,cross(a,b)),dot(a,b));
const lerp=(a,b,t)=>add(mul(a,1-t),mul(b,t));
const cubic=(p,t)=>{const u=1-t;return p[0].map((_,i)=>u*u*u*p[0][i]+3*u*u*t*p[1][i]+3*u*t*t*p[2][i]+t*t*t*p[3][i]);};
const derivative=(p,t)=>{const u=1-t;return p[0].map((_,i)=>3*u*u*(p[1][i]-p[0][i])+6*u*t*(p[2][i]-p[1][i])+3*t*t*(p[3][i]-p[2][i]));};
const speed=(p,t)=>len(derivative(p,t));
function simpson(p,a,b){const m=(a+b)/2;return (b-a)*(speed(p,a)+4*speed(p,m)+speed(p,b))/6;}
function integrate(p,a,b,tol,depth=0,whole=simpson(p,a,b)){const m=(a+b)/2,l=simpson(p,a,m),r=simpson(p,m,b),sum=l+r;if(depth>=20||Math.abs(sum-whole)<=15*tol)return sum+(sum-whole)/15;return integrate(p,a,m,tol/2,depth+1,l)+integrate(p,m,b,tol/2,depth+1,r);}
function buildPieceTable(p,tol){const out=[{t:0,length:0}],walk=(a,b,whole,depth)=>{const m=(a+b)/2,l=simpson(p,a,m),r=simpson(p,m,b);if(depth>=20||Math.abs(l+r-whole)<=15*tol){out.push({t:b,length:l+r+(l+r-whole)/15});return;}walk(a,m,l,depth+1);walk(m,b,r,depth+1);};walk(0,1,simpson(p,0,1),0);let total=0;for(let i=1;i<out.length;i++){total+=out[i].length;out[i].length=total;}return out;}
function tangentLimit(p,t,side,epsilon=1e-12){for(let step=1e-7;step<=1e-2;step*=10){const q=Math.max(0,Math.min(1,t+side*step)),d=derivative(p,q);if(len(d)>epsilon)return unit(d);}return null;}

export class EdgeGeomCache{
  constructor(splineRef,{tolerance=1e-7,geometryVersion=0}={}){
    if(!Array.isArray(splineRef)||!splineRef.length)throw new Error('logical edge needs at least one cubic piece');
    this.splineRef=splineRef.map(p=>p.map(q=>q.slice()));this.geometryVersion=geometryVersion;this.tolerance=Math.max(1e-12,tolerance);this.stationaryMarkers=[];this.cuspMarkers=[];this.adaptiveArcLengthTable=[];this.pieces=[];this.positionCache=new Map();this.tangentCache=new Map();let offset=0;
    for(let index=0;index<this.splineRef.length;index++){const controls=this.splineRef[index],scale=Math.max(Number.MIN_VALUE,...controls.slice(1).map((q,i)=>len(sub(q,controls[i])))),table=buildPieceTable(controls,this.tolerance*scale),length=table.at(-1).length;this.pieces.push({index,controls,table,length,offset,scale});for(const row of table)this.adaptiveArcLengthTable.push({piece:index,t:row.t,length:offset+row.length});this.#classifyStationary(index,controls,offset,length,scale);offset+=length;}
    for(let index=1;index<this.pieces.length;index++){const before=this.pieces[index-1],after=this.pieces[index],epsilon=Math.max(before.scale,after.scale)*1e-12,minus=tangentLimit(before.controls,1,-1,epsilon),plus=tangentLimit(after.controls,0,1,epsilon);if(minus&&plus&&dot(minus,plus)<1-1e-5)this.cuspMarkers.push({piece:index,t:0,length:after.offset,s:0,minus,plus,junction:true});}
    this.totalLength=offset;for(const row of this.adaptiveArcLengthTable)row.s=offset?row.length/offset:0;for(const marker of this.stationaryMarkers)marker.s=offset?marker.length/offset:0;
    for(const marker of this.cuspMarkers)marker.s=offset?marker.length/offset:0;
  }
  #classifyStationary(piece,p,offset,pieceLength,scale){const candidates=new Set([0,1]);for(let i=1;i<64;i++)candidates.add(i/64);let best=[...candidates].map(t=>({t,v:speed(p,t)})).sort((a,b)=>a.v-b.v).slice(0,3);const eps=scale*1e-9,tangentEps=scale*1e-12;for(const q of best){let t=q.t;for(let i=0;i<16;i++){const h=1e-5,a=Math.max(0,t-h),b=Math.min(1,t+h),fa=speed(p,a)**2,f=speed(p,t)**2,fb=speed(p,b)**2,den=(fb-2*f+fa)/(h*h);if(Math.abs(den)<Number.MIN_VALUE)break;t=Math.max(0,Math.min(1,t-(fb-fa)/(2*h)/den));}if(speed(p,t)>eps||this.stationaryMarkers.some(x=>x.piece===piece&&Math.abs(x.t-t)<1e-5))continue;const minus=tangentLimit(p,t,-1,tangentEps),plus=tangentLimit(p,t,1,tangentEps),length=offset+integrate(p,0,t,this.tolerance*Math.max(Number.MIN_VALUE,pieceLength));const marker={piece,t,length,s:0,minus,plus};this.stationaryMarkers.push(marker);if(minus&&plus&&dot(minus,plus)<1-1e-5)this.cuspMarkers.push(marker);}}
  #locate(s){if(!this.totalLength)return {piece:this.pieces[0],target:0};const target=Math.max(0,Math.min(1,+s||0))*this.totalLength;let lo=0,hi=this.pieces.length-1;while(lo<hi){const m=(lo+hi)>>1;if(this.pieces[m].offset+this.pieces[m].length<target)lo=m+1;else hi=m;}return {piece:this.pieces[lo],target:target-this.pieces[lo].offset};}
  #parameter(piece,target){if(target<=0)return 0;if(target>=piece.length)return 1;const table=piece.table;let lo=0,hi=table.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(table[m].length<target)lo=m;else hi=m;}const baseT=table[lo].t,baseLength=table[lo].length;let a=baseT,b=table[hi].t,t=a+(b-a)*(target-baseLength)/(table[hi].length-baseLength);for(let i=0;i<20;i++){const current=baseLength+integrate(piece.controls,baseT,t,this.tolerance*Math.max(1,piece.length)),f=current-target;if(Math.abs(f)<=this.tolerance*Math.max(1,piece.length))return t;if(f>0)b=t;else a=t;const v=speed(piece.controls,t),next=v>1e-14?t-f/v:NaN;t=Number.isFinite(next)&&next>a&&next<b?next:(a+b)/2;}return t;}
  EvalPosition(s){s=Math.max(0,Math.min(1,+s||0));let value=this.positionCache.get(s);if(value)return value;const q=this.#locate(s),t=this.#parameter(q.piece,q.target);value=cubic(q.piece.controls,t);this.positionCache.set(s,value);return value;}
  EvalTangent(s){s=Math.max(0,Math.min(1,+s||0));let value=this.tangentCache.get(s);if(value)return value;const q=this.#locate(s),t=this.#parameter(q.piece,q.target),d=derivative(q.piece.controls,t),epsilon=q.piece.scale*1e-12;value=len(d)>epsilon?unit(d):(tangentLimit(q.piece.controls,t,t>=1?-1:1,epsilon)||tangentLimit(q.piece.controls,t,-1,epsilon)||[0,0,0]);this.tangentCache.set(s,value);return value;}
}

function smallestEigenvectorSymmetric3(matrix){
  const a=matrix.map(row=>row.slice()),v=[[1,0,0],[0,1,0],[0,0,1]];
  for(let sweep=0;sweep<24;sweep++){
    let p=0,q=1,best=Math.abs(a[0][1]);for(const [i,j] of [[0,2],[1,2]])if(Math.abs(a[i][j])>best){p=i;q=j;best=Math.abs(a[i][j]);}
    if(best<1e-15)break;
    const angle=.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]),c=Math.cos(angle),s=Math.sin(angle);
    for(let k=0;k<3;k++)if(k!==p&&k!==q){const akp=a[k][p],akq=a[k][q];a[k][p]=a[p][k]=c*akp-s*akq;a[k][q]=a[q][k]=s*akp+c*akq;}
    const app=a[p][p],aqq=a[q][q],apq=a[p][q];a[p][p]=c*c*app-2*s*c*apq+s*s*aqq;a[q][q]=s*s*app+2*s*c*apq+c*c*aqq;a[p][q]=a[q][p]=0;
    for(let k=0;k<3;k++){const vkp=v[k][p],vkq=v[k][q];v[k][p]=c*vkp-s*vkq;v[k][q]=s*vkp+c*vkq;}
  }
  let index=0;if(a[1][1]<a[index][index])index=1;if(a[2][2]<a[index][index])index=2;return {value:a[index][index],vector:unit(v.map(row=>row[index]))};
}

export class VertexFanPlaneCache{
  constructor(tangents,{coplanarTolerance=1e-6,collinearTolerance=1e-8,geometryVersion=0}={}){
    this.geometryVersion=geometryVersion;this.tangents=(tangents||[]).map(unit).filter(t=>len(t)>0);this.normal=null;this.residual=Infinity;
    if(this.tangents.length<2){this.status='CornerPlaneUnderdetermined';return;}
    let rankTwo=false;for(let i=0;i<this.tangents.length&&!rankTwo;i++)for(let j=i+1;j<this.tangents.length;j++)if(len(cross(this.tangents[i],this.tangents[j]))>collinearTolerance){rankTwo=true;break;}
    if(!rankTwo){this.status='CornerPlaneUnderdetermined';return;}
    const m=[[0,0,0],[0,0,0],[0,0,0]];for(const t of this.tangents)for(let i=0;i<3;i++)for(let j=0;j<3;j++)m[i][j]+=t[i]*t[j];
    this.normal=smallestEigenvectorSymmetric3(m).vector;this.residual=Math.max(...this.tangents.map(t=>Math.abs(dot(this.normal,t))));
    if(this.residual>coplanarTolerance){this.normal=null;this.status='G1CornerIncompatible';return;}this.status='Ok';
  }
  get valid(){return this.status==='Ok';}
}

function transportNormal(normal,t0,t1){
  const axis=cross(t0,t1),s=len(axis),c=Math.max(-1,Math.min(1,dot(t0,t1)));
  if(s<1e-12){if(c>=0)return unit(reject(normal,t1));const fallback=unit(reject(Math.abs(t0[0])<.8?[1,0,0]:[0,1,0],t0));return unit(reject(rotate(normal,fallback,Math.PI),t1));}
  return unit(reject(rotate(normal,mul(axis,1/s),Math.atan2(s,c)),t1));
}

export class EdgePlaneCache{
  constructor(edgeGeom,startFan,endFan,{geometryVersion=edgeGeom?.geometryVersion??0}={}){
    if(!edgeGeom||typeof edgeGeom.EvalTangent!=='function'||!Array.isArray(edgeGeom.adaptiveArcLengthTable))throw new Error('EdgePlaneCache needs edge geometry cache');
    if(!startFan?.valid||!endFan?.valid)throw new Error('EdgePlaneCache needs valid endpoint fan planes');
    this.edgeGeom=edgeGeom;this.geometryVersion=geometryVersion;const stations=[...new Set(edgeGeom.adaptiveArcLengthTable.map(x=>x.s))].sort((a,b)=>a-b);if(stations[0]!==0)stations.unshift(0);if(stations.at(-1)!==1)stations.push(1);
    let tangent=edgeGeom.EvalTangent(0),normal=unit(reject(startFan.normal,tangent));this.samples=[{s:0,tangent,base:normal}];
    for(const s of stations.slice(1)){const next=edgeGeom.EvalTangent(s);normal=transportNormal(normal,tangent,next);tangent=next;this.samples.push({s,tangent,base:normal});}
    const endT=edgeGeom.EvalTangent(1),targetA=unit(reject(endFan.normal,endT)),targetB=mul(targetA,-1),base=this.samples.at(-1).base,a=Math.abs(signedAngle(base,targetA,endT)),b=Math.abs(signedAngle(base,targetB,endT)),target=a<=b?targetA:targetB;this.twist=signedAngle(base,target,endT);
  }
  EvalPlaneNormal(s){s=Math.max(0,Math.min(1,+s||0));let hi=this.samples.findIndex(x=>x.s>=s);if(hi<0)hi=this.samples.length-1;const exactTangent=this.edgeGeom.EvalTangent(s);if(hi===0)return unit(rotate(transportNormal(this.samples[0].base,this.samples[0].tangent,exactTangent),exactTangent,this.twist*s));const lo=hi-1,a=this.samples[lo],base=transportNormal(a.base,a.tangent,exactTangent);return unit(rotate(base,exactTangent,this.twist*s));}
}

function integrateScalar(fn,a=0,b=1,tol=1e-8,depth=0,whole=null){const m=(a+b)/2,fa=fn(a),fm=fn(m),fb=fn(b),base=whole??(b-a)*(fa+4*fm+fb)/6,lm=(a+m)/2,rm=(m+b)/2,left=(m-a)*(fa+4*fn(lm)+fm)/6,right=(b-m)*(fm+4*fn(rm)+fb)/6,sum=left+right;if(depth>=18||Math.abs(sum-base)<=15*tol)return sum+(sum-base)/15;return integrateScalar(fn,a,m,tol/2,depth+1,left)+integrateScalar(fn,m,b,tol/2,depth+1,right);}
function rotationBetweenVector(v,from,to){const axis=cross(from,to),s=len(axis),c=Math.max(-1,Math.min(1,dot(from,to)));if(s>=1e-12)return rotate(v,mul(axis,1/s),Math.atan2(s,c));if(c>=0)return v.slice();const fallback=unit(reject(Math.abs(from[0])<.8?[1,0,0]:[0,1,0],from));return rotate(v,fallback,Math.PI);}

export class CurveMorphCache{
  constructor(C0,C1,A,B,{geometryVersion=Math.max(C0?.geometryVersion??0,C1?.geometryVersion??0,A?.geometryVersion??0,B?.geometryVersion??0),collapseTolerance=1e-9,transportAngleTolerance=1e-4}={}){
    for(const edge of [C0,C1,A,B])if(!(edge instanceof EdgeGeomCache))throw new Error('CurveMorphCache needs four EdgeGeomCache boundaries');
    this.C0=C0;this.C1=C1;this.A=A;this.B=B;this.geometryVersion=geometryVersion;this.status='Ok';
    const memo=fn=>{const cache=new Map();return x=>{let value=cache.get(x);if(value===undefined){value=fn(x);cache.set(x,value);}return value;}},chord=memo(t=>sub(B.EvalPosition(t),A.EvalPosition(t))),origin=memo(t=>mul(add(A.EvalPosition(t),B.EvalPosition(t)),.5));this._chord=chord;this._origin=origin;this.L0=len(chord(0));const geometryScale=Math.max(Number.MIN_VALUE,C0.totalLength,C1.totalLength,A.totalLength,B.totalLength,this.L0);this.collapseLimit=collapseTolerance*geometryScale;if(this.L0<=this.collapseLimit){this.status='ChartSingular';throw new Error('CurveMorph start chord is collapsed');}
    const limit=this.collapseLimit,direction=memo(t=>{const q=chord(t),l=len(q);return l>limit?mul(q,1/l):null;});this._direction=direction;this.u0=direction(0);this.samples=[{t:0,u:this.u0}];
    const append=(a,ua,b,ub,depth)=>{const m=(a+b)/2,um=direction(m);if(!um){if(b<1-1e-12){this.status='ChartSingular';throw new Error('CurveMorph interior chord collapse');}this.samples.push({t:b,u:ua});return;}const predicted=unit(add(ua,ub||um)),angle=len(predicted)?Math.acos(Math.max(-1,Math.min(1,dot(predicted,um)))):Math.PI;if(depth<16&&angle>transportAngleTolerance){append(a,ua,m,um,depth+1);append(m,um,b,ub||um,depth+1);}else this.samples.push({t:b,u:ub||um});};
    const u1=direction(1),seedStations=[...new Set([0,1,...A.adaptiveArcLengthTable.map(x=>x.s),...B.adaptiveArcLengthTable.map(x=>x.s),...Array.from({length:33},(_,i)=>i/32)])].sort((a,b)=>a-b);this.collapseEnd=!u1;if(this.collapseEnd){const probe=1-1e-6,up=direction(probe);if(!up){this.status='ChartSingular';throw new Error('CurveMorph chord collapses before the end');}let pt=0,pu=this.u0;for(const t of seedStations.filter(x=>x>0&&x<probe).concat(probe)){const u=direction(t);if(!u){this.status='ChartSingular';throw new Error('CurveMorph chord collapses before the end');}append(pt,pu,t,u,0);pt=t;pu=u;}this.samples.push({t:1,u:up});}else{let pt=0,pu=this.u0;for(const t of seedStations.slice(1)){const u=direction(t);if(!u){this.status='ChartSingular';throw new Error('CurveMorph interior chord collapse');}append(pt,pu,t,u,0);pt=t;pu=u;}}
    const transportRaw=(v,t)=>{if(t<=0)return v.slice();let out=v.slice(),prev=this.samples[0],i=1;while(i<this.samples.length&&this.samples[i].t<t){out=rotationBetweenVector(out,prev.u,this.samples[i].u);prev=this.samples[i++];}const u=this._direction(t)||this.samples[Math.min(i,this.samples.length-1)].u;return rotationBetweenVector(out,prev.u,u);},transportMatrices=new Map();this._transport=(v,t)=>{let m=transportMatrices.get(t);if(!m){m=[transportRaw([1,0,0],t),transportRaw([0,1,0],t),transportRaw([0,0,1],t)];transportMatrices.set(t,m);}return [m[0][0]*v[0]+m[1][0]*v[1]+m[2][0]*v[2],m[0][1]*v[0]+m[1][1]*v[1]+m[2][1]*v[2],m[0][2]*v[0]+m[1][2]*v[1]+m[2][2]*v[2]];};
    this._inverseEnd=v=>{let out=v.slice();for(let i=this.samples.length-1;i>0;i--)out=rotationBetweenVector(out,this.samples[i].u,this.samples[i-1].u);return out;};
    this.O0=origin(0);this.O1=origin(1);this.r1=len(chord(1))/this.L0;
    const X0=memo(s=>sub(C0.EvalPosition(s),this.O0));this._X0=X0;
    if(this.collapseEnd){this.phi1=0;this._delta=()=>[0,0,0];this.status='CollapsedEnd';return;}
    const Y1=s=>mul(this._inverseEnd(sub(C1.EvalPosition(s),this.O1)),1/this.r1),project=v=>reject(v,this.u0),x=s=>project(X0(s)),y=s=>project(Y1(s)),probes=[0,.25,.5,.75,1],relationScale=Math.max(Number.MIN_VALUE,...probes.map(s=>len(x(s)))),exactRelation=probes.every(s=>len(sub(x(s),y(s)))<=relationScale*1e-10);
    if(exactRelation){this.phi1=0;this._delta=()=>[0,0,0];return;}const aa=integrateScalar(s=>dot(x(s),y(s)),0,1,1e-8),bb=integrateScalar(s=>dot(this.u0,cross(x(s),y(s))),0,1,1e-8);this.phi1=Math.atan2(bb,aa);this._delta=memo(s=>sub(rotate(Y1(s),this.u0,-this.phi1),X0(s)));
  }
  Eval(s,t){s=Math.max(0,Math.min(1,+s||0));t=Math.max(0,Math.min(1,+t||0));const q=this._chord(t),r=len(q)/this.L0;if(r===0)return this._origin(t);const shape=add(this._X0(s),mul(this._delta(s),t)),twisted=rotate(shape,this.u0,t*this.phi1);return add(this._origin(t),mul(this._transport(twisted,t),r));}
  EvalJet(s,t){s=Math.max(0,Math.min(1,+s||0));t=Math.max(0,Math.min(1,+t||0));const edgeDerivative=(edge,x)=>mul(edge.EvalTangent(x),edge.totalLength),ap=edgeDerivative(this.A,t),bp=edgeDerivative(this.B,t),op=mul(add(ap,bp),.5),qp=sub(bp,ap),q=this._chord(t),L=len(q),x0=this._X0(s),delta=this._delta(s),c0s=edgeDerivative(this.C0,s),deltaS=this.collapseEnd?[0,0,0]:sub(rotate(mul(this._inverseEnd(edgeDerivative(this.C1,s)),1/this.r1),this.u0,-this.phi1),c0s),shape=add(x0,mul(delta,t)),shapeS=add(c0s,mul(deltaS,t)),twisted=rotate(shape,this.u0,t*this.phi1),twistedS=rotate(shapeS,this.u0,t*this.phi1),twistedT=add(rotate(delta,this.u0,t*this.phi1),mul(cross(this.u0,twisted),this.phi1));
    if(L<=this.collapseLimit){const rPrime=-len(qp)/this.L0,y=this._transport(twisted,1),position=this._origin(t);return {position,Su:[0,0,0],Sv:add(op,mul(y,rPrime))};}
    const r=L/this.L0,rPrime=dot(q,qp)/(L*this.L0),u=mul(q,1/L),uPrime=mul(sub(qp,mul(u,dot(u,qp))),1/L),y=this._transport(twisted,t),yS=this._transport(twistedS,t),yT=add(this._transport(twistedT,t),cross(cross(u,uPrime),y));return {position:add(this._origin(t),mul(y,r)),Su:mul(yS,r),Sv:add(op,add(mul(y,rPrime),mul(yT,r)))};
  }
  StructuralResidual(){const numerator=Math.sqrt(Math.max(0,integrateScalar(s=>dot(this._delta(s),this._delta(s)),0,1,1e-8))),denominator=Math.sqrt(Math.max(0,integrateScalar(s=>dot(this._X0(s),this._X0(s)),0,1,1e-8)));return denominator>Number.MIN_VALUE?numerator/denominator:(numerator<=Number.MIN_VALUE?0:Infinity);}
}

const edgeRef=value=>{if(typeof value==='string')return {id:value,orientation:1};if(!value?.id)throw new Error('chart edge reference needs persistent id');return {id:String(value.id),orientation:value.orientation===-1?-1:1};};
export class ChartDescriptor{
  constructor(data={}){
    if(!['quad','triangle','ngon'].includes(data.domainType))throw new Error('invalid chart domain type');this.domainType=data.domainType;this.chartVersion=Math.max(1,Math.trunc(data.chartVersion||1));
    if(this.domainType==='triangle'){this.baseEdge=edgeRef(data.baseEdge||{id:data.baseEdgeId,orientation:data.baseOrientation});this.apexVertexId=String(data.apexVertexId??'');if(!this.apexVertexId)throw new Error('triangle chart needs apexVertexId');}
    else{this.primaryEdgeA=edgeRef(typeof data.primaryEdgeA==='string'?{id:data.primaryEdgeA,orientation:data.primaryEdgeAOrientation}:data.primaryEdgeA);this.primaryEdgeB=edgeRef(typeof data.primaryEdgeB==='string'?{id:data.primaryEdgeB,orientation:data.primaryEdgeBOrientation}:data.primaryEdgeB);this.leftChain=(data.leftChain||[]).map(edgeRef);this.rightChain=(data.rightChain||[]).map(edgeRef);Object.freeze(this.leftChain);Object.freeze(this.rightChain);}
    Object.freeze(this);
  }
  persistentKey(){const ref=e=>`${e.id}:${e.orientation}`;return this.domainType==='triangle'?`triangle|${ref(this.baseEdge)}|${this.apexVertexId}`:`${this.domainType}|${ref(this.primaryEdgeA)}|${ref(this.primaryEdgeB)}|L:${this.leftChain.map(ref).join(',')}|R:${this.rightChain.map(ref).join(',')}`;}
  toJSON(){return this.domainType==='triangle'?{domainType:this.domainType,baseEdgeId:this.baseEdge.id,baseOrientation:this.baseEdge.orientation,apexVertexId:this.apexVertexId,chartVersion:this.chartVersion}:{domainType:this.domainType,primaryEdgeA:this.primaryEdgeA.id,primaryEdgeAOrientation:this.primaryEdgeA.orientation,primaryEdgeB:this.primaryEdgeB.id,primaryEdgeBOrientation:this.primaryEdgeB.orientation,leftChain:this.leftChain.map(x=>({id:x.id,orientation:x.orientation})),rightChain:this.rightChain.map(x=>({id:x.id,orientation:x.orientation})),chartVersion:this.chartVersion};}
}

export const estimateChartNumericalErrorBound=({arcLengthTolerance=1e-7,bishopAngleTolerance=1e-4,conditioning=1}={})=>Math.max(64*Number.EPSILON*Math.max(1,conditioning),8*Math.abs(arcLengthTolerance),4*Math.abs(bishopAngleTolerance)*Math.sqrt(Number.EPSILON));

export function initializeChart(candidates,{chartVersion=1,numericalErrorBound=estimateChartNumericalErrorBound(),tieTolerance=numericalErrorBound}={}){
  const valid=[];for(const candidate of candidates||[]){try{const morph=candidate.morph instanceof CurveMorphCache?candidate.morph:new CurveMorphCache(...candidate.boundaries,candidate.options),rho=morph.StructuralResidual();if(!Number.isFinite(rho)||morph.status==='ChartSingular')continue;const descriptorData=candidate.descriptor instanceof ChartDescriptor?candidate.descriptor.toJSON():candidate.descriptor,descriptor=new ChartDescriptor({...descriptorData,chartVersion}),score=Number.isFinite(candidate.bishopScore)?candidate.bishopScore:Infinity;valid.push({candidate,morph,descriptor,rho,bishopScore:score,key:descriptor.persistentKey()});}catch{}}
  if(!valid.length)return {status:'ChartSingular',descriptor:null,morph:null,candidates:[]};const zero=valid.filter(x=>x.rho<=numericalErrorBound),pool=zero.length?zero:valid;pool.sort((a,b)=>Math.abs(a.bishopScore-b.bishopScore)>tieTolerance?a.bishopScore-b.bishopScore:a.key.localeCompare(b.key));const chosen=pool[0];return {status:'Valid',descriptor:chosen.descriptor,morph:chosen.morph,structuralResidual:chosen.rho,numericalZero:chosen.rho<=numericalErrorBound,candidates:valid.map(x=>({key:x.key,structuralResidual:x.rho,bishopScore:x.bishopScore,numericalZero:x.rho<=numericalErrorBound}))};
}

export class PersistentChartState{
  constructor(){this.descriptor=null;this.morph=null;this.topologyVersion=null;this.chartVersion=0;this.lastResult=null;}
  ensure(topologyVersion,candidates,options={}){if(this.descriptor&&this.topologyVersion===topologyVersion)return this.lastResult;return this.reparameterize(topologyVersion,candidates,options);}
  reparameterize(topologyVersion,candidates,options={}){const result=initializeChart(candidates,{...options,chartVersion:this.chartVersion+1});if(result.status==='Valid'){this.chartVersion++;this.topologyVersion=topologyVersion;this.descriptor=result.descriptor;this.morph=result.morph;}this.lastResult=result;return result;}
  updateGeometry(morph){if(!(morph instanceof CurveMorphCache))throw new Error('geometry update needs CurveMorphCache');this.morph=morph;if(this.lastResult)this.lastResult={...this.lastResult,morph,structuralResidual:morph.StructuralResidual()};return this.lastResult;}
}

export const projectG1Residual=(derivative,planeNormal)=>{const n=unit(planeNormal),amount=dot(derivative,n);return mul(n,-amount);};
export class SideField{
  constructor({id,delta,deltaGradient,sideCoord,sideCoordGradient,residual=()=>[0,0,0],residualDerivative=()=>[0,0,0],activeResidual=true}){this.id=String(id);this.DeltaFn=delta;this.DeltaGradientFn=deltaGradient;this.SideCoordFn=sideCoord;this.SideCoordGradientFn=sideCoordGradient;this.ResidualField=residual;this.ResidualDerivativeField=residualDerivative;this.activeResidual=!!activeResidual;}
}
const orientSide=(fn,grad,orientation)=>orientation===-1?{fn:(u,v)=>1-fn(u,v),grad:(u,v)=>mul(grad(u,v),-1)}:{fn,grad};
export function quadSideFields(specs={}){const raw={left:[(u,v)=>u,()=>[1,0],(u,v)=>v,()=>[0,1]],right:[(u,v)=>1-u,()=>[-1,0],(u,v)=>v,()=>[0,1]],bottom:[(u,v)=>v,()=>[0,1],(u,v)=>u,()=>[1,0]],top:[(u,v)=>1-v,()=>[0,-1],(u,v)=>u,()=>[1,0]]};return Object.entries(raw).map(([id,[delta,dg,s,sg]])=>{const cfg=specs[id]||{},oriented=orientSide(s,sg,cfg.orientation);return new SideField({id,delta,deltaGradient:dg,sideCoord:oriented.fn,sideCoordGradient:oriented.grad,...cfg});});}
export function triangleSideFields(specs={}){const raw={side0:[(u,v)=>1-u-v,()=>[-1,-1],(u,v)=>v/(u+v),(u,v)=>{const d=(u+v)**2;return [-v/d,u/d];}],side1:[(u,v)=>u,()=>[1,0],(u,v)=>(1-u-v)/(1-u),(u,v)=>[-v/(1-u)**2,-1/(1-u)]],side2:[(u,v)=>v,()=>[0,1],(u,v)=>u/(1-v),(u,v)=>[1/(1-v),u/(1-v)**2]]};return Object.entries(raw).map(([id,[delta,dg,s,sg]])=>{const cfg=specs[id]||{},oriented=orientSide(s,sg,cfg.orientation);return new SideField({id,delta,deltaGradient:dg,sideCoord:oriented.fn,sideCoordGradient:oriented.grad,...cfg});});}
const envelope=d=>d*(1-d)**3,envelopeDerivative=d=>(1-d)**2*(1-4*d);
export class G1Corrector{
  constructor(predictor,allSidesForPartition,{domainType='quad'}={}){if(typeof predictor?.Eval!=='function'||typeof predictor?.EvalJet!=='function')throw new Error('G1Corrector predictor needs Eval and EvalJet');this.predictor=predictor;this.allSidesForPartition=allSidesForPartition.slice();this.activeResidualSides=this.allSidesForPartition.filter(x=>x.activeResidual);this.domainType=domainType;}
  #domain(u,v){const e=32*Number.EPSILON;return this.domainType==='triangle'?u>=-e&&v>=-e&&u+v<=1+e:u>=-e&&u<=1+e&&v>=-e&&v<=1+e;}
  #data(u,v){return this.allSidesForPartition.map(side=>({side,delta:side.DeltaFn(u,v),dd:side.DeltaGradientFn(u,v)}));}
  Eval(u,v){if(!this.#domain(u,v))throw new Error('surface parameter outside domain');const base=this.predictor.Eval(u,v),sides=this.allSidesForPartition,n=sides.length,deltas=new Array(n),boundaryTolerance=32*Number.EPSILON;let dmin=Infinity;for(let i=0;i<n;i++){const d=sides[i].DeltaFn(u,v);if(Math.abs(d)<=boundaryTolerance)return base;deltas[i]=d;dmin=Math.min(dmin,Math.abs(d));}const scaled=deltas.map(d=>(dmin/d)**2),den=scaled.reduce((a,b)=>a+b,0);let x=base[0],y=base[1],z=base[2];for(let i=0;i<n;i++){const side=sides[i];if(!side.activeResidual)continue;const r=side.ResidualField(side.SideCoordFn(u,v)),alpha=scaled[i]/den*envelope(deltas[i]);x+=r[0]*alpha;y+=r[1]*alpha;z+=r[2]*alpha;}return [x,y,z];}
  EvalJet(u,v){if(!this.#domain(u,v))throw new Error('surface parameter outside domain');const base=this.predictor.EvalJet(u,v),data=this.#data(u,v),boundaryTolerance=32*Number.EPSILON,zeros=data.filter(x=>Math.abs(x.delta)<=boundaryTolerance);if(zeros.length>=2)return {position:base.position.slice(),Su:base.Su.slice(),Sv:base.Sv.slice()};if(zeros.length===1){const {side,dd}=zeros[0];if(!side.activeResidual)return {position:base.position.slice(),Su:base.Su.slice(),Sv:base.Sv.slice()};const s=side.SideCoordFn(u,v),r=side.ResidualField(s);return {position:base.position.slice(),Su:add(base.Su,mul(r,dd[0])),Sv:add(base.Sv,mul(r,dd[1]))};}
    const dmin=Math.min(...data.map(x=>Math.abs(x.delta))),scaled=data.map(x=>(dmin/x.delta)**2),den=scaled.reduce((a,b)=>a+b,0),w=scaled.map(x=>x/den),mean=[0,1].map(axis=>data.reduce((sum,x,i)=>sum+w[i]*x.dd[axis]/x.delta,0)),position=base.position.slice(),Su=base.Su.slice(),Sv=base.Sv.slice();let p=position,du=Su,dv=Sv;
    for(let i=0;i<data.length;i++){const {side,delta,dd}=data[i];if(!side.activeResidual)continue;const s=side.SideCoordFn(u,v),ds=side.SideCoordGradientFn(u,v),r=side.ResidualField(s),rp=side.ResidualDerivativeField(s),h=envelope(delta),hp=envelopeDerivative(delta),dw=[0,1].map(axis=>2*w[i]*(mean[axis]-dd[axis]/delta)),alpha=w[i]*h,da=[dw[0]*h+w[i]*hp*dd[0],dw[1]*h+w[i]*hp*dd[1]];p=add(p,mul(r,alpha));du=add(du,add(mul(r,da[0]),mul(rp,alpha*ds[0])));dv=add(dv,add(mul(r,da[1]),mul(rp,alpha*ds[1])));}
    return {position:p,Su:du,Sv:dv};}
}

export class NumericalEdgeGeomCache{
  constructor(evalPosition,evalDerivative=null,{tolerance=1e-5,maxDepth=16,geometryVersion=0}={}){this._position=evalPosition;this._derivative=evalDerivative;this.geometryVersion=geometryVersion;const points=[{t:0,p:evalPosition(0)}],walk=(a,pa,b,pb,depth)=>{const m=(a+b)/2,pm=evalPosition(m),chordMid=mul(add(pa,pb),.5),error=len(sub(pm,chordMid)),scale=Math.max(1,len(sub(pb,pa)));if(depth<maxDepth&&error>tolerance*scale){walk(a,pa,m,pm,depth+1);walk(m,pm,b,pb,depth+1);}else points.push({t:b,p:pb});};walk(0,points[0].p,1,evalPosition(1),0);this.points=points;this.adaptiveArcLengthTable=[];let total=0;for(let i=0;i<points.length;i++){if(i)total+=len(sub(points[i].p,points[i-1].p));this.adaptiveArcLengthTable.push({t:points[i].t,length:total});}this.totalLength=total;for(const row of this.adaptiveArcLengthTable)row.s=total?row.length/total:0;}
  #parameter(s){if(!this.totalLength)return 0;const target=Math.max(0,Math.min(1,+s||0))*this.totalLength,table=this.adaptiveArcLengthTable;let i=1;while(i<table.length&&table[i].length<target)i++;if(i>=table.length)return 1;const a=table[i-1],b=table[i],u=b.length===a.length?0:(target-a.length)/(b.length-a.length);return a.t+(b.t-a.t)*u;}
  ArcAtParameter(t){t=Math.max(0,Math.min(1,+t||0));const table=this.adaptiveArcLengthTable;let i=1;while(i<table.length&&table[i].t<t)i++;if(i>=table.length)return 1;const a=table[i-1],b=table[i],u=b.t===a.t?0:(t-a.t)/(b.t-a.t),lengthAt=a.length+(b.length-a.length)*u;return this.totalLength?lengthAt/this.totalLength:0;}
  EvalPosition(s){return this._position(this.#parameter(s));}
  EvalTangent(s){const t=this.#parameter(s);if(this._derivative){const d=this._derivative(t);if(len(d)>1e-12)return unit(d);}const h=1e-5,a=Math.max(0,t-h),b=Math.min(1,t+h);return unit(sub(this._position(b),this._position(a)));}
}
class SampledVectorField{
  constructor(fn,{samples=65}={}){this.values=Array.from({length:samples},(_,i)=>fn(i/(samples-1)));}
  Eval(s){const x=Math.max(0,Math.min(1,+s||0))*(this.values.length-1),i=Math.min(this.values.length-2,Math.floor(x)),u=x-i;return lerp(this.values[i],this.values[i+1],u);}
  Derivative(s){const n=this.values.length-1,x=Math.max(0,Math.min(1,+s||0))*n,i=Math.min(n-1,Math.floor(x));return mul(sub(this.values[i+1],this.values[i]),n);}
}
export class VirtualSeamCache{
  constructor(parent,cut,startFan,endFan,{lowerHeight,upperHeight,geometryVersion=0,residualSamples=65}={}){this.cut=cut;this.geometryVersion=geometryVersion;this.geometry=new NumericalEdgeGeomCache(u=>parent.Eval(u,cut),u=>parent.EvalJet(u,cut,'minus').Su,{geometryVersion});this.plane=new EdgePlaneCache(this.geometry,startFan,endFan,{geometryVersion});const field=(side,height,sign)=>new SampledVectorField(u=>{const jet=parent.EvalJet(u,cut,side),normal=this.plane.EvalPlaneNormal(this.geometry.ArcAtParameter(u));return projectG1Residual(mul(jet.Sv,sign*height),normal);},{samples:residualSamples});this.residualMinus=field('minus',lowerHeight,-1);this.residualPlus=field('plus',upperHeight,1);}
}
export const unionVirtualCuts=(leftKnots=[],rightKnots=[])=>[...new Set([0,1,...leftKnots,...rightKnots].map(Number).filter(x=>Number.isFinite(x)&&x>=0&&x<=1))].sort((a,b)=>a-b);
export class NgonVirtualStripSurface{
  constructor(parent,outerCorrector,cuts,seamFans,{geometryVersion=0}={}){this.parent=parent;this.outer=outerCorrector||parent;this.geometryVersion=geometryVersion;this.cuts=Array.isArray(cuts)?unionVirtualCuts(cuts):unionVirtualCuts(cuts?.left,cuts?.right);if(this.cuts.length<2)throw new Error('N-gon chart needs strip cuts');this.strips=[];this.seams=new Map();for(let i=1;i<this.cuts.length-1;i++){const cut=this.cuts[i],fans=typeof seamFans==='function'?seamFans(cut):seamFans?.[cut]||seamFans?.[String(cut)];if(!fans?.start||!fans?.end)throw new Error(`missing endpoint fan planes for virtual seam ${cut}`);this.seams.set(cut,new VirtualSeamCache(this.outer,cut,fans.start,fans.end,{lowerHeight:cut-this.cuts[i-1],upperHeight:this.cuts[i+1]-cut,geometryVersion}));}for(let i=0;i<this.cuts.length-1;i++)this.strips.push(this.#buildStrip(i));}
  #buildStrip(index){const v0=this.cuts[index],v1=this.cuts[index+1],height=v1-v0,raw={left:[(u,v)=>u,()=>[1,0]],right:[(u,v)=>1-u,()=>[-1,0]],bottom:[(u,v)=>(v-v0)/height,()=>[0,1/height]],top:[(u,v)=>(v1-v)/height,()=>[0,-1/height]]},fields=[];for(const [id,[delta,dg]] of Object.entries(raw)){let residual=()=>[0,0,0],residualDerivative=()=>[0,0,0],activeResidual=false;if(id==='bottom'&&index>0){const seam=this.seams.get(v0);residual=s=>seam.residualPlus.Eval(s);residualDerivative=s=>seam.residualPlus.Derivative(s);activeResidual=true;}if(id==='top'&&index<this.cuts.length-2){const seam=this.seams.get(v1);residual=s=>seam.residualMinus.Eval(s);residualDerivative=s=>seam.residualMinus.Derivative(s);activeResidual=true;}fields.push(new SideField({id,delta,deltaGradient:dg,sideCoord:(u,v)=>id==='left'||id==='right'?(v-v0)/height:u,sideCoordGradient:()=>id==='left'||id==='right'?[0,1/height]:[1,0],residual,residualDerivative,activeResidual}));}const predictor={Eval:(u,v)=>this.outer.Eval(u,v),EvalJet:(u,v)=>this.outer.EvalJet(u,v,v===v1&&index<this.cuts.length-2?'minus':(v===v0&&index>0?'plus':null))};return {id:index,v0,v1,corrector:new G1Corrector(predictor,fields)};}
  LocateSubchart(u,v){if(u<0||u>1||v<0||v>1)throw new Error('surface parameter outside domain');let lo=0,hi=this.strips.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(v<=this.strips[mid].v1)hi=mid;else lo=mid+1;}return lo;}
  Eval(u,v){return this.strips[this.LocateSubchart(u,v)].corrector.Eval(u,v);}
  EvalJet(u,v,subchartId=null){const id=subchartId==null?this.LocateSubchart(u,v):subchartId,strip=this.strips[id];if(!strip||v<strip.v0-1e-12||v>strip.v1+1e-12)throw new Error('invalid N-gon subchart');return strip.corrector.EvalJet(u,v);}
  InternalSeams(){return [...this.seams.values()].map(x=>{const upper=this.cuts.indexOf(x.cut);return {cut:x.cut,geometryVersion:x.geometryVersion,subchartMinus:upper-1,subchartPlus:upper};});}
}

const jetMetrics=jet=>{const e=dot(jet.Su,jet.Su),f=dot(jet.Su,jet.Sv),g=dot(jet.Sv,jet.Sv),disc=Math.sqrt(Math.max(0,(e-g)**2+4*f*f)),hi=Math.max(0,(e+g+disc)/2),lo=Math.max(0,(e+g-disc)/2),sigmaMax=Math.sqrt(hi),sigmaMin=Math.sqrt(lo);return {sigmaMin,sigmaMax,condition:sigmaMin>0?sigmaMax/sigmaMin:Infinity};};
export class CompiledSurfaceCell{
  constructor(id,evaluator,{domain={type:'quad'},boundaryMap={},geometryVersion=1,chartVersion=1,orientationNormal=null,statuses=[],illConditionedThreshold=1e10}={}){if(typeof evaluator?.Eval!=='function'||typeof evaluator?.EvalJet!=='function')throw new Error('compiled cell needs mathematical evaluator');this.id=id;this.evaluator=evaluator;this.domain=Object.freeze({...domain});this.boundaryMap=new Map(Object.entries(boundaryMap));this.geometryVersion=geometryVersion;this.chartVersion=chartVersion;this.orientationNormal=orientationNormal&&unit(orientationNormal);this.statuses=new Set(statuses);this.warnings=new Set();this.illConditionedThreshold=illConditionedThreshold;this.minSigma=Infinity;this.maxCondition=0;}
  Eval(uv){return this.evaluator.Eval(uv[0],uv[1]);}
  LocateSubchart(uv){return typeof this.evaluator.LocateSubchart==='function'?this.evaluator.LocateSubchart(uv[0],uv[1]):0;}
  EvalJet(uv,subchartId=null){return this.evaluator.EvalJet(uv[0],uv[1],subchartId);}
  EvalNormal(uv,subchartId=null){const jet=this.EvalJet(uv,subchartId),n=unit(cross(jet.Su,jet.Sv));if(this.orientationNormal&&dot(n,this.orientationNormal)<0)return mul(n,-1);return n;}
  EvalBatch(uvs,subchartIds=null){const positions=new Float64Array(uvs.length*3),normals=new Float64Array(uvs.length*3);for(let i=0;i<uvs.length;i++){const p=this.Eval(uvs[i]),n=this.EvalNormal(uvs[i],subchartIds?.[i]??null);positions.set(p,i*3);normals.set(n,i*3);}return {positions,normals};}
  BoundaryToUV(edgeId,s){const fn=this.boundaryMap.get(String(edgeId));if(!fn)throw new Error(`unknown boundary edge ${edgeId}`);return fn(Math.max(0,Math.min(1,+s||0)));}
  InternalSeams(){return typeof this.evaluator.InternalSeams==='function'?this.evaluator.InternalSeams():[];}
  Domain(){return this.domain;}
  GeometryVersion(){return this.geometryVersion;}
  ChartVersion(){return this.chartVersion;}
  Validate({resolution=9}={}){this.minSigma=Infinity;this.maxCondition=0;let singular=false,nonfinite=false,maxSigma=0;const metrics=[];for(let j=0;j<resolution;j++)for(let i=0;i<resolution;i++){const u=i/(resolution-1),v=j/(resolution-1);if(this.domain.type==='triangle'&&u+v>1+1e-12)continue;const apexUv=this.domain.type==='triangle'?(this.domain.apexUv||[0,1]):null,apex=!!apexUv&&Math.abs(u-apexUv[0])<=1e-14&&Math.abs(v-apexUv[1])<=1e-14;let jet;try{jet=this.EvalJet([u,v]);}catch{nonfinite=true;continue;}if(![...jet.position,...jet.Su,...jet.Sv].every(Number.isFinite)){nonfinite=true;continue;}const m=jetMetrics(jet);metrics.push({m,apex});this.minSigma=Math.min(this.minSigma,m.sigmaMin);this.maxCondition=Math.max(this.maxCondition,m.condition);maxSigma=Math.max(maxSigma,m.sigmaMax);}
    const singularTolerance=Math.max(Number.MIN_VALUE,maxSigma*256*Number.EPSILON);for(const q of metrics)if(q.m.sigmaMin<=singularTolerance&&!q.apex){singular=true;break;}
    if(nonfinite||singular)this.statuses.add('ChartSingular');if(this.maxCondition>this.illConditionedThreshold&&!singular)this.warnings.add('ChartIllConditioned');for(const seam of this.InternalSeams()){for(let i=1;i<resolution-1;i++){const u=i/(resolution-1),a=this.EvalNormal([u,seam.cut],seam.subchartMinus),b=this.EvalNormal([u,seam.cut],seam.subchartPlus);if(dot(a,b)<=0){this.statuses.add('ChartFoldAtSeam');break;}}}return {status:this.statuses.size?[...this.statuses][0]:'Valid',statuses:[...this.statuses],warnings:[...this.warnings],minSigma:this.minSigma,maxCondition:this.maxCondition};}
}

export const surfaceBuilderMath={cubic,derivative,integrate,integrateScalar,smallestEigenvectorSymmetric3,transportNormal};
