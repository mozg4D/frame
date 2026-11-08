// Window preference policy and lifecycle without a browser or document data.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {documentationWindowFeatures, installDocumentationGeometry} from '../core/documentation-geometry.mjs';
const key='frame-docs-window-v1', checks=[];
const check=(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);checks.push(name);};
const screen={availLeft:0,availTop:0,availWidth:1920,availHeight:1040,isExtended:false};
const screenRecord={left:0,top:0,width:1920,height:1040};
const saved={left:211,top:137,width:830,height:610,outerWidth:846,outerHeight:649,screen:screenRecord};
const values=features=>Object.fromEntries(features.split(',').map(part=>{const [k,v]=part.split('=');return [k,v===undefined?true:Number(v)];}));
function fixture(raw=null){
 const host=new EventTarget(), data=new Map(raw===null?[]:[[key,typeof raw==='string'?raw:JSON.stringify(raw)]]);let calls=0,callback,stopped=false;
 Object.assign(host,{screen:{...screen},screenX:211,screenY:137,innerWidth:830,innerHeight:610,outerWidth:846,outerHeight:649,
 localStorage:{getItem:k=>data.get(k)??null,setItem(k,v){calls++;data.set(k,v);}},setInterval(fn,ms){check('Move poll is bounded to 1000 ms',ms,1000);callback=fn;return 1;},clearInterval(id){check('Own timer is stopped',id,1);stopped=true;}});
 return {host,data,tick:()=>callback(),get writes(){return calls;},get stopped(){return stopped;}};
}
check('First open uses the existing default',documentationWindowFeatures(fixture().host),'popup,width=760,height=700');
check('Saved inner size and outer position restore exactly',values(documentationWindowFeatures(fixture(saved).host)),{popup:true,width:830,height:610,left:211,top:137});
for(const raw of ['{bad', '{}','null','[]',JSON.stringify({...saved,width:0}),JSON.stringify({...saved,left:'211'}),JSON.stringify({...saved,outerWidth:0}),JSON.stringify({...saved,height:Infinity})])check('Invalid preference falls back safely: '+raw,documentationWindowFeatures(fixture(raw).host),'popup,width=760,height=700');
let f=fixture({...saved,left:9000,top:-9000,width:3000,height:2000,outerWidth:3016,outerHeight:2039});
check('Oversized/offscreen window fits current work area including chrome',values(documentationWindowFeatures(f.host)),{popup:true,width:1904,height:1001,left:0,top:0});
f=fixture({...saved,left:-1700,top:120,screen:{left:-1920,top:0,width:1920,height:1080}});f.host.screen.isExtended=true;
check('Known extended desktop keeps negative-monitor coordinates',values(documentationWindowFeatures(f.host)).left,-1700);
f.host.screen.isExtended=false;
check('Unavailable extended display returns window to visible screen',values(documentationWindowFeatures(f.host)).left,0);
f=fixture({...saved,left:1000,top:700});f.host.screen.availWidth=1024;f.host.screen.availHeight=768;
check('Resolution reduction reclamps outer bounds',values(documentationWindowFeatures(f.host)),{popup:true,width:830,height:610,left:178,top:119});
f=fixture();f.host.screen={availWidth:320,availHeight:480};check('Small-screen first open fits',values(documentationWindowFeatures(f.host)),{popup:true,width:320,height:400});
f=fixture();Object.defineProperty(f.host,'localStorage',{get(){throw Error('blocked');}});check('Blocked storage still opens Docs',documentationWindowFeatures(f.host),'popup,width=760,height=700');installDocumentationGeometry(f.host);f.tick();f.host.dispatchEvent(new Event('pagehide'));
f=fixture();installDocumentationGeometry(f.host);check('Initial real geometry is persisted',JSON.parse(f.data.get(key)),saved);check('Initial single write',f.writes,1);
for(let i=0;i<100;i++)f.tick();check('Idle polling performs no storage rewrites',f.writes,1);
f.host.screenX=322;f.tick();check('Move-only change is persisted without a resize',JSON.parse(f.data.get(key)).left,322);
f.host.innerWidth=900;f.host.outerWidth=916;f.host.dispatchEvent(new Event('resize'));check('Resize captures content width, not outer width',JSON.parse(f.data.get(key)).width,900);
f.host.screenY=244;f.host.dispatchEvent(new Event('beforeunload'));check('Close captures last move before the periodic poll',JSON.parse(f.data.get(key)).top,244);
f.host.innerWidth=0;f.host.outerWidth=0;f.host.dispatchEvent(new Event('resize'));check('Invalid/minimized measurement cannot replace valid size',JSON.parse(f.data.get(key)).width,900);
f.host.innerWidth=900;f.host.outerWidth=916;f.host.screenY=255;f.host.dispatchEvent(new Event('pagehide'));check('Pagehide captures and stops own timer',f.stopped);check('Pagehide saves final position',JSON.parse(f.data.get(key)).top,255);
check('Window preferences contain no document text',Object.keys(JSON.parse(f.data.get(key))).sort(),['height','left','outerHeight','outerWidth','screen','top','width']);
f=fixture(saved);let resized;f.host.resizeTo=(w,h)=>resized=[w,h];installDocumentationGeometry(f.host);check('One-time correction restores the saved outer bounds',resized,[846,649]);f.tick();check('Polling does not force resize',resized,[846,649]);
f=fixture({...saved,width:1660,height:1220});let zoomSize;f.host.resizeTo=(w,h)=>zoomSize=[w,h];installDocumentationGeometry(f.host);check('Zoomed-out content larger than outer window keeps valid bounds',zoomSize,[846,649]);
const p=fixture(saved),start=performance.now();for(let i=0;i<10000;i++)documentationWindowFeatures(p.host);const ms=performance.now()-start;check('10000 complete preference restores stay within 1000 ms',ms<1000);
console.log(JSON.stringify({pass:true,assertions:checks.length,checks,timings:[{name:'10000 preference restores',ms,budgetMs:1000}],scope:'CPU geometry policy/lifecycle; not OS popup placement'},null,2));
