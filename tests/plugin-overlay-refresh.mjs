import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const sourceLine=(source,prefix)=>{const line=source.split(/\r?\n/).find(line=>line.trimStart().startsWith(prefix));assert.ok(line,'Missing source seam: '+prefix);return line.trim();};
function requestAttributesSource(source){const start=source.indexOf('requestAttributes:'),end=source.indexOf(',requestDraw:',start);assert.ok(start>=0&&end>start,'Missing plugin attribute refresh callback');return source.slice(start+'requestAttributes:'.length,end);}
function harness(source,atomic){
 const draw=sourceLine(source,'function drawOverlays('),overlay=sourceLine(atomic,'function overlay()'),cancel=sourceLine(atomic,'function cancelPlacement()'),request=requestAttributesSource(source);
 return vm.runInNewContext(`(()=>{
  const metrics={nodeScans:0,otherOverlays:0,rebuilds:0,attributes:0,draws:0},panels=new Map();
  const createElement=()=>({dataset:{},children:[],attributes:{},style:{setProperty(){}},classList:{toggle(){}},ownerDocument:{defaultView:{innerWidth:1000}},setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k];},replaceChildren(){metrics.rebuilds++;this.children=[];},append(el){this.children.push(el);},remove(){panels.delete(this.id);}});
  const node={nativeHash:'atomic-owner',type:'atomic'},D={current:node,nodes:[node]},elements=new Map([[6,{z:6,sym:'C'}]]);
  let addMode={hash:node.nativeHash,species:6},elementsVisible=true,overlayOwner=node.nativeHash;
  const ancestor=()=>node,find=h=>h===node.nativeHash?node:null,eligible=()=>true,rgb=()=> '#fff',elementColor=()=>[1,1,1];
  ${overlay}
  const entry={manifest:{id:'atomic'},editor:{overlay}},other={manifest:{id:'other'},editor:{overlay(){metrics.otherOverlays++;return null;}}},entries=new Map([['atomic',entry],['other',other]]);
  const nodes=new Proxy([node],{get(target,key,receiver){if(key===Symbol.iterator)metrics.nodeScans++;return Reflect.get(target,key,receiver);}});
  const owner=()=>entry,dispatch=()=>null,objectColor=()=>'',document={createElement},$=id=>panels.get(id),framePlaceOverlay=panel=>panels.set(panel.id,panel),fileOperationError=e=>{throw e;};
  const window={frameEngine:{pluginView:()=>({instance:0,rect:{left:0,top:0,width:800,height:600}})}};
  const refreshAttributes=()=>metrics.attributes++;
  ${draw}
  const context={requestAttributes:${request},requestDraw(){metrics.draws++;}};
  ${cancel}
  return {metrics,draw:()=>drawOverlays(),refresh:()=>context.requestAttributes(),cancel:cancelPlacement,activate(){addMode={hash:node.nativeHash,species:6};},hide(){elementsVisible=false;},withoutOverlay(){entry.editor={};},state:()=>({placing:!!addMode,aria:panels.get('frame-plugin-overlay-atomic')?.children.find(b=>b.dataset.pluginElement==='C')?.getAttribute('aria-pressed')}),reset(){for(const k of Object.keys(metrics))metrics[k]=0;}};
 })()`);
}
export function pluginOverlayRefreshChecks(source,atomic){
 const checks=[],check=(name,pass)=>{assert.ok(pass,name);checks.push({name:'Plugin overlay refresh: '+name,pass:true});};
 const h=harness(source,atomic);h.draw();check('Existing full draw visits scene rows and all overlay descriptors',h.metrics.nodeScans===1&&h.metrics.otherOverlays===1&&h.state().aria==='true');
 h.reset();h.cancel();check('Working Atomic cancellation immediately clears native pressed state',!h.state().placing&&h.state().aria==='false');
 check('Attribute refresh updates only its owner overlay without scanning scene rows',h.metrics.nodeScans===0&&h.metrics.otherOverlays===0&&h.metrics.rebuilds===1&&h.metrics.attributes===1&&h.metrics.draws===1);
 h.reset();h.refresh();check('An unchanged owner descriptor retains the existing DOM stamp cache',h.metrics.rebuilds===0&&h.metrics.nodeScans===0&&h.metrics.otherOverlays===0&&h.state().aria==='false');
 h.activate();h.refresh();check('Reactivation publishes pressed state through the same owner refresh',h.state().aria==='true');
 h.hide();h.refresh();check('An absent owner descriptor removes its previous overlay',h.state().aria===undefined);
 h.reset();h.withoutOverlay();h.refresh();check('Plugins without overlay hooks keep attribute refresh without overlay work',h.metrics.attributes===1&&h.metrics.nodeScans===0&&h.metrics.otherOverlays===0&&h.metrics.rebuilds===0);
 check('High-frequency plugin requestDraw remains unchanged',source.includes('requestDraw:()=>window.frameEngine?.draw(true)'));
 return checks;
}
export function pluginOverlayRefreshNegatives(source,atomic){
 const current=requestAttributesSource(source),old='()=>refreshAttributes(entry)';assert.notEqual(current,old);
 const stale=harness(source.replace('requestAttributes:'+current,'requestAttributes:'+old),atomic);stale.draw();stale.reset();stale.cancel();assert.equal(stale.state().placing,false);assert.equal(stale.state().aria,'true');
 assert.throws(()=>pluginOverlayRefreshChecks(source.replace('requestAttributes:'+current,'requestAttributes:'+old),atomic),/Working Atomic cancellation/);
 const mutations=[
  ['Owner refresh cannot scan the scene Browser',s=>s.replace('if(!only)for(const n of nodes)','for(const n of nodes)')],
  ['Owner refresh cannot visit unrelated overlays',s=>s.replace('for(const entry of only?[only]:entries.values())','for(const entry of entries.values())')],
  ['The unchanged-descriptor DOM stamp cache must remain active',s=>s.replace('if(panel?.dataset.stamp===stamp)continue;','')]
 ];
 for(const [name,mutate]of mutations){const changed=mutate(source);assert.notEqual(changed,source,name);assert.throws(()=>pluginOverlayRefreshChecks(changed,atomic),undefined,name);}
 return ['Old requestAttributes leaves stale aria despite working cancellation',...mutations.map(([name])=>name)];
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const source=await readFile(new URL('../index.html',import.meta.url),'utf8'),atomic=await readFile(new URL('../plugins/atomic/plugin.js',import.meta.url),'utf8');
 const checks=pluginOverlayRefreshChecks(source,atomic),negativeControls=pluginOverlayRefreshNegatives(source,atomic);
 console.log(JSON.stringify({pass:true,checks:checks.length,negativeControls:negativeControls.length,names:checks.map(c=>c.name),negative:negativeControls},null,2));
}
