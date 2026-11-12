// Test-only evidence. No scene, camera, API, shader or acceptance changes.
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const representativeCorner=c=>c.distance===1000&&c.yaw===0&&c.phase===0;
export function cornerScreenshotName(c){
 if(!representativeCorner(c)||!['uncovered','covered'].includes(c.visibility)||!Number.isFinite(c.dpr)||c.dpr<=0)throw Error('Invalid representative corner screenshot');
 return `spline-corner-dpr${c.dpr}-d1000-yaw0-phase0-${c.visibility}.png`;
}
export async function captureCornerEvidence(page,captureScreenshot,caseInfo,visibility,now=()=>performance.now()){
 if(!captureScreenshot||!representativeCorner(caseInfo))return null;
 const started=now(),state=await page.evaluate(()=>({dpr:window.devicePixelRatio,backing:[frameEngine.renderer.width,frameEngine.renderer.height],frameId:frameEngine.renderer.lastFrameRaw?.id??null})),info={...caseInfo,visibility,...state},receipt=await captureScreenshot(info);
 return {...info,...receipt,elapsedMs:now()-started};
}
export function createCornerScreenshotCapture(page,output){return async info=>{
 const name=cornerScreenshotName(info);await mkdir(output,{recursive:true});const bytes=await page.screenshot({path:fileURLToPath(new URL(name,output))});
 return {file:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
};}
