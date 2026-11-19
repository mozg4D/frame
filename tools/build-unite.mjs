// Rebuild the self-contained worker's CPU kernels with Emscripten.
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'frame-unite-'));
try{
  const output=join(dir,'unite.wasm');
  const api=['malloc','free','prepare','begin_surface','end_surface','surface_counts','surface_vertices','surface_indices','contour_slab','resize_surface','finish_surface',
    'begin_volume','end_volume','volume_slab','begin_filter','filter_tile','accept_filter_tile','finish_filter','contour_volume','volume_bytes','refine_contour','perimeter_counts','exact_perimeters','faceted_perimeters'];
  const result=spawnSync(process.env.EMXX||'em++',['-O3','-std=c++17','-fno-exceptions','-ffp-contract=off','--no-entry',
    '-sSTANDALONE_WASM=1','-sFILESYSTEM=0','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=16777216',
    '-sEXPORTED_FUNCTIONS='+JSON.stringify(api.map(n=>'_'+n)),fileURLToPath(new URL('unite-kernel.cpp',import.meta.url)),'-o',output],{stdio:'inherit'});
  if(result.status!==0)throw result.error||Error('Unite kernel build failed');
  const file=new URL('../index.html',import.meta.url),html=await readFile(file,'utf8'),pattern=/(<script id="frame-unite-wasm" type="application\/octet-stream">)[^<]*(<\/script>)/;
  if(!pattern.test(html))throw Error('Missing Unite module slot');
  await writeFile(file,html.replace(pattern,'$1'+(await readFile(output)).toString('base64')+'$2'));
}finally{await rm(dir,{recursive:true,force:true});}
