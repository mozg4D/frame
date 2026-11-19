// Compare the actual shaded result with Solid at the identical camera. This
// includes antialiased polygon edges without treating shaded surfaces as lines.
export function maskPixelCoordinates(mask,rect,screens){
 return screens.map(([x,y])=>[(x-rect.left)*mask.width/rect.width,(y-rect.top)*mask.height/rect.height]);
}
export async function projectMaskPoints(page,mask,points){
 const {screens,rect}=await page.evaluate(points=>{const r=frameEngine.pluginView().rect;return {screens:points.map(p=>frameEngine.pluginProject(p)),rect:{left:r.left,top:r.top,width:r.width,height:r.height}};},points);
 return maskPixelCoordinates(mask,rect,screens);
}
export async function polygonLineMask(page){
 const capture=phase=>page.evaluate(async phase=>{
  await frameEngine.draw(true);const r=frameEngine.renderer,d=r.device,width=r.width,height=r.height,stride=Math.ceil(width*4/256)*256,read=d.createBuffer({size:stride*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:r.cachedColor},{buffer:read,bytesPerRow:stride},[width,height]);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(read.getMappedRange());if(phase==='lines'){window.__polygonLineCapture={bytes:bytes.slice(),draws:JSON.parse(document.querySelector('#frame-engine-canvas').dataset.surfaceLines||'null')};return;}
   const lines=window.__polygonLineCapture,pixels=[];for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*stride+x*4;if([0,1,2].some(k=>Math.abs(bytes[i+k]-lines.bytes[i+k])>8))pixels.push(y*width+x);}return {width,height,pixels,draws:lines.draws};
  }finally{read.unmap();read.destroy();}
 },phase);
 const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]),shading=(await call('view.set')).shading;
 try{await capture('lines');await call('view.set',{shading:'solid'});await page.waitForFunction(()=>!frameEngine.renderer.materialState?.pending.size);return await capture('solid');}
 finally{await page.evaluate(()=>delete window.__polygonLineCapture);await call('view.set',{shading});}
}
