export const selectionFields=['vertices','edges','faces'];
export const selectionChunkWords=8192;
export function selectionLengths(selection={}){return Object.fromEntries(selectionFields.map(key=>{const q=selection[key]||[],length=q.length??q.size;if(!Number.isSafeInteger(length)||length<0||length>0x3ffffff)throw Error('Owned bounded selection snapshot required');return[key,length*(key==='edges'?2:1)];}));}
export function* selectionChunks(selection={}){
 for(const field of selectionFields){let chunk=new Uint32Array(selectionChunkWords),used=0,start=0;
  for(const value of selection[field]||[]){const values=field==='edges'?(typeof value==='string'?value.split(':').map(Number):value):[value];if(!values||values.length!==(field==='edges'?2:1))throw Error('Raw selection element required');
   for(const id of values){if(!Number.isSafeInteger(id)||id<0||id>0xffffffff)throw Error('Unsigned raw selection ID required');chunk[used++]=id;}
   if(used===chunk.length){yield{field,start,chunk};start+=used;used=0;chunk=new Uint32Array(selectionChunkWords);}
  }
  if(used)yield{field,start,chunk:chunk.subarray(0,used)};
 }
}
export function selectionFromWire(q){const edges=[];for(let i=0;i<q.edges.length;i+=2)edges.push(`${q.edges[i]}:${q.edges[i+1]}`);return{vertices:q.vertices,faces:q.faces,edges};}
export function selectionToWire(q){const vertices=Uint32Array.from(q.vertices||[]),faces=Uint32Array.from(q.faces||[]),edges=new Uint32Array((q.edges?.length??q.edges?.size??0)*2);let at=0;for(const value of q.edges||[]){const pair=typeof value==='string'?value.split(':').map(Number):value;edges[at++]=pair[0];edges[at++]=pair[1];}return{vertices,faces,edges};}
