import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export function checkCageUniformColors(html){
 const start=html.indexOf('    const splineUniformValues='),end=html.indexOf('    function drawSplineDisplays(',start);
 assert(start>=0&&end>start);const colors=[],[write,tangent]=Function('renderer',html.slice(start,end)+';return [writeSplineDisplayFrame,splineTangentColor];')({device:{queue:{writeBuffer:(_,offset,data)=>colors.push(Array.from(data.slice(16)))}}});
 const frame=new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),buffer={},tint=[.35,.28,.21,1];
 write(buffer,frame);write(buffer,frame,tint);write(buffer,frame,[...tint]);write(buffer,frame);write({},frame,tangent);
 assert.deepEqual(colors,[[.18095,.3542,.4158,1],tint,[.18095,.3542,.4158,1],[.435,.51,.565,1]].map(c=>c.map(Math.fround)));
 return true;
}
export async function splinePaletteCPUChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[];
 const check=(name,pass)=>{assert.ok(pass,name);checks.push({name,pass:true});};
 const start=html.indexOf('    function splineWireHighlightWGSL('),end=html.indexOf('    function splineWireSlot(',start);assert.ok(start>=0&&end>start);const highlight=Function('return ('+html.slice(start,end)+')')(),shader=highlight('paletteEdges');
 check('Cage uniforms update tint independently of the transform and retain the editing palette',checkCageUniformColors(html));
 check('Native surface, transparent and fallback line shaders share the same cyan',!html.includes('.1645,.322,.378')&&shader.includes('vec3f(.18095,.3542,.4158)')&&html.split('splineWireHighlightWGSL("splineEdges")').length-1===2&&html.includes('splineWireHighlightWGSL("splineWireEdges")')&&html.includes('pack4x8unorm(vec4f(.18095,.3542,.4158,1))'));
 const old=[.1645,.322,.378],next=[.18095,.3542,.4158],y=v=>v[0]*.2126+v[1]*.7152+v[2]*.0722;
 check('Cage RGB luminance increased by ten percent',y(next)/y(old)>1.099&&y(next)/y(old)<1.101&&next[0]<next[1]&&next[1]<next[2]);
 check('Selected and hovered edges keep their distinct bright green colors',html.includes('vec4f(.396,.929,.525,1)')&&html.includes('vec4f(.541,1,.671,1)')&&shader.includes('vec3f(.396,.929,.525)')&&shader.includes('vec3f(.541,1,.671)')&&shader.includes('(state&1u)!=0u')&&shader.includes('(state&2u)!=0u'));
 check('Point colors, tangent handles and shading icons remain unchanged',html.includes('vec4f(.659,.78,.863,1),vec4f(.349,.847,1,1)')&&html.split('#5ab1cf').length-1===4);
 return {pass:true,checks};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await splinePaletteCPUChecks(),null,2));
