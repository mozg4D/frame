import {editorSource as source} from './documentation-source.mjs';
// CPU event-ordering checks. Not an OS IME qualification.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as sync from './documentation-source.mjs';
import {history} from './documentation-source.mjs';

class Target {listeners=new Map();addEventListener(n,f){const a=this.listeners.get(n)||[];a.push(f);this.listeners.set(n,a);}fire(n,e={}){for(const f of this.listeners.get(n)||[])f(e);}}
function setup(initial='') {const win=new Target(),area=new Target(),sent=[],saved=new Map(),status={dataset:{},hidden:true};let h;
Object.assign(area,{value:'',selectionStart:0,selectionEnd:0,selectionDirection:'none',disabled:true,readOnly:false,setRangeText(t,s,e){this.value=this.value.slice(0,s)+t+this.value.slice(e);},setSelectionRange(s,e,d){Object.assign(this,{selectionStart:s,selectionEnd:e,selectionDirection:d});}});
win.sessionStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};const opener={closed:false,postMessage(){}},port={postMessage:m=>sent.push(structuredClone(m)),close(){}};
const context=vm.createContext({...sync,history:(...a)=>(h=history(...a)),performance,installDocumentationGeometry(){},window:win,document:{querySelector:s=>s==='textarea'?area:status},location:{hash:'#test',origin:'https://frame.example'},opener,setTimeout,clearTimeout,setInterval(){}});
vm.runInContext(source.replace(/^import[^\n]*\n/gm,''),context);win.fire('message',{source:opener,origin:'https://frame.example',data:{kind:'frame-docs-connect',token:'test'},ports:[port]});let v=0;
const receive=m=>port.onmessage({data:m});receive({kind:'snapshot',state:{text:initial,version:'scene:0'}});area.setSelectionRange(initial.length,initial.length,'none');
const snapshot=text=>receive({kind:'snapshot',state:{text,version:'scene:'+ ++v}});
const insert=text=>{area.fire('beforeinput',{inputType:'insertCompositionText'});const s=area.selectionStart,e=area.selectionEnd;area.value=area.value.slice(0,s)+text+area.value.slice(e);area.setSelectionRange(s+text.length,s+text.length,'none');area.fire('input',{inputType:'insertCompositionText'});};
const undo=()=>area.fire('keydown',{key:'z',ctrlKey:true,preventDefault(){}});return {area,sent,snapshot,insert,undo,h};}
const wait=()=>new Promise(r=>setTimeout(r,5));
for(const order of ['end-before-final-input','final-input-before-end']){const f=setup();f.area.fire('compositionstart');if(order==='end-before-final-input')f.area.fire('compositionend');f.insert('漢');if(order==='final-input-before-end')f.area.fire('compositionend');await wait();assert.equal(f.h.state.undo,1);f.undo();assert.equal(f.area.value,'');console.log(order,'PASS');}
{const f=setup('base');f.area.fire('compositionstart');f.insert('漢');f.snapshot('REMOTE base');f.area.fire('compositionend');await wait();assert.equal(f.area.value,'REMOTE base漢');f.undo();assert.equal(f.area.value,'REMOTE base');console.log('Remote rebase across IME and undo PASS');}
{const f=setup();f.area.fire('compositionstart');f.insert('漢');f.area.fire('compositionend');f.area.fire('compositionstart');f.insert('字');f.area.fire('compositionend');await wait();f.undo();assert.equal(f.area.value,'漢');f.undo();assert.equal(f.area.value,'');console.log('Back-to-back composition same event turn PASS');}
{const f=setup('base');f.area.fire('compositionstart');f.insert('漢');f.snapshot('REMOTE base');f.area.fire('compositionend');const before={text:f.area.value,start:f.area.selectionStart,end:f.area.selectionEnd};f.area.fire('compositionstart');assert.deepEqual({text:f.area.value,start:f.area.selectionStart,end:f.area.selectionEnd},before);f.insert('字');f.area.fire('compositionend');await wait();assert.equal(f.area.value,'REMOTE base漢字');f.undo();assert.equal(f.area.value,'REMOTE base漢');f.undo();assert.equal(f.area.value,'REMOTE base');console.log('New composition retains hold and both undo steps across remote PASS');}
