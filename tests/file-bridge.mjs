import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,symlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {createFileBridge} from '../tools/file-bridge.mjs';
export async function fileBridgeCPUChecks(){
const source=await readFile(new URL('../index.html',import.meta.url),'utf8'),dir=await mkdtemp(join(tmpdir(),'frame-files-')),path=join(dir,'project.hash'),other=join(dir,'copy.hash'),outside=join(dir,'denied.hash'),bridge=await createFileBridge([path,other]);
const started=performance.now();let checks=0;const unavailable=[];
function check(value,message){assert.ok(value,message);checks++;}
try{
 await writeFile(path,'original');
 await assert.rejects(bridge.call({op:'beginWrite',path:outside}),/not authorized/);checks++;
 let transfer=await bridge.call({op:'beginWrite',path});await bridge.call({op:'write',id:transfer.id,base64:Buffer.from('aborted').toString('base64')});await bridge.call({op:'abort',id:transfer.id});check((await readFile(path,'utf8'))==='original','abort preserves previous file');
 const bytes=new Uint8Array(17*1024*1024+123);for(let i=0;i<bytes.length;i++)bytes[i]=(i*31)%251;
 const context=vm.createContext({Blob,File,Uint8Array,atob,btoa,Error,window:{__frameFileHost:a=>bridge.call(a)},sceneFileName:'scene.hash',sceneFileHandle:null,lastSavedFormat:'hash',rememberSceneFile:async()=>{}});
 vm.runInContext(source.slice(source.indexOf('function frameHostFileHandle('),source.indexOf('let frameNativeFileTask=')),context);
 context.path=path;context.other=other;context.bytes=bytes;
 // Execute the actual shipped browser handle against the actual disk host.
 await vm.runInContext("(async()=>{const handle=frameHostFileHandle(path),w=await handle.createWritable();await w.write(bytes.subarray(0,23));await w.write(new Blob([bytes.subarray(23)]));await w.close();globalThis.receipt=handle.lastReceipt;globalThis.opened=new Uint8Array(await (await handle.getFile()).arrayBuffer());})()",context);
 check(Buffer.compare(await readFile(path),Buffer.from(bytes))===0,'large streaming write matches');check(Buffer.compare(Buffer.from(context.opened),Buffer.from(bytes))===0,'large chunked read matches');check(context.receipt.bytes===bytes.length,'receipt size');check(context.receipt.sha256===createHash('sha256').update(bytes).digest('hex'),'receipt digest');
 context.window.frameEngine={saveHash:async w=>{await w.write(bytes);await w.close();}};
 await vm.runInContext('frameSaveBoundFile(other)',context);check(context.sceneFileHandle.frameHostPath===other,'Save As binds successful target');await vm.runInContext('frameSaveBoundFile()',context);check((await readFile(other)).length===bytes.length,'repeat Save uses binding');
 context.window.frameEngine.saveHash=async w=>{await w.write(new Uint8Array([1,2]));throw Error('serializer failed');};await assert.rejects(vm.runInContext('frameSaveBoundFile(path)',context),/serializer failed/);checks++;check(context.sceneFileHandle.frameHostPath===other,'failed Save As retains binding');check((await readFile(path)).length===bytes.length,'failed serialization keeps old file');
 transfer=await bridge.call({op:'beginWrite',path});await assert.rejects(bridge.call({op:'beginWrite',path}),/Another write/);checks++;await writeFile(path,'external edit');await assert.rejects(bridge.call({op:'finish',id:transfer.id}),/Target changed/);checks++;await bridge.call({op:'abort',id:transfer.id});check(await readFile(path,'utf8')==='external edit','external edits survive a pending save');
 await rm(path);try{await symlink(other,path);await assert.rejects(bridge.call({op:'beginRead',path}),/symbolic link/);checks++;}catch(error){if(process.platform==='win32'&&['EPERM','EACCES'].includes(error.code))unavailable.push('Symbolic link denial: Windows account lacks symlink privilege');else throw error;}
 await bridge.close();await assert.rejects(bridge.call({op:'beginRead',path}),/closed/);checks++;
 check((await readdir(dir)).every(p=>!p.startsWith('.frame-')),'temporary files cleaned');
 check(source.includes("['scene.new','scene.open','scene.merge','scene.share','scene.export','scene.save','scene.saveAs']"),'save enters native document settlement');
 check(source.includes("['scene.share','scene.export','scene.save','scene.saveAs'].includes(name)?'save'"),'save joins editor flush barrier');
 const ms=performance.now()-started;check(ms<20000,'completed large roundtrip and failure suite under 20s');return {pass:true,checks,unavailable,bytes:bytes.length,elapsedMs:ms};
}finally{await bridge.close();await rm(dir,{recursive:true,force:true});}

}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await fileBridgeCPUChecks()));
