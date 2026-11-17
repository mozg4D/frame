// Native object-address bindings: lifecycle, remapping and persistence; no plugins.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launch,ready} from '../tools/browser.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),sourceHash=async()=>sha(await readFile(new URL('../index.html',import.meta.url)));
const report={pass:false,checks:[],errors:[],pluginScripts:[],indexSHA256:await sourceHash()};let session;
const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));console.log('PASS',name);};
const id=n=>n.toString(16).padStart(32,'0'),S=id(1),M=id(2),W=id(3);
try{
 session=await launch({headless:true});const {page}=session;await ready(page);page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(/\/plugins\/.*\.js(?:\?|$)/.test(r.url()))report.pluginScripts.push(r.url());});
 report.hardware=await page.evaluate(()=>Object.fromEntries(['vendor','description','isFallbackAdapter'].map(k=>[k,frameEngine.renderer.device.adapterInfo[k]])));
 check('Native hardware WebGPU without fallback',report.hardware.isFallbackAdapter===false&&!/swiftshader|llvmpipe|software/i.test(report.hardware.description),report.hardware);
 const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
 const get=owner=>call('authorData.get',{owner}),put=async(owner,records)=>{const s=await get(owner);return call('authorData.replace',{owner,expected:{epoch:s.epoch,revision:s.data.revision},records});};
 const job=async receipt=>{await page.waitForFunction(jobId=>!['queued','running'].includes(framePrograms.poll({jobId}).state),receipt.jobId,{timeout:10000});return call('programs.job',{jobId:receipt.jobId});};
 const finish=async receipt=>{const r=await job(receipt);assert.equal(r.state,'completed',JSON.stringify(r));return r.result;};
 const start=(owner,key)=>call('programs.start',{owner,id:key}).then(finish),invoke=(owner,key,method,args=[])=>call('programs.invoke',{owner,id:key,method,args}).then(finish);
 await call('scene.new');const root=await call('scene.create',{type:'group',name:'Root'}),part=await call('scene.create',{type:'group',name:'Part',parent:root.hash});
 const code=`export function activate(ctx){return {exports:{binding:()=>ctx.bindings.part,rename:name=>ctx.call('scene.update',{id:ctx.bindings.part.owner,name})}};}`;
 const source={id:S,revision:0,name:'Source',kind:'source',refs:[],payload:{language:'javascript',text:code}};
 const descriptor=(key,context)=>({id:key,revision:0,name:context,kind:'opaque',refs:[{kind:'record',owner:root.hash,id:S},{kind:'object',owner:part.hash}],payload:{format:'frame.scene-control',version:1,data:{source:0,context,start:'manual',bindings:{part:1}}}});
 await put(root.hash,[source,descriptor(M,'main'),descriptor(W,'worker:objects')]);
 check('Discovery describes typed object bindings',(await call('programs.describe')).descriptor.data.bindings.includes('object'));
 await start(root.hash,M);await start(root.hash,W);
 for(const key of [M,W])check((key===M?'Main':'Worker')+' receives cloned typed object address',JSON.stringify(await invoke(root.hash,key,'binding'))===JSON.stringify({kind:'object',owner:part.hash}));
 await invoke(root.hash,M,'rename',['Main']);await invoke(root.hash,W,'rename',['Worker']);
 check('Object binding addresses normal native operations',(await call('fields.read',{owner:part.hash,field:'name'})).value==='Worker');
 const duplicate=await call('scene.duplicate',{ids:[root.hash]}),copy=duplicate.objects.find(n=>n.hash!==root.hash),copied=(await get(copy.hash)).data.records,copyMain=copied.find(r=>r.id===M),copyPart=copyMain.refs[1].owner;
 check('Duplicate remaps typed source and object bindings',copyMain.refs[0].owner===copy.hash&&copyPart!==part.hash&&copied.find(r=>r.id===S).payload.text===code,{owner:copy.hash,part:copyPart});
 await start(copy.hash,M);check('Copied activation resolves copied object',(await invoke(copy.hash,M,'binding')).owner===copyPart);await invoke(copy.hash,M,'rename',['Copy']);
 check('Copied binding cannot retarget original',(await call('fields.read',{owner:part.hash,field:'name'})).value==='Worker'&&(await call('fields.read',{owner:copyPart,field:'name'})).value==='Copy');
 const saved=await call('scene.export',{includeData:true});await call('scene.open',{name:'object-bindings.hash',base64:saved.base64});await start(root.hash,M);await start(root.hash,W);
 check('HASH preserves main and Worker object addresses',(await invoke(root.hash,M,'binding')).owner===part.hash&&(await invoke(root.hash,W,'binding')).owner===part.hash);
 await call('scene.delete',{ids:[part.hash]});const missing=await call('authorData.inspect',{owner:root.hash});
 check('Deleted targets remain explicit missing-owner diagnostics',missing.references.filter(r=>r.ref.kind==='object').every(r=>r.status==='missing-owner')&&(await invoke(root.hash,M,'binding')).owner===part.hash);
 const failure=await job(await call('programs.invoke',{owner:root.hash,id:M,method:'rename',args:['Missing']}));check('Native operation rejects missing object target',failure.state==='error'&&failure.error?.code==='NOT_FOUND',failure);
 const data=(await get(root.hash)).data.records;for(const r of data)if(r.kind==='opaque'){r.revision++;r.refs[1].unresolved=true;}await put(root.hash,data);await start(root.hash,M);await start(root.hash,W);
 const unresolved=await call('authorData.inspect',{owner:root.hash});
 check('Unresolved markers survive main and Worker activation',(await invoke(root.hash,M,'binding')).unresolved===true&&(await invoke(root.hash,W,'binding')).unresolved===true&&unresolved.references.filter(r=>r.ref.kind==='object').every(r=>r.status==='unresolved-reference'));
 check('No page errors or plugin execution',report.errors.length===0&&report.pluginScripts.length===0,{errors:report.errors,pluginScripts:report.pluginScripts});
 report.pass=true;
}catch(error){report.error=error.stack||String(error);}finally{
 await session?.close();report.indexSHA256After=await sourceHash();if(report.indexSHA256After!==report.indexSHA256){report.pass=false;report.sourceDrift=true;}
 await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/scene-object-bindings-browser.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
}
