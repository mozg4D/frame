import {parentPort} from 'node:worker_threads';
import {installTopologyWorker} from '../topology-worker.mjs';
const port={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer),onmessage:null};
installTopologyWorker(port);parentPort.on('message',data=>port.onmessage?.({data}));
