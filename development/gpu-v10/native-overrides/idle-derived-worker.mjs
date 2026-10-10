/** Credit-driven background worker. No autonomous busy loop survives foreground input. */
import {buildTopologyWork,topologyTransfer} from './topology-islands.mjs';
import {authoringTagEqual} from './authoring-mesh.mjs';
export function installIdleDerivedWorker(port){
  let job=null;
  const reply=(data,transfer=[])=>port.postMessage(data,transfer);
  port.onmessage=({data:m})=>{
    try{
      if(m.type==='cancel'){if(job&&authoringTagEqual(job.tag,m.tag)){job.work?.return?.();job=null;}return;}
      if(m.type==='init'){
        job?.work?.return?.();
        if(!m.tag||!Number.isInteger(m.positionLength)||m.positionLength<0||m.positionLength%3||!Number.isInteger(m.indexLength)||m.indexLength<0||m.indexLength%3||!m.indexLength&&m.positionLength%9)throw Error('Invalid idle snapshot shape');
        const C=m.precision==='f64'?Float64Array:m.precision==='f32'?Float32Array:null;if(!C)throw Error('Unsupported authoring precision');
        job={tag:m.tag,positions:new C(m.positionLength),indices:m.indexLength?new Uint32Array(m.indexLength):null,positionOffset:0,indexOffset:0,work:null};
        reply({type:'initialized',tag:job.tag});return;
      }
      if(!job||!authoringTagEqual(job.tag,m.tag))return;
      if(m.type==='snapshot'){
        const target=m.field==='positions'?job.positions:m.field==='indices'?job.indices:null,key=m.field==='positions'?'positionOffset':'indexOffset';
        const chunks=m.chunks??[m.values];if(!target||!Array.isArray(chunks)||!chunks.length||chunks.length>16||m.offset!==job[key])throw Error('Invalid bounded private snapshot batch');
        for(const values of chunks){if(!(values instanceof target.constructor)||!values.length||values.length>16384||job[key]+values.length>target.length)throw Error('Invalid bounded private snapshot chunk');target.set(values,job[key]);job[key]+=values.length;}
        reply({type:'captured',tag:job.tag,field:m.field,offset:job[key]});return;
      }
      if(m.type==='step'){
        if(!Number.isFinite(m.budgetMs)||m.budgetMs<=0||m.budgetMs>3)throw Error('Invalid idle work credit');
        if(job.positionOffset!==job.positions.length||job.indexOffset!==(job.indices?.length??0))throw Error('Incomplete private authoring snapshot');
        job.work??=buildTopologyWork({positions:job.positions,indices:job.indices},{batch:256,packedTables:true});
        const start=performance.now();let units=0,result;
        do{result=job.work.next();units++;}while(!result.done&&performance.now()-start<m.budgetMs&&units<64);
        if(result.done){const tag=job.tag,graph=result.value;job=null;reply({type:'ready',tag,graph,workMs:performance.now()-start},topologyTransfer(graph));}
        else reply({type:'progress',tag:job.tag,workMs:performance.now()-start,units});
      }
    }catch(e){const tag=job?.tag??m.tag;job?.work?.return?.();job=null;reply({type:'error',tag,message:e.message,name:e.name});}
  };
  return ()=>{job?.work?.return?.();job=null;port.onmessage=null;};
}
if(typeof self!=='undefined'&&typeof WorkerGlobalScope!=='undefined'&&self instanceof WorkerGlobalScope)installIdleDerivedWorker(self);
