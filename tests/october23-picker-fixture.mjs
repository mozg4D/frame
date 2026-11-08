import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {performance} from 'node:perf_hooks';
// Execute the actual browser picker fixture rather than a second implementation.
const source=await readFile(process.argv[2]||new URL('./october23-feedback.mjs',import.meta.url),'utf8');
const start=source.indexOf('()=>{window.__exported=[];'),end=source.indexOf('});',source.indexOf('getFile:',start));
assert.ok(start>=0&&end>start,'Find the shared October 23 export picker fixture');
const context={Blob,File,DOMException};context.window=context;
runInNewContext('('+source.slice(start,end+1)+')()',context);
const began=performance.now(),checks=[];
for(const format of ['hash','stl','glb','ply','vtk','3mf']){
 const name='streamed.'+format,handle=await context.showSaveFilePicker({suggestedName:name}),writer=await handle.createWritable();
 const first=new Uint8Array([1,2,3]);
 await writer.write(first);first.fill(255); // A completed write owns a snapshot of its input bytes.
 await writer.write(new Blob([new Uint8Array([4,5])]));
 await writer.write(new Uint8Array([6,7,8]).buffer);
 assert.equal(context.__exported.length,checks.length,'No completed save is recorded before close');
 await writer.close();const file=await handle.getFile();
 assert.equal(file.name,name);assert.deepEqual([...new Uint8Array(await file.arrayBuffer())],[1,2,3,4,5,6,7,8]);
 assert.equal(context.__exported.at(-1).name,name);assert.equal(context.__exported.at(-1).bytes,8);
 // Saving to the same handle replaces the file, it does not append to a previous write session.
 const replacement=await handle.createWritable();await replacement.write(new Uint8Array([9]));await replacement.close();
 assert.deepEqual([...new Uint8Array(await (await handle.getFile()).arrayBuffer())],[9]);
 checks.push(format);context.__exported.pop();
}
const before=context.__exported.length;context.__pickerCancel=true;
await assert.rejects(context.showSaveFilePicker({suggestedName:'cancelled.3mf'}),error=>error.name==='AbortError');
assert.equal(context.__exported.length,before);
const ms=performance.now()-began;assert.ok(ms<1000,'Completed picker fixture regression exceeds 1000 ms');
console.log(JSON.stringify({pass:true,checks:['All six formats retain ordered write chunks and snapshot bytes','Completed files are registered only after close','Repeated createWritable replaces prior bytes','Cancelled picker does not register a file'],formats:checks,ms,budgetMs:1000},null,2));
