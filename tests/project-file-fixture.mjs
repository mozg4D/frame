import vm from 'node:vm';

// Transport and permission tests stream arbitrary bytes. The browser tests cover actual HASH records.
export function installProjectFileFixture(context, source) {
  const index={version:'test document',records:new Map(),owners:[]};
  context.createFrameFileIndex=()=>({read:async()=>index,written:async()=>index,record:async()=>{}});
  context.frameCompareFileIndexes=()=>[];
  context.FrameFileSources={boundFolder:()=>null,findProjectFolder:async()=>null,projectPaths:async()=>[],prepareProject:async()=>{}};
  context.window.addEventListener=()=>{};
  context.document.addEventListener=()=>{};
  context.$??=()=>({hidden:true});
  context.setInterval=()=>1;
  context.clearInterval=()=>{};
  const a=source.indexOf('// The open project and its external changes');
  const b=source.indexOf('function frameHostFileHandle(',a);
  vm.runInContext(source.slice(a,b),context);
}

// Run inside the test page. Repeated saves must be able to read the bytes previously written.
export async function installTestSavePicker(){
  const directory=await navigator.storage.getDirectory();
  window.__saves=[];window.__filePickers=[];window.__cancelSave=false;
  window.showSaveFilePicker=async options=>{
    __filePickers.push(options);if(__cancelSave)throw new DOMException('Cancelled','AbortError');
    const handle=await directory.getFileHandle(options.suggestedName,{create:true}),create=handle.createWritable.bind(handle);
    handle.createWritable=async settings=>{
      const stream=await create(settings),close=stream.close.bind(stream),record={name:handle.name,types:options.types};
      __saves.push(record);
      stream.close=async()=>{await close();record.bytes=new Uint8Array(await (await handle.getFile()).arrayBuffer());record.closed=true;};
      return stream;
    };
    return handle;
  };
}
