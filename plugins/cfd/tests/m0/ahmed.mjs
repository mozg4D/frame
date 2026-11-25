// Authored Frame polygon mesh in millimetres. Sections follow the circular
// nose arcs and the straight slant of the 25-degree wind-tunnel fixture.
// The solver receives only Frame's evaluated surface via its scene capture.
export function ahmedMesh(){
  const vertices=[],indices=[],rings=[];
  const ring=(x,bottom,top,halfWidth)=>rings.push([[x,bottom,-halfWidth],[x,top,-halfWidth],[x,top,halfWidth],[x,bottom,halfWidth]]);
  for(let i=0;i<=36;i++){
    const a=i*Math.PI/72,offset=100*Math.sin(a);
    ring(100*(1-Math.cos(a)),150-offset,238+offset,94.5+offset);
  }
  const angle=25*Math.PI/180;
  ring(1044-222*Math.cos(angle),50,338,194.5);ring(1044,50,338-222*Math.sin(angle),194.5);
  for(const row of rings)for(const p of row)vertices.push(p[0]-522,p[1],p[2]);
  const quad=(a,b,c,d)=>indices.push(a,b,c,a,c,d);
  quad(3,2,1,0);
  for(let i=1;i<rings.length;i++)for(let k=0;k<4;k++){
    const j=(k+1)%4,l=4*(i-1),r=4*i;quad(l+k,l+j,r+j,r+k);
  }
  const tail=4*(rings.length-1);quad(tail,tail+1,tail+2,tail+3);
  return {name:'Ahmed body 25 degrees',vertices,indices};
}

// Aultman and Duan, Fluids 10, 35 (2025), sections 2.3 and 3.1.
// Their inlet run-up and symmetry boundaries approximate the measured open jet.
// Keep this wind tunnel separate from the body-only drag experiment.
export function wakeTunnel(f){
  return {...f,origin:[-2,0,-.9375],domainEnd:[5,1.375,.9375],
    pressureOpen:[false,true,false,false,false,false],tunnelSymmetry:true};
}
