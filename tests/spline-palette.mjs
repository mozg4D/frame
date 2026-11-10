import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export async function splinePaletteCPUChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[];
 const check=(name,pass)=>{assert.ok(pass,name);checks.push({name,pass:true});};
 check('Original and replica cages share subdued cyan',html.split('values.set([.282,.555,.65,1],16)').length-1===2&&!html.includes('values.set([.353,.694,.812,1],16)'));
 const old=[.353,.694,.812],next=[.282,.555,.65],y=v=>v[0]*.2126+v[1]*.7152+v[2]*.0722;
 check('Cage RGB luminance reduced by approximately twenty percent',y(next)/y(old)>.79&&y(next)/y(old)<.81&&next[0]<next[1]&&next[1]<next[2]);
 check('Selected and hovered edges keep their distinct bright green colors',html.includes('values.set([.396,.929,.525,1],16)')&&html.includes('values.set([.541,1,.671,1],16)'));
 check('Point colors, tangent handles and shading icons remain unchanged',html.includes('vec4f(.659,.78,.863,1),vec4f(.349,.847,1,1)')&&html.includes('values.set([.435,.51,.565,1],16)')&&html.split('#5ab1cf').length-1===4);
 return {pass:true,checks};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await splinePaletteCPUChecks(),null,2));