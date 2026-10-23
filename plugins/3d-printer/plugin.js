// Frame r248 printer volume and face-angle warning, ported to the shared native GPU.
// Slicing and machine output remain separate from this viewport visualization.
export async function activate(context) {
  if (context.version !== 1) throw Error('Unsupported Frame plugin API');
  const corners=[[-500,0,-500],[500,0,-500],[500,0,500],[-500,0,500],[-500,1000,-500],[500,1000,-500],[500,1000,500],[-500,1000,500]],edges=[];
  for(let i=0;i<4;i++)edges.push(...corners[i],...corners[(i+1)%4],...corners[i+4],...corners[(i+1)%4+4],...corners[i],...corners[i+4]);
  await context.viewport.register({
    bounds:{min:[-500,0,-500],max:[500,1000,500]},lines:new Float32Array(edges),
    color:[0x72/255,0xb9/255,0xb1/255,.65],selectedColor:[1,0xcf/255,0x70/255,.65],
    settings:params=>[Math.sin(Math.max(0,Math.min(90,params['Overhang angle']))*Math.PI/180),0,0,0],
    shader:`fn pluginSurface(local:vec3f,normal:vec3f,build:vec3f,settings:vec4f)->vec4f{
      if(local.y<=0.001||local.y>1000.||abs(local.x)>500.||abs(local.z)>500.){discard;}
      if(-dot(normal,build)<=settings.x+0.000001){discard;}
      return vec4f(1.,.12,.12,1.);
    }`
  });
}
