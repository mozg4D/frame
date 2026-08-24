import {handleBooleanWorkerMessage} from './frame-boolean-worker-core-r2-js.js?v=production-6-js-r2';

self.onmessage=async event=>{
  const out=await handleBooleanWorkerMessage(event.data||{});
  if(!out)return;
  self.postMessage(out.message,out.transfer);
};
