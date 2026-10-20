export async function viewportStatusChecks(page){
  const checks=[],timings=[],check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name);},call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
  const hud=await page.evaluate(()=>({fps:!!document.querySelector('#frame-engine-fps').getClientRects().length,memory:!!document.querySelector('#frame-engine-memory').getClientRects().length}));
  check('Viewport displays FPS without a VRAM row',hud.fps&&!hud.memory,hud);
  await page.evaluate(()=>{
    window.__statusRows=[];window.__statusObserver=new MutationObserver(()=>{
      const row=document.querySelector('#frame-file-progress');if(!row)return;
      const r=row.getBoundingClientRect(),fps=document.querySelector('#frame-engine-fps').getBoundingClientRect(),css=getComputedStyle(row);
      __statusRows.push({text:row.textContent,left:r.left,top:r.top,fpsBottom:fps.bottom,fpsLeft:fps.left,height:r.height,padding:css.padding,border:css.borderWidth,whiteSpace:css.whiteSpace,background:css.backgroundColor});
    });__statusObserver.observe(document.querySelector('#frame-engine-host'),{childList:true,subtree:true,characterData:true});
  });
  try{
    let start=performance.now();const saved=await call('scene.export',{includeData:true});let ms=performance.now()-start;timings.push({name:'HASH save with inline status',ms,limit:3000});check('HASH save completes within 3 seconds',ms<3000,{ms});
    start=performance.now();await call('scene.open',{name:'status-roundtrip.hash',base64:saved.base64});ms=performance.now()-start;timings.push({name:'HASH load with inline status',ms,limit:3000});check('HASH load completes within 3 seconds',ms<3000,{ms});
    const rows=await page.evaluate(()=>__statusRows);
    check('HASH save and load report progress',rows.some(r=>r.text.includes('Saving HASH'))&&rows.some(r=>r.text.includes('Opening HASH')),rows);
    check('Progress is a short unboxed line directly below FPS',rows.length&&rows.every(r=>r.top>=r.fpsBottom-1&&r.top-r.fpsBottom<=4&&Math.abs(r.left-r.fpsLeft)<1&&r.height<=20&&r.padding==='0px'&&r.border==='0px'&&r.whiteSpace==='nowrap'&&r.background==='rgba(0, 0, 0, 0)'&&r.text.length<70),rows);
    check('Completed operations remove the progress line',await page.locator('#frame-file-progress').count()===0);
    const errors=await page.evaluate(()=>{const out=document.querySelector('#frame-engine-status'),r=out.getBoundingClientRect(),css=getComputedStyle(out);return {top:css.top,left:css.left,whiteSpace:css.whiteSpace};});
    check('Other viewport messages share the top status position',errors.top==='28px'&&errors.left==='8px'&&errors.whiteSpace==='nowrap',errors);
    return {checks,timings};
  }finally{await page.evaluate(()=>{__statusObserver.disconnect();delete window.__statusObserver;delete window.__statusRows;});}
}
