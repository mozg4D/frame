import {stations,eppler63} from './rotor-sections.mjs';

const radius=.127, intervals=256;
// Chord (millimetres) and chord-line angle (radians) of the UIUC Volume 1
// specimen at 0.15R through 1.00R in increments of 0.05R.
// https://m-selig.ae.illinois.edu/props/volume-1/data/apce_10x7_geom.txt
const measuredChordMm=[17.526,19.558,22.225,24.13,25.146,25.654,25.4,24.765,23.622,22.098,20.447,18.415,16.383,14.224,12.192,10.287,7.747,5.08];
const measuredAngle=[0.66078165,0.79970986,0.771261,0.66933377,0.58712876,0.52185345,0.47158796,0.43057273,0.39479348,0.36442475,0.33789574,0.3138102,0.29216812,0.27558749,0.2555162,0.24190263,0.22200588,0.20123646];
const measuredRadii=measuredAngle.map((_,i)=>(i+3)/20);

function designStation(fraction){
  let upper=1;
  while(upper<stations.length-1&&stations[upper][0]<fraction)upper++;
  const a=stations[upper-1],b=stations[upper],u=Math.max(0,Math.min(1,(fraction-a[0])/(b[0]-a[0])));
  const at=j=>a[j]+u*(b[j]-a[j]);
  return {chord:radius*at(1),sweep:radius*at(2),rake:radius*at(3),twist:at(4)*Math.PI/180,thickness:at(5),
    blend:Math.max(0,Math.min(1,(fraction-.22)/(.732-.22)))};
}

export function bladeStation(fraction,measured=false){
  const s=designStation(fraction);
  if(!measured||fraction<=.08)return s;
  if(fraction<measuredRadii[0]){
    // Retain the manufacturer's shaft attachment. Bring its chord and
    // pitch smoothly to the first measured section outside the 0.08R hub.
    const design=designStation(measuredRadii[0]),t=(fraction-.08)/(.15-.08),w=t*t*(3-2*t);
    s.chord+=w*(.001*measuredChordMm[0]-design.chord);s.twist+=w*(measuredAngle[0]-design.twist);
  }else{
    const row=Math.min(measuredAngle.length-1,20*fraction-3),i=Math.min(measuredAngle.length-2,Math.floor(row)),t=row-i;
    s.chord=.001*((1-t)*measuredChordMm[i]+t*measuredChordMm[i+1]);
    s.twist=(1-t)*measuredAngle[i]+t*measuredAngle[i+1];
  }
  return s;
}

function sectionOrdinates(i,measured){
  const x=(1-Math.cos(Math.PI*i/(eppler63.length-1)))/2;
  const camber=x<.4?.04*(.8*x-x*x)/.16:.04*(.2+.8*x-x*x)/.36;
  const half=5*(.2969*Math.sqrt(x)-.126*x-.3516*x*x+.2843*x**3-.1036*x**4);
  // Register the profile to the measured LE--TE chord line, including
  // the published E63 ordinate offset at the leading edge.
  const datum=measured?(1-x)*eppler63[0][0]+x*eppler63.at(-1)[0]:0;
  return [x,eppler63[i][0]-datum,eppler63[i][1],camber,half];
}
export function rotorTable(measured=false){
  const values=[];
  for(let i=0;i<=intervals;i++){
    const s=bladeStation(i/intervals,measured);
    values.push(s.chord,s.sweep,s.rake,s.twist,s.thickness,s.blend,0,0);
  }
  for(let i=0;i<eppler63.length;i++){
    values.push(...sectionOrdinates(i,measured).slice(1));
  }
  return new Float32Array(values);
}

// Closed, outward-oriented polygon components. The blade roots overlap the
// annular hub outside its bore; the native solid raster unions the components.
export function rotorParts(measured=false){
  const samples=eppler63.length,fractions=[...new Set([.04,...stations.map(s=>s[0]).filter(r=>r>.04),
    ...(measured?measuredRadii:[])])].sort((a,b)=>a-b);
  function part(name){
    const vertices=[],indices=[];
    function vertex(x,y,z){vertices.push(x,y,z);return vertices.length/3-1;}
    function quad(a,b,c,d){
      if(a!==b&&b!==c&&a!==c)indices.push(a,b,c);
      if(a!==c&&c!==d&&a!==d)indices.push(a,c,d);
    }
    return {name,vertices,indices,vertex,quad};
  }
  const pieces=[];
  for(const blade of [-1,1]){
    const m=part('APC blade '+(blade<0?'A':'B'));pieces.push(m);let last=null;
    for(const [row,r] of fractions.entries()){
      const s=bladeStation(r,measured),cs=Math.cos(s.twist),sn=Math.sin(s.twist),ids=[[],[]];
      for(let side=0;side<2;side++)for(let k=0;k<samples;k++){
        if(side&&(k===0||k===samples-1)){ids[side][k]=ids[0][k];continue;}
        const [x,ec,eh,nc,nh]=sectionOrdinates(k,measured),mean=ec+s.blend*(nc-ec),half=eh+s.blend*(nh-eh);
        const ordinate=s.chord*(mean+(2*side-1)*s.thickness*half);
        const tangent=s.sweep-s.chord*x*cs-ordinate*sn;
        // A finite chord at the digitized tip has to end on the measured
        // 254 mm swept cylinder. Taper the last station interval to that
        // cap while preserving the chord and pitch in its section plane.
        let span=r*radius;
        if(measured&&r>.95){
          const start=.95*radius,cap=Math.sqrt(radius*radius-tangent*tangent);
          span=start+(r-.95)/.05*(cap-start);
        }
        ids[side][k]=m.vertex(s.rake-s.chord*x*sn+ordinate*cs,blade*span,blade*tangent);
      }
      for(let k=1;k<samples;k++){
        if(last)for(let side=0;side<2;side++){
          const a=last[side][k-1],b=last[side][k],c=ids[side][k],d=ids[side][k-1];
          if(side)m.quad(a,b,c,d);else m.quad(d,c,b,a);
        }
        const a=ids[0][k-1],b=ids[1][k-1],c=ids[1][k],d=ids[0][k];
        if(row===0)m.quad(d,c,b,a);else if(row===fractions.length-1)m.quad(a,b,c,d);
      }
      last=ids;
    }
  }
  const hub=part('APC shaft hub'),rings=[],steps=96;pieces.push(hub);
  for(const x of [-.008382,.001778])for(const r of [.003175,.01016]){
    rings.push(Array.from({length:steps},(_,k)=>hub.vertex(x,r*Math.cos(2*Math.PI*k/steps),r*Math.sin(2*Math.PI*k/steps))));
  }
  const [backInner,backOuter,frontInner,frontOuter]=rings;
  for(let k=0;k<steps;k++){
    const j=(k+1)%steps;
    hub.quad(backOuter[k],backOuter[j],frontOuter[j],frontOuter[k]);hub.quad(backInner[k],frontInner[k],frontInner[j],backInner[j]);
    hub.quad(frontInner[k],frontOuter[k],frontOuter[j],frontInner[j]);hub.quad(backInner[k],backInner[j],backOuter[j],backOuter[k]);
  }
  return pieces.map(({name,vertices,indices})=>({name,vertices:Float32Array.from(vertices),indices:Uint32Array.from(indices)}));
}

export function rotorTriangles(measured=false){
  const vertices=[],indices=[];
  for(const mesh of rotorParts(measured)){
    const base=vertices.length/3;for(const v of mesh.vertices)vertices.push(v);for(const i of mesh.indices)indices.push(base+i);
  }
  return {vertices:Float32Array.from(vertices),indices:Uint32Array.from(indices)};
}

export function rotorDistanceWGSL(measured=false){return `
  @group(0) @binding(3) var<storage,read> sections:array<vec4f>;
  fn distanceToBody(p:vec3f,phase:vec2f)->f32{
    let signedRadius=dot(p.yz,phase);let span=abs(signedRadius);
    let tangent=select(-1.,1.,signedRadius>=0.)*dot(p.yz,vec2f(-phase.y,phase.x));
    // A lower distance bound makes all points outside the support inexpensive.
    let bound=max(max(abs(p.x)-.024,abs(tangent)-.035),span-.127);
    if(bound>.012){return bound;}
    ${measured?`let start=.95*.127;
      let cap=sqrt(max(0.,.127*.127-tangent*tangent));
      let r=select(span,start+(span-start)*(.127-start)/max(.00001,cap-start),span>start);`:'let r=span;'}
    let radial=clamp(r/.127,0.,1.)*${intervals}.;let j=min(u32(radial),${intervals-1}u)*2u;
    let f=radial-f32(j/2u);let section=mix(sections[j],sections[j+2u],f);
    let aux=mix(sections[j+1u],sections[j+3u],f);let chord=section.x;
    let cs=cos(section.w);let sn=sin(section.w);
    let offset=vec2f(p.x-section.z,tangent-section.y);
    let x=-dot(offset,vec2f(sn,cs))/chord;let normal=dot(offset,vec2f(cs,-sn));
    let coordinate=acos(clamp(1.-2.*x,-1.,1.))*${(eppler63.length-1)/Math.PI};
    let k=min(u32(coordinate),${eppler63.length-2}u);let first=${2*(intervals+1)}u+k;
    let ord=mix(sections[first],sections[first+1u],coordinate-f32(k));
    let mean=chord*mix(ord.x,ord.z,aux.y);
    let half=chord*aux.x*mix(ord.y,ord.w,aux.y);
    let blade=max(max(max(-x,x-1.)*chord,abs(normal-mean)-half),r-.127);
    let radialDistance=length(p.yz);
    let hub=max(radialDistance-.01016,abs(p.x+.003302)-.00508);
    return max(min(hub,blade),.003175-radialDistance);
  }`;}
