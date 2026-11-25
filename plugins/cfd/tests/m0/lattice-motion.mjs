import {gridWGSL} from './fixtures.mjs';

// The native signed-distance volume stays in the material frame. A batch of
// lattice steps can therefore use the original evaluated surface at every
// midpoint without uploading new vertices or overwriting a queued phase.
export async function latticeWallMotion(gpu,f,dt,band,distance,surface=null){
  const count=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(count/128)];
  const wall=gpu.buffer('CFD lattice wall in the fixed frame',(surface?32:16)*count);
  const origin=(v)=>'vec3f('+v.join(',')+')';
  const phase=gpu.buffer('CFD lattice step and halfway rotor phase',16);
  const stepAngle=f.omega*dt;
  const advance=await gpu.kernel('CFD rigid lattice midpoint',`
    struct Phase{step:u32,pad:u32,turn:vec2f}
    @group(0) @binding(0) var<storage,read_write> phase:Phase;
    @compute @workgroup_size(1) fn main(){
      let a=(f32(phase.step)+.5)*${stepAngle};phase.turn=vec2f(cos(a),sin(a));phase.step++;
    }`);
  const move=await gpu.kernel('CFD sample moving native lattice wall',gridWGSL(f)+`
    struct Phase{step:u32,pad:u32,turn:vec2f}
    @group(0) @binding(0) var<storage,read> metric:array<f32>;
    @group(0) @binding(1) var<storage,read> phase:Phase;
    @group(0) @binding(2) var<storage,read_write> wall:array<vec4f>;
    ${surface?`struct Tensor{diag:vec4f,off:vec4f}
      @group(0) @binding(3) var<storage,read> skin:array<Tensor>;
      const SD=vec3i(${surface.dims});
      fn surfaceAt(p:vec3f)->mat3x3f{
        let v=(p-vec3f(${surface.origin}))/${surface.spacing};var d=vec3f(0);var s=vec3f(0);
        if(all(v>=vec3f(0))&&all(v<vec3f(SD-1))){let base=vec3i(floor(v));let t=fract(v);
          for(var k=0;k<8;k++){let a=vec3i(k&1,(k>>1)&1,k>>2);let q=base+a;let w=select(1.-t,t,a==vec3i(1));
            let value=skin[u32(q.x+SD.x*(q.y+SD.y*q.z))];let wij=w.x*w.y*w.z;d+=wij*value.diag.xyz;s+=wij*value.off.xyz;}}
        return mat3x3f(vec3f(d.x,s.x,s.y),vec3f(s.x,d.y,s.z),vec3f(s.y,s.z,d.z));
      }`:''}
    const BAND=vec3i(${band.dims});const PITCH=f32(${band.h});const H=f32(${f.h});
    fn distanceToWall(x:vec3f)->f32{
      let r=(x-${origin(band.origin)})/PITCH;
      if(any(r<vec3f(0))||any(r>vec3f(BAND-1))){return 12.*PITCH/H;}
      let p=vec3i(floor(r));let t=fract(r);var d=0.;
      for(var k=0;k<8;k++){let s=vec3i(k&1,(k>>1)&1,k>>2);let q=min(p+s,BAND-1);
        let w=select(1.-t,t,s==vec3i(1));d+=w.x*w.y*w.z*metric[u32(q.x+BAND.x*(q.y+BAND.y*q.z))];}
      return -d*PITCH/H;
    }
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=CELLS){return;}let x=${origin(f.origin)}+(vec3f(point(i))+.5)*H;
      let turn=phase.turn;let material=vec3f(x.x,turn.x*x.y+turn.y*x.z,turn.x*x.z-turn.y*x.y);
      let d=distanceToWall(material);
      ${surface?`let R=mat3x3f(vec3f(1,0,0),vec3f(0,turn.x,turn.y),vec3f(0,-turn.y,turn.x));
        let tensor=R*surfaceAt(material)*transpose(R);
        wall[2u*i]=vec4f(tensor[0].x,tensor[1].y,tensor[2].z,d);
        wall[2u*i+1u]=vec4f(tensor[0].y,tensor[0].z,tensor[1].z,0.);`:
        `let velocity=vec2f(-x.z,x.y)*${stepAngle/f.h};wall[i]=vec4f(d,velocity,1.-smoothstep(-.7,.7,d));`}
    }`);
  const turn=gpu.bind(advance,[phase]),geometry=gpu.bind(move,[distance,phase,wall,...surface?[surface.table]:[]]);
  const pose=e=>{gpu.dispatch(e,advance,turn,[1]);gpu.dispatch(e,move,geometry,grid);};
  return {wall,encode:f.rotor?pose:null,update(){
    if(!f.rotor){const e=gpu.device.createCommandEncoder();pose(e);gpu.device.queue.submit([e.finish()]);}
  }};
}
