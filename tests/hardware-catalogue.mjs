import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function hardwareCatalogueChecks(page){
  const checks=[],timings=[],check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
  const measure=async(name,budget,fn)=>{const start=performance.now(),value=await fn(),ms=performance.now()-start;timings.push({name,ms,budget});check(name+' latency',ms<budget,{ms,budget});return value;};
  try{
    const reference=JSON.parse(await readFile(new URL('./hardware-length-reference.json',import.meta.url),'utf8'));
    const dimensions=JSON.parse(await readFile(new URL('./hardware-reference.json',import.meta.url),'utf8'));
    const audited=await measure('Independent commercial catalogue coverage',1500,()=>page.evaluate(reference=>{
      const K=FrameSpline.K(),rows=[];
      for(const [family,f] of Object.entries(reference.families))for(const [size,row] of Object.entries(f.rows)){
        const actual=K.catalogue('bolt',{type:f.label,size,length:20});
        if(JSON.stringify(actual.lengths)!==JSON.stringify(row.lengths))throw Error(family+' '+size+' omits or invents catalogue lengths');
        if(!row.lengths.every((v,i)=>Number.isFinite(v)&&v>0&&(!i||v>row.lengths[i-1])))throw Error('Invalid source length order');
        for(const length of row.lengths){
          if(!row.previousLengths.includes(length)&&!row.catalogue[String(length)]&&!row.supplierCatalogue?.[String(length)])throw Error('Missing source for '+family+' '+size+'x'+length);
          const options=K.catalogue('bolt',{type:f.label,size,length}),data=K.primitive('bolt',{type:f.label,size,length,'angle approximation':20}),valid=K.validateSpline(data);
          const y=Object.values(data.vertices).map(p=>p[1]),height=Math.max(...y)-Math.min(...y),expected=length+(['DIN965','DIN7991','DIN7982'].includes(family)?0:options.dimensions.h);
          if(options.length!==length||!valid.ok||Math.abs(height-expected)>1e-7)throw Error('Invalid generated length '+family+' '+size+'x'+length);
        }
        rows.push({family,type:f.label,size,min:row.lengths[0],max:row.lengths.at(-1),count:row.lengths.length});
      }
      return rows;
    },reference));
    check('Every documented diameter and all 1204 offered lengths are audited',audited.length===55&&audited.reduce((sum,row)=>sum+row.count,0)===1204,audited);
    const example=await call('scene.catalogue',{type:'bolt',params:{type:'DIN 912',size:'M6',length:60}});
    check('DIN 912 M6 x 60 has independent nominal dimensions',example.length===60&&example.dimensions.head===10&&example.dimensions.h===6&&example.dimensions.drive===5&&example.dimensions.pitch===1,example);
    await call('render.stop');await call('scene.new');
    for(const row of audited){
      const ref=dimensions.families[row.type],d=ref.rows.find(r=>r[0]===Number(row.size.replace(/^(?:M|ST)/,''))),h=d[ref.columns.indexOf('h')];
      for(const length of [row.min,row.max]){
        const n=await measure(row.type+' '+row.size+' x '+length+' completed surface',1800,()=>call('scene.create',{type:'bolt',params:{type:row.type,size:row.size,length,'angle approximation':20}}));
        const expected=length+(['DIN965','DIN7991','DIN7982'].includes(row.family)?0:h),height=n.bounds.max[1]-n.bounds.min[1];
        check(row.type+' '+row.size+' x '+length+' native surface and mounting pivot',!n.buildError&&n.mesh?.triangles>0&&Math.abs(height-expected)<.02&&n.pivot.slice(9).every(v=>Math.abs(v)<1e-8),{height,expected,triangles:n.mesh?.triangles,error:n.buildError,pivot:n.pivot});
        await call('scene.delete',{ids:[n.hash]});
      }
    }
    let n=await call('scene.create',{type:'bolt',params:{type:'DIN 912',size:'M6',length:55}});
    await page.locator('#tabAttributes').click();
    await measure('Native Attributes chooses M6 x 60',1800,async()=>{await page.locator('#attrContent [data-field="length"][data-cycle]').press('ArrowUp');await call('scene.inspect');});
    let state=await call('scene.inspect');
    check('Native length control reaches 60 mm',state.objects[0].params.length===60&&await page.locator('#attrContent [data-field="length"]').innerText()==='60 mm',state.objects[0].params);
    await call('edit.history',{action:'undo'});check('Length choice is one Undo',(await call('scene.inspect')).objects[0].params.length===55);
    await call('edit.history',{action:'redo'});check('Length Redo restores 60 mm',(await call('scene.inspect')).objects[0].params.length===60);
    const saved=await call('scene.export',{includeData:true});await call('scene.open',{name:'hardware-catalogue.hash',base64:saved.base64});
    check('M6 x 60 survives HASH and keeps the native generated surface',(await call('scene.inspect')).objects[0].params.length===60);
    const before=await call('scene.inspect');
    for(const params of [{type:'DIN 912',size:'M2',length:40},{type:'DIN 912',size:'M6',length:60.5},{type:'DIN 7982 C-H',size:'M6',length:20}]){
      let rejected=false;try{await call('scene.create',{type:'bolt',params});}catch(e){rejected=/not listed in this hardware catalogue/.test(e.message);}
      check('Unlisted combination rejects atomically '+JSON.stringify(params),rejected&&(await call('scene.inspect')).objects.length===before.objects.length);
    }
    n=(await call('scene.inspect')).objects[0];await call('view.set',{single:true,index:0,mode:'object',focus:n.hash});
    const frames=await call('diagnostics.frame',{frames:8});check('Native hardware CPU/GPU frames stay within budget',frames.timestampQueries&&frames.frames.every(f=>f.cpuMs<50&&f.gpuMs<50),frames);timings.push({name:'M6 x 60 native frames',...frames});
    await call('scene.new');return {pass:true,checks,timings};
  }catch(e){return {pass:false,checks,timings,error:e.stack};}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const s=await launch({headless:process.argv.includes('--headless')}),errors=[];
  try{
    await ready(s.page);s.page.on('pageerror',e=>errors.push(e.message));s.page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await s.page.evaluate(()=>{window.__hardwareGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__hardwareGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});
    const report=await hardwareCatalogueChecks(s.page);report.errors=errors;report.gpu=await s.page.evaluate(async()=>({adapter:(()=>{const a=frameEngine.renderer.device.adapterInfo;return a?{vendor:a.vendor,architecture:a.architecture,device:a.device,description:a.description}:null})(),validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__hardwareGPU}));
    report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');report.pass&&=!errors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length;
    await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/hardware-catalogue.json',import.meta.url),JSON.stringify(report,null,2));
    console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,error:report.error,errors,gpu:report.gpu},null,2));process.exitCode=report.pass?0:1;
  }finally{await s.close();}
}
