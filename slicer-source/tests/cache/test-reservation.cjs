'use strict';
const {base,candidate,context,same,assert,writeReceipt}=require('./test-support.cjs'),checks=[];
const group=[[[{X:0,Y:0},{X:1e7,Y:0},{X:1e7,Y:1e7},{X:0,Y:1e7}]]],p={lineWidth:1,perimeters:2,minPathLength:0,width:100,depth:100};
(async()=>{const a=context(base),b=context(candidate);for(const inputVertices of [4,8,4]){
 const da=a.api.describeContours(group,p),db=b.api.describeContours(group,p);da.inputVertices=db.inputVertices=inputVertices;
 const ra=a.api.reserveInset(da.parts[0].key,inputVertices),rb=b.api.reserveInset(db.parts[0].key,inputVertices);assert.equal(ra.hit,rb.hit);same(a.api.__qa.cache(),b.api.__qa.cache());
 if(!ra.hit){assert(a.api.__qa.cache()[0].pending);ra.complete(a.api.calculateInsetMaterial(da.parts[0].material,p,inputVertices));rb.complete(b.api.calculateInsetMaterial(db.parts[0].material,p,inputVertices));}
 same(await ra.promise,await rb.promise);same(a.api.__qa.cache(),b.api.__qa.cache());same(a.api.insetCacheMemory(),b.api.insetCacheMemory());
 same(a.api.insetGroups(group,p),b.api.insetDescription(db,p));same(a.api.__qa.cache(),b.api.__qa.cache());checks.push('reserve/complete/P1 reuse inputVertices '+inputVertices);
 }
 writeReceipt('reservation-receipt.json','FRAME_P123_RESERVATION_COMPLETED',checks);
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
