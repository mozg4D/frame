import vm from 'node:vm';

// Transport and permission tests stream arbitrary bytes. The browser tests cover actual HASH records.
export function installProjectFileFixture(context, source) {
  const index={version:'test document',records:new Map(),owners:[]};
  context.createFrameFileIndex=()=>({read:async()=>index,written:async()=>index,record:async()=>{}});
  context.frameCompareFileIndexes=()=>[];
  context.window.addEventListener=()=>{};
  context.document.addEventListener=()=>{};
  context.$??=()=>({hidden:true});
  context.setInterval=()=>1;
  context.clearInterval=()=>{};
  const a=source.indexOf('// The open project and its external changes');
  const b=source.indexOf('function frameHostFileHandle(',a);
  vm.runInContext(source.slice(a,b),context);
}
