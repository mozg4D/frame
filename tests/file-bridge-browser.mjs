import {fileURLToPath} from 'node:url';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {attachFileBridge} from '../tools/file-bridge.mjs';
import {launch,ready} from '../tools/browser.mjs';
export async function fileBridgeBrowserChecks(page){
 const dir=await mkdtemp(join(tmpdir(),'frame-native-files-')),path=join(dir,'original.hash'),copy=join(dir,'copy.hash'),bridge=await attachFileBridge(page,[path,copy]),checks=[],timings=[];
 const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]),check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
 try{
  await call('scene.new');await call('scene.create',{type:'cube',name:'File bridge fixture'});
  let start=performance.now(),saved=await call('scene.saveAs',{path});timings.push({name:'native save',ms:performance.now()-start});const bytes=await readFile(path);check('Save As binds path and SHA receipt',saved.bound&&saved.path===path&&saved.bytes===bytes.length&&saved.sha256===createHash('sha256').update(bytes).digest('hex'));
  await call('scene.save');check('Repeat save retains bound target',(await call('scene.file')).path===path);
  await call('scene.new');check('New clears binding',!(await call('scene.file')).bound);
  start=performance.now();const opened=await call('scene.open',{path});timings.push({name:'native open',ms:performance.now()-start});check('Open restores native scene and binds path',opened.file.path===path&&opened.objects.some(n=>n.name==='File bridge fixture'));
  await call('scene.saveAs',{path:copy});await page.evaluate(()=>{const save=saveSceneFile;window.__bridgeNativeSaveDone=false;saveSceneFile=async(...args)=>{try{return await save(...args);}finally{saveSceneFile=save;window.__bridgeNativeSaveDone=true;}};});start=performance.now();await page.locator('#btnSave').click();await page.waitForFunction(()=>window.__bridgeNativeSaveDone);timings.push({name:'native button save completed',ms:performance.now()-start});await call('scene.inspect');check('Native Save shares bridge handle',(await call('scene.file')).path===copy);
  let denied=false;try{await call('scene.saveAs',{path:join(dir,'denied.hash')});}catch{denied=true;}check('Unauthorized Save As rejected without replacing binding',denied&&(await call('scene.file')).path===copy);
  check('Recents contain host descriptor',await page.evaluate(()=>recentSceneFiles.get('copy.hash')?.frameHostPath.endsWith('copy.hash')));
  await writeFile(path,'invalid HASH');let failed=false;try{await call('scene.open',{path});}catch{failed=true;}check('Failed replacement import leaves no stale Save binding',failed&&!(await call('scene.file')).bound);
  check('Native operations finish within 10 seconds',timings.every(t=>t.ms<10000));return {pass:true,checks,timings};
 }finally{await bridge.close();await rm(dir,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const s=await launch({headless:process.argv.includes('--headless')});try{await ready(s.page);console.log(JSON.stringify(await fileBridgeBrowserChecks(s.page)));}finally{await s.close();}}
