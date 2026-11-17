import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export async function splinePaletteCPUChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[];
 const check=(name,pass)=>{assert.ok(pass,name);checks.push({name,pass:true});};
 const start=html.indexOf('    function splineWireHighlightWGSL('),end=html.indexOf('    function splineWireSlot(',start);assert.ok(start>=0&&end>start);const highlight=Function('return ('+html.slice(start,end)+')')(),shader=highlight('paletteEdges');
 check('Original and replica cages share subdued cyan',html.split('values.set([.18095,.3542,.4158,1],16)').length-1===2&&!html.includes('values.set([.353,.694,.812,1],16)'));
 check('Native surface, transparent and fallback line shaders share the same cyan',!html.includes('.1645,.322,.378')&&shader.includes('vec3f(.18095,.3542,.4158)')&&html.split('splineWireHighlightWGSL("splineEdges")').length-1===2&&html.includes('splineWireHighlightWGSL("splineWireEdges")')&&html.includes('pack4x8unorm(vec4f(.18095,.3542,.4158,1))'));
 const old=[.1645,.322,.378],next=[.18095,.3542,.4158],y=v=>v[0]*.2126+v[1]*.7152+v[2]*.0722;
 check('Cage RGB luminance increased by ten percent',y(next)/y(old)>1.099&&y(next)/y(old)<1.101&&next[0]<next[1]&&next[1]<next[2]);
 check('Selected and hovered edges keep their distinct bright green colors',html.includes('vec4f(.396,.929,.525,1)')&&html.includes('vec4f(.541,1,.671,1)')&&shader.includes('vec3f(.396,.929,.525)')&&shader.includes('vec3f(.541,1,.671)')&&shader.includes('(state&1u)!=0u')&&shader.includes('(state&2u)!=0u'));
 check('Point colors, tangent handles and shading icons remain unchanged',html.includes('vec4f(.659,.78,.863,1),vec4f(.349,.847,1,1)')&&html.includes('values.set([.435,.51,.565,1],16)')&&html.split('#5ab1cf').length-1===4);
 return {pass:true,checks};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await splinePaletteCPUChecks(),null,2));