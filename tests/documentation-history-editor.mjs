// Actual editor module, with native-like event/port ordering in a CPU fixture.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as sync from '../core/documentation-sync.mjs';
import {history} from '../core/documentation-history.mjs';
class Target {listeners=new Map();addEventListener(n,fn){const a=this.listeners.get(n)||[];a.push(fn);this.listeners.set(n,a);}fire(n,e={}){for(const f of this.listeners.get(n)||[])f(e);}}
const win=new Target(),area=new Target(),sent=[],saved=new Map(),status={dataset:{},hidden:true};
Object.assign(area,{value:'',selectionStart:0,selectionEnd:0,selectionDirection:'none',disabled:true,readOnly:false,setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);},setSelectionRange(start,end,direction){Object.assign(this,{selectionStart:start,selectionEnd:end,selectionDirection:direction});}});
win.sessionStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
const opener={closed:false,postMessage(){}},port={postMessage:m=>sent.push(structuredClone(m)),close(){}};
const context=vm.createContext({...sync,history,performance,installDocumentationGeometry(){},window:win,document:{querySelector:s=>s==='textarea'?area:status},location:{hash:'#test',origin:'https://frame.example'},opener,setTimeout,clearTimeout,setInterval(){}});
const source=await readFile(new URL('../core/documentation-editor.mjs',import.meta.url),'utf8');vm.runInContext(source.replace(/^import[^\n]*\n/gm,''),context);
win.fire('message',{source:opener,origin:'https://frame.example',data:{kind:'frame-docs-connect',token:'test'},ports:[port]});
let version=0,sceneText='',acked=0;const receive=m=>port.onmessage({data:m}),snapshot=text=>receive({kind:'snapshot',state:{text,version:'scene:'+ ++version}});
receive({kind:'snapshot',state:{text:'',version:'scene:0'}});
const ack=()=>{while(acked<sent.length){const m=sent[acked++];if(m.kind!=='write')continue;sceneText=m.text;receive({kind:'reply',id:m.id,ok:true,state:{text:sceneText,version:'scene:'+ ++version}});}};
const insert=(text,type='insertText')=>{area.fire('beforeinput',{inputType:type});const start=area.selectionStart,end=area.selectionEnd;area.value=area.value.slice(0,start)+text+area.value.slice(end);area.setSelectionRange(start+text.length,start+text.length,'none');area.fire('input',{inputType:type});};
const key=(key,shiftKey=false)=>{let stopped=false;area.fire('keydown',{key,ctrlKey:true,metaKey:false,altKey:false,shiftKey,preventDefault(){stopped=true;}});return stopped;};
const checks=[];const check=(n,a,b)=>{assert.equal(a,b,n);checks.push(n);};
for(const c of 'слово'){insert(c);ack();}insert('\n','insertLineBreak');ack();check('Word and Enter are synchronized','слово\n',sceneText);
check('Ctrl-Z native default is prevented',key('z'),true);ack();check('Enter undo leaves no single-letter remnant',area.value,'слово');key('z');ack();check('Second undo removes complete Cyrillic word',sceneText,'');key('y');ack();check('Redo restores complete word',sceneText,'слово');
snapshot('PREFIX слово');key('z');ack();check('Editor undo preserves external prefix',sceneText,'PREFIX ');key('y');ack();check('Editor redo preserves external prefix',sceneText,'PREFIX слово');
insert('\n','insertLineBreak');ack();snapshot('PREFIX СЛОВО\n');key('z');ack();check('Safe newer newline survives rebase',sceneText,'PREFIX СЛОВО');const count=sent.length;key('z');check('Overlapping older history is stopped without a write',sent.length,count);check('Remote word is not rolled back',area.value,'PREFIX СЛОВО');
snapshot('');
// A non-Latin layout may report Cyrillic key text for physical Z/Y.
for(const c of 'слово'){insert(c);ack();}
area.fire('keydown',{key:'я',code:'KeyZ',ctrlKey:true,preventDefault(){}});ack();check('Physical Z fallback undoes a Cyrillic-layout word',area.value,'');
area.fire('keydown',{key:'н',code:'KeyY',ctrlKey:true,preventDefault(){}});ack();check('Physical Y fallback redoes a Cyrillic-layout word',area.value,'слово');
receive({kind:'snapshot',state:{text:'',version:'other:0'}});key('z');check('Scene change resets undo',area.value,'');
// A native composition can emit several inputs but commits only once.
area.fire('compositionstart');insert('漢','insertCompositionText');area.fire('compositionend');await new Promise(r=>setTimeout(r,1));
check('Composition submitted its final text',sent.at(-1).text,'漢');
// Faulted draft remains copy-only, including Ctrl-Z.
receive({kind:'reply',id:sent.at(-1).id,ok:false,code:'FAIL',error:'blocked'});const retained=area.value;key('z');check('Copy-only fault cannot be undone into silent data loss',area.value,retained);check('Faulted draft still has rescue data',saved.has('frame-docs-draft-v1'),true);
console.log(JSON.stringify({pass:true,assertions:checks.length,checks},null,2));
