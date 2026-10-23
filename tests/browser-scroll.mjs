export async function browserScrollChecks(page){
 const checks=[],timings=[],check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const box=page.locator('#obScroll');await box.evaluate(e=>e.scrollTop=0);for(let i=0;i<20&&await page.locator('.ob-row').count()<80;i++){const folded=page.locator('.ob-row[aria-expanded="false"] [data-action="fold"]').first();if(!await folded.count())break;await folded.click();}
 const bounds=await box.boundingBox(),row=page.locator('.ob-row .ob-name').first(),r=await row.boundingBox(),started=performance.now();
 const sample=()=>box.evaluate(e=>({top:e.scrollTop,time:performance.now()}));
 try{await page.mouse.move(r.x+Math.min(20,r.width*.5),r.y+8);await page.mouse.down();await page.mouse.move(r.x+20,bounds.y+bounds.height-45,{steps:3});await page.waitForTimeout(60);await page.mouse.move(r.x+20,bounds.y+bounds.height+5);const a=await sample();await page.waitForTimeout(250);const b=await sample();await page.mouse.move(r.x+20,bounds.y+bounds.height+150);const c=await sample();await page.waitForTimeout(250);const d=await sample();
  // Browser work can delay a CDP sample beyond the requested timer. Compare actual rates.
  const near=b.top-a.top,far=d.top-c.top,nearMs=b.time-a.time,farMs=d.time-c.time,nearSpeed=near/nearMs,farSpeed=far/farMs;
  check('Browser drag scroll continues outside bounds and accelerates with distance',near>20&&farSpeed>nearSpeed*2,{near,far,nearMs,farMs,nearSpeed,farSpeed});await page.mouse.up();const end=await box.evaluate(e=>e.scrollTop);await page.waitForTimeout(80);check('Auto scroll stops on pointer release',Math.abs((await box.evaluate(e=>e.scrollTop))-end)<2);const ms=performance.now()-started;timings.push({name:'Object browser continuous drag auto scroll',ms,limit:2000});check('Browser auto scroll gesture latency budget',ms<2000,{ms});return {checks,timings};}finally{await page.mouse.up();}
}
