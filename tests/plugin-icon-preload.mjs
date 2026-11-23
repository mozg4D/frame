import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const file=relative=>readFile(new URL('../'+relative,import.meta.url),'utf8');
const html=await file('index.html'),tiles=JSON.parse(await file('plugins/icons.json'));
const paths=JSON.parse(await file('plugins/index.json'));
assert.deepEqual(tiles,await Promise.all(paths.map(async path=>{
 const m=JSON.parse(await file('plugins/'+path));
 await file('plugins/'+m.id+'/'+m.icon);
 return {id:m.id,name:m.name,icon:m.id+'/'+m.icon};
})));
const section=(a,b)=>{const i=html.indexOf(a),j=html.indexOf(b,i);assert(i>=0&&j>i);return html.slice(i,j);};
const sample=section('  const pluginIconBytes=new Map()', '  async function prepareAuthoring(');
const resourceAt=html.indexOf('function frameResourceURL(');assert.ok(resourceAt>=0);const resourceSource=html.slice(resourceAt,html.indexOf('\n',resourceAt));
const boot=section("  addEventListener('load',()=>{\n    void frameEngine.ready.then", "  if(!('serviceWorker' in navigator)||!isSecureContext)return;");
const order=[],requests=[],panel=[],deferred=[],fallback=[],callbacks={},icons={};
const grid={append(b){panel.push(b.dataset.plugin);}},doc={createElement:()=>({dataset:{},append(){}})};
const root='https://example.test/frame/';
let ready, idle;
const ctx=vm.createContext({icons,document:doc,location:new URL(root),URL,window:{requestIdleCallback(fn){idle=fn;}},addEventListener(name,fn){callbacks[name]=fn;},frameEngine:{ready:new Promise(resolve=>{ready=resolve;})},$(){return grid;},
fetch:async (url,opts)=>{url=String(url).replace(root,'');requests.push([url,opts?.priority]);return {ok:true,json:async()=>tiles,text:async()=>'<svg></svg>'};},
local:(base,path)=>new URL(path,base).href,
catalogue(){fallback.push('manifest');return Promise.resolve([]);},activateTab:()=>{},createObject:id=>order.push(id),fileOperationError:assert.fail,
Image:class{decode(){assert.match(this.src,/^data:image\/svg\+xml/);return new Promise(ok=>deferred.push(ok));}}});
vm.runInContext(resourceSource+'\nlet panelPending,creating=Promise.resolve();\n'+sample+'\nconst FramePlugins={warmIcons};\n'+boot,ctx);
assert.equal(requests.length,0);
callbacks.load();assert.equal(requests.length,0);
ready();await Promise.resolve();assert.equal(requests.length,0);
assert.equal(typeof idle,'function');
idle();
const foreground=vm.runInContext('show()',ctx);
while(deferred.length<tiles.length)await new Promise(resolve=>setImmediate(resolve));
assert.equal(panel.length,0);
assert.deepEqual(requests, [['plugins/icons.json','low'],...tiles.map(t=>['plugins/'+t.icon,'low'])]);
assert.equal(fallback.length,0);
deferred.reverse().forEach(ok=>ok());
await foreground;
assert.deepEqual(panel,tiles.map(t=>t.id));
await vm.runInContext('show()',ctx);
assert.equal(requests.length,tiles.length+1);assert.equal(panel.length,tiles.length);assert.equal(order.length,0);
console.log('PASS: idle after load and renderer ready; shared icon-only fetches; decode before display; stable order; zero new work on click.');
