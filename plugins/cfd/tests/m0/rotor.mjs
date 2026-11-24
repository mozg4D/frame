import {stations,eppler63} from './rotor-sections.mjs';

const radius=.127, intervals=256;
export function bladeStation(fraction){
  let upper=1;
  while(upper<stations.length-1&&stations[upper][0]<fraction)upper++;
  const a=stations[upper-1],b=stations[upper],u=Math.max(0,Math.min(1,(fraction-a[0])/(b[0]-a[0])));
  const at=j=>a[j]+u*(b[j]-a[j]);
  return {chord:radius*at(1),sweep:radius*at(2),rake:radius*at(3),twist:at(4)*Math.PI/180,thickness:at(5),
    blend:Math.max(0,Math.min(1,(fraction-.22)/(.732-.22)))};
}

function sectionOrdinates(i){
  const x=(1-Math.cos(Math.PI*i/(eppler63.length-1)))/2;
  const camber=x<.4?.04*(.8*x-x*x)/.16:.04*(.2+.8*x-x*x)/.36;
  const half=5*(.2969*Math.sqrt(x)-.126*x-.3516*x*x+.2843*x**3-.1036*x**4);
  return [x,...eppler63[i],camber,half];
}
export function rotorTable(){
  const values=[];
  for(let i=0;i<=intervals;i++){
    const s=bladeStation(i/intervals);
    values.push(s.chord,s.sweep,s.rake,s.twist,s.thickness,s.blend,0,0);
  }
  for(let i=0;i<eppler63.length;i++){
    values.push(...sectionOrdinates(i).slice(1));
  }
  return new Float32Array(values);
}

export function rotorTriangles(){
  const vertices=[],indices=[],samples=eppler63.length;
  const fractions=[.08,...stations.map(s=>s[0]).filter(r=>r>.08)];
  for(const blade of [-1,1]){
    const base=vertices.length/3;
    const vid=(row,side,k)=>base+(2*row+side)*samples+k;
    const quad=(a,b,c,d)=>indices.push(a,b,c,a,c,d);
    for(let row=0;row<fractions.length;row++){
      const r=fractions[row],s=bladeStation(r),cs=Math.cos(s.twist),sn=Math.sin(s.twist);
      for(let side=0;side<2;side++)for(let k=0;k<samples;k++){
        const [x,ec,eh,nc,nh]=sectionOrdinates(k);
        const mean=ec+s.blend*(nc-ec),half=eh+s.blend*(nh-eh);
        const ordinate=s.chord*(mean+(2*side-1)*s.thickness*half);
        vertices.push(s.rake-s.chord*x*sn+ordinate*cs,blade*r*radius,blade*(s.sweep-s.chord*x*cs-ordinate*sn));
        if(row&&k){const a=vid(row-1,side,k-1),b=vid(row-1,side,k),c=vid(row,side,k),d=vid(row,side,k-1);
          if(side)quad(a,b,c,d);else quad(d,c,b,a);}
      }
      if(!row||row===fractions.length-1){
        for(let k=1;k<samples;k++)quad(vid(row,0,k-1),vid(row,1,k-1),vid(row,1,k),vid(row,0,k));
      }
    }
  }
  return {vertices:Float32Array.from(vertices),indices:Uint32Array.from(indices)};
}

export const rotorDistanceWGSL=`
  @group(0) @binding(3) var<storage,read> sections:array<vec4f>;
  fn distanceToBody(p:vec3f,phase:vec2f)->f32{
    let signedRadius=dot(p.yz,phase);let r=abs(signedRadius);
    let tangent=select(-1.,1.,signedRadius>=0.)*dot(p.yz,vec2f(-phase.y,phase.x));
    // A lower distance bound makes all points outside the support inexpensive.
    let bound=max(max(abs(p.x)-.024,abs(tangent)-.035),r-.127);
    if(bound>.012){return bound;}
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
  }`;
