import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const section=(start,end)=>{const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return html.slice(a,b);};
const numbers=section('const NUMERIC_CONSTANTS=','\nconst PAL =');
const numberAPI=Function(numbers+';return {compactNumberText,numericRoundoffTolerance,numericExpressionValue};')();
const bindSource=section('function bindNumber(input,o){',"\nFrameViewWindows.onDocument('pointerdown'");
const hudSource=section("\nfor(const [i,id]of ['px','rx','sx','py','ry','sy','pz','rz','sz'].entries()){",'\n\nfunction refreshTabActions');
const units=[1e-6,1e-3,1,10,100,1000,1e6];
function binding(initial,options={},unit=2,source=bindSource){
 let value=initial,sets=0,commits=0,restores=0;
 const events=new Map(),captures=new Set(),document={activeElement:null,body:{classList:{remove(){},add(){}}}};
 const input={value:'',placeholder:'',dataset:{},style:{},closest:()=>null,addEventListener:(name,fn)=>events.set(name,fn),setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id),select(){}};
 const fire=(name,event={})=>events.get(name)?.({preventDefault(){},stopPropagation(){},...event});
 input.focus=()=>{if(document.activeElement===input)return;document.activeElement?.blur();document.activeElement=input;fire('focus');};input.blur=()=>{if(document.activeElement!==input)return;document.activeElement=null;fire('blur');};
 const runtime=Function('document','snapshot','restore','checkpoint','unitMillimeters','displayUnitIndex','getSelection',numbers+";let numericSession=null,framePointerLock=null,numericDragInput=null;const frameUnlockPointer=()=>{},frameEdgePointer=()=>{};"+source+';return {bindNumber,finish:accept=>numericSession?.finish(accept),session:()=>numericSession?.input};');
 const o={get:()=>value,set:v=>{value=v;sets++;},...options};
 const model=runtime(document,()=>value,v=>{value=v;restores++;},v=>{if(v!==value)commits++;},units,unit,()=>null);model.bindNumber(input,o);
 return {input,fire,finish:model.finish,session:model.session,captures,value:()=>value,counts:()=>({sets,commits,restores}),type:text=>{input.value=text;fire('input');},state:()=>document};
}
function hud(state,unit=2){
 const fields={};Function('window','bindNumber','$','current','selected','node','unitMillimeters','displayUnitIndex','numericRoundoffTolerance',hudSource)({frameEngine:{transformState:state}},(input,o)=>fields[input.id]=o,id=>({id}),()=>null,[],()=>null,units,unit,numberAPI.numericRoundoffTolerance);return fields;
}
export async function numericDisplayChecks(){
 const checks=[],timings=[],check=(name,fn)=>{fn();checks.push({name,pass:true});};
 const {compactNumberText:format,numericRoundoffTolerance:tolerance,numericExpressionValue:parse}=numberAPI;
 try{
  check('Computed Float64 residue has an explicit scale-relative display tolerance',()=>{
   const values=[1000,1.7e-13,1500],eps=tolerance(values);assert.equal(eps,1500*Number.EPSILON*16);assert.equal(format(values[1],8,eps),'0');assert.equal(format(-values[1],8,eps),'0');assert.notEqual(format(eps*1.01,8,eps),'0');assert.equal(tolerance([0,-0]),0);assert.equal(tolerance([NaN,Infinity,-Infinity]),0);
  });
  check('Authored scalar numbers retain scientific notation at every magnitude',()=>{
   for(const v of [1e-4,1e-6,1e-9,1e-12,1e-16,1e-30,Number.MIN_VALUE])for(const sign of [1,-1]){assert.notEqual(format(v*sign),'0');assert.equal(Math.sign(Number(format(v*sign))),sign);}
   assert.equal(format(0),'0');assert.equal(format(-0),'0');assert.equal(format(NaN),'');assert.equal(format(Infinity),'');assert.equal(format(-Infinity),'');
  });
  check('Tiny standalone dimensions are not compared with a fixed millimeter epsilon',()=>{
   for(const scale of [1e-18,1e-12,1e-6,1,1e6,1e12]){const state={position:[0,0,0],size:[scale,scale*2,scale/10],rotation:[0,0,0]},fields=hud(state);for(const id of ['sx','sy','sz'])assert.notEqual(format(fields[id].get(),8,fields[id].zeroTolerance()),'0');}
  });
  check('Computed zero policy applies to position, angle and dimensions in all display units',()=>{
   for(let unit=0;unit<units.length;unit++){
    const state={position:[2e-14,-2e-14,0],size:[1200,2e-13,1400],rotation:[2e-14,-2e-14,90]},fields=hud(state,unit);
    for(const id of ['px','py','sy','rx','ry'])assert.equal(format(fields[id].get(),8,fields[id].zeroTolerance()),'0',id+' '+unit);
    assert.equal(Number(format(fields.sx.get(),8,fields.sx.zeroTolerance())),1200/units[unit]);assert.equal(format(fields.rz.get(),8,fields.rz.zeroTolerance()),'90');
   }
  });
  check('Meaningful thin dimensions and angles survive beside ordinary dimensions',()=>{
   const fields=hud({position:[.001,-.002,0],size:[1000,1e-6,1500],rotation:[1e-8,-1e-8,90]});for(const id of ['px','py','sy','rx','ry'])assert.notEqual(format(fields[id].get(),8,fields[id].zeroTolerance()),'0');
  });
  check('Shared formatter retains integer, explicit precision and expression rules',()=>{
   const integer=binding(1.6,{int:true});assert.equal(integer.input.value,'2');const fixed=binding(-.0001,{prec:3});assert.equal(fixed.input.value,'0');fixed.input.focus();fixed.input.blur();assert.equal(fixed.value(),-.0001);assert.equal(fixed.counts().sets,0);
   assert.equal(parse('1e-16'),1e-16);assert.equal(parse('0.1+0.2-0.3'),5.551115123125783e-17);assert.equal(parse('sqrt(4)'),2);assert.equal(parse('garbage'),null);
  });
  for(const deferred of [false,true])check('Untouched focus/blur/Enter preserve exact '+(deferred?'deferred transform':'live scalar')+' values',()=>{
   for(const value of [2e-13,-2e-13,1.234567891234567,1e-12]){const x=binding(value,{deferText:deferred,zeroTolerance:()=>1e-12});for(let i=0;i<3;i++){x.input.focus();x.fire('keydown',{key:i%2?'Enter':'Escape'});if(i%2===0)x.input.blur();}assert.equal(x.value(),value);assert.equal(x.counts().sets,0);assert.equal(x.counts().commits,0);}
  });
  check('Typing zero is an explicit edit even when displayed text was already zero',()=>{
   const x=binding(2e-13,{deferText:true,zeroTolerance:()=>1e-12});assert.equal(x.input.value,'0');x.input.focus();x.type('0');assert.equal(x.value(),2e-13);x.fire('keydown',{key:'Enter'});assert.equal(x.value(),0);assert.equal(x.counts().commits,1);
  });
  check('Typing a meaningful tiny quantity stores it exactly, and Escape cancels it',()=>{
   for(const deferred of [false,true]){const x=binding(12,{deferText:deferred});x.input.focus();x.type('1e-16');x.fire('keydown',{key:'Enter'});assert.equal(x.value(),1e-16);assert.equal(x.input.value,'1e-16');x.input.focus();x.type('5e-15');x.fire('keydown',{key:'Escape'});assert.equal(x.value(),1e-16);}
  });
  check('Invalid, empty and repeated editing cannot commit display-only zero',()=>{
   for(const text of ['','bad','1/0']){const x=binding(2e-13,{zeroTolerance:()=>1e-12});x.input.focus();x.type(text);x.input.blur();assert.equal(x.value(),2e-13);assert.equal(x.counts().sets,0);assert.equal(x.counts().commits,0);}
  });
  check('Arrow keys step the underlying value rather than its rounded display',()=>{
   const x=binding(1.234567891234567);x.input.focus();x.fire('keydown',{key:'ArrowUp'});const exact=1.234567891234567+1;assert.equal(x.value(),exact);x.input.blur();assert.equal(x.value(),exact);assert.equal(x.counts().sets,1);
   const residue=binding(2e-13,{zeroTolerance:()=>1e-12,keyStep:1e-13});residue.input.focus();residue.fire('keydown',{key:'ArrowUp'});assert.equal(residue.value(),3.0000000000000003e-13);residue.input.blur();assert.equal(residue.counts().sets,1);
  });
  check('Arrow keys resolve a newly typed expression before stepping',()=>{
   const x=binding(0,{deferText:true});x.input.focus();x.type('2+3');x.fire('keydown',{key:'ArrowDown'});assert.equal(x.value(),4);x.input.blur();assert.equal(x.value(),4);
  });
  check('A scrub click without motion does not quantize the displayed value',()=>{
   for(const focused of [false,true]){const x=binding(2e-13,{zeroTolerance:()=>1e-12});if(focused)x.input.focus();x.input._scrubStart({pointerId:1,clientX:0,clientY:0});x.input._scrubEnd({pointerId:1});assert.equal(x.value(),2e-13);assert.equal(x.counts().sets,0);}
  });
  check('Scrubbing commits an explicit deferred edit before movement',()=>{
   const x=binding(2e-13,{deferText:true,zeroTolerance:()=>1e-12});x.input.focus();x.type('4');x.input._scrubStart({pointerId:1,clientX:0,clientY:0});x.input._scrubMove({pointerId:1,clientX:12,clientY:0,preventDefault(){}});x.input._scrubEnd({pointerId:1});assert.equal(x.value(),4.2);assert.equal(x.counts().commits,1);
  });
  check('Wheel stepping, normal precision and range clamps retain native behavior',()=>{
   const x=binding(5,{prec:1,min:0,max:6,stepFixed:.1});x.input._stepWheel({deltaY:-1});assert.equal(x.value(),5.1);x.input.focus();x.type('999');x.input.blur();assert.equal(x.value(),6);x.input.focus();x.type('-1');x.input.blur();assert.equal(x.value(),0);
  });
  check('Unit-converted parameter typing and untouched focus preserve canonical values',()=>{
   for(let u=0;u<units.length;u++){const x=binding(1.2345678912345e-9,{length:true},u);x.input.focus();x.input.blur();assert.equal(x.value(),1.2345678912345e-9);assert.equal(x.counts().sets,0);x.input.focus();x.type('0.5');x.input.blur();assert.equal(x.value(),.5*units[u]);}
  });
  check('Boundary, precision and parser rules retain finite canonical numbers',()=>{
   const eps=tolerance([1200,2400]);for(const sign of [-1,1]){assert.equal(format(sign*eps,8,eps),'0');assert.notEqual(format(sign*eps*1.01,8,eps),'0');}
   assert.equal(format(-0,8,0),'0');assert.equal(format(123456789),'1.2345679e+8');assert.equal(format(.0000123456789),'1.2345679e-5');
   for(const [text,value]of [['−0',-0],['0,125',.125],['０００１２',12],['2*(3+4)',14],['1e-16',1e-16]])assert.equal(parse(text),value,text);
   for(const text of ['NaN','Infinity','1/0','2+','sqrt(-1)'])assert.equal(parse(text),null,text);
  });
  check('Modifier arrows, repeated keys, integer and range rules preserve exact base',()=>{
   const initial=1.234567891234567,x=binding(initial);x.input.focus();x.fire('keydown',{key:'ArrowUp',shiftKey:true});x.fire('keydown',{key:'ArrowDown',altKey:true});x.fire('keydown',{key:'ArrowUp',repeat:true});x.input.blur();assert.equal(x.value(),initial+10-.1+1);assert.equal(x.counts().sets,3);assert.equal(x.counts().commits,1);
   const integer=binding(2,{int:true,min:0,max:3});integer.input.focus();integer.fire('keydown',{key:'ArrowUp',altKey:true});integer.fire('keydown',{key:'ArrowUp',shiftKey:true});integer.input.blur();assert.equal(integer.value(),3);assert.equal(integer.counts().commits,1);
  });
  check('Keyboard event prevention and propagation are retained without rewriting on navigation',()=>{
   const x=binding(1.234567891234567);let stopped=0,prevented=0;const event=key=>({key,stopPropagation(){stopped++;},preventDefault(){prevented++;}});x.input.focus();for(const key of ['Tab','ArrowLeft','Home','a'])x.fire('keydown',event(key));assert.equal(stopped,4);assert.equal(prevented,0);assert.equal(x.counts().sets,0);x.fire('keydown',event('ArrowUp'));x.fire('keydown',event('Enter'));assert.equal(stopped,6);assert.equal(prevented,2);assert.equal(x.session(),undefined);
  });
  check('Repeated edits after arrows, wheel and cancellation begin fresh transactions',()=>{
   const x=binding(1.234567891234567,{deferText:true});x.input.focus();x.type('2+3');x.fire('keydown',{key:'ArrowUp'});x.type('7e-9');x.fire('keydown',{key:'Enter'});assert.equal(x.value(),7e-9);assert.equal(x.counts().commits,1);
   x.input.focus();x.type('12');x.input._stepWheel({deltaY:-1});assert.equal(x.value(),1.007e-6);const wheel=x.value();x.type('8e-10');x.fire('keydown',{key:'Escape'});assert.equal(x.value(),wheel);assert.equal(x.counts().commits,2);assert.equal(x.session(),undefined);
   x.input.focus();x.type('3e-11');x.input.blur();assert.equal(x.value(),3e-11);assert.equal(x.counts().commits,3);
  });
  check('Focused wheel and continued arrows never reapply a rounded display',()=>{
   const initial=1.234567891234567,x=binding(initial);x.input.focus();x.input._stepWheel({deltaY:-1});assert.equal(x.value(),initial+.1);x.fire('keydown',{key:'ArrowUp'});x.input.blur();assert.equal(x.value(),initial+.1+1);assert.equal(x.counts().sets,2);assert.equal(x.counts().commits,2);
  });
  check('Scrub click, threshold and mismatched pointer leave precise values unchanged',()=>{
   const initial=1.234567891234567,x=binding(initial);x.input.focus();x.input._scrubStart({pointerId:3,clientX:100,clientY:100});x.input._scrubMove({pointerId:9,clientX:200,clientY:100,preventDefault(){}});assert.equal(x.input._scrubEnd({pointerId:9}),false);assert.equal(x.captures.has(3),true);x.input._scrubMove({pointerId:3,clientX:101,clientY:100,preventDefault(){}});assert.equal(x.input._scrubEnd({pointerId:3}),false);assert.equal(x.value(),initial);assert.equal(x.counts().sets,0);assert.equal(x.captures.size,0);x.input.blur();assert.equal(x.counts().sets,0);
  });
  check('Untouched scrub starts from precise data, then retained scrub rounding applies',()=>{
   const initial=1.234567891234567,x=binding(initial);x.input.focus();x.input._scrubStart({pointerId:4,clientX:100,clientY:100});assert.equal(x.counts().sets,0);x.input._scrubMove({pointerId:4,clientX:112,clientY:100,preventDefault(){}});x.input._scrubEnd({pointerId:4});assert.equal(x.value(),1.43456789123);assert.equal(x.counts().sets,1);assert.equal(x.counts().commits,1);assert.equal(x.captures.size,0);x.input.focus();x.input.blur();assert.equal(x.value(),1.43456789123);assert.equal(x.counts().sets,1);
  });
  check('Interrupted scrub completion is idempotent and permits a new edit',()=>{
   const x=binding(5,{stepFixed:.1});x.input.focus();x.input._scrubStart({pointerId:5,clientX:0,clientY:0});x.input._scrubMove({pointerId:5,clientX:12,clientY:0,preventDefault(){}});assert.equal(x.input._scrubEnd({}),true);assert.equal(x.input._scrubEnd({pointerId:5}),false);assert.equal(x.counts().commits,1);assert.equal(x.session(),undefined);assert.equal(x.captures.size,0);x.input.focus();x.type('6');x.fire('keydown',{key:'Enter'});assert.equal(x.value(),6);assert.equal(x.counts().commits,2);
  });
  check('Custom snapshot, update, finish, commit and revert callbacks keep lifecycle order',()=>{
   const calls=[];let x;const opts={deferText:true,snap:()=>{calls.push('snap');return x.value();},update:()=>calls.push('update'),finish:()=>calls.push('finish'),commit:before=>calls.push(['commit',before]),revert:before=>calls.push(['revert',before])};x=binding(1.234567891234567,opts);x.input.focus();x.input.focus();x.input.blur();assert.deepEqual(calls,['snap','finish',['commit',1.234567891234567]]);assert.equal(x.counts().sets,0);
   calls.length=0;x.input.focus();x.type('7');x.fire('keydown',{key:'Enter'});assert.deepEqual(calls,['snap','update','finish',['commit',1.234567891234567]]);calls.length=0;x.input.focus();x.type('8');x.fire('keydown',{key:'Escape'});assert.deepEqual(calls,['snap',['revert',7]]);assert.equal(x.value(),7);assert.equal(x.session(),undefined);
  });
  check('Session interruption commits once and resets text intent for subsequent focus',()=>{
   const calls=[],x=binding(1.234567891234567,{finish:()=>calls.push('finish')});x.input.focus();x.type('2.345678912345678');x.finish(true);x.finish(true);x.input.blur();assert.equal(x.value(),2.345678912345678);assert.equal(x.counts().commits,1);assert.deepEqual(calls,['finish']);x.input.focus();x.fire('keydown',{key:'Enter'});assert.equal(x.counts().sets,1);assert.equal(x.value(),2.345678912345678);
  });
  check('Reentrant update blur cannot prematurely finish or round an active input write',()=>{
   let x;x=binding(0,{update:()=>x.input.blur()});x.input.focus();x.type('1.234567891234567');assert.equal(x.value(),1.234567891234567);assert.equal(x.counts().commits,0);x.finish(true);assert.equal(x.counts().commits,1);assert.equal(x.counts().sets,1);
  });
  check('Historical arrow and focused scrub start would quantize the precise source',()=>{
   const arrow=bindSource.replace('const parsed=textEdited?numericExpressionValue(input.value):null','const parsed=numericExpressionValue(input.value)');assert.notEqual(arrow,bindSource);const x=binding(1.234567891234567,{},2,arrow);x.input.focus();x.fire('keydown',{key:'ArrowUp'});assert.notEqual(x.value(),1.234567891234567+1);
   const scrub=bindSource.replace('document.activeElement===input&&textEdited&&parsed!==null','document.activeElement===input&&parsed!==null');assert.notEqual(scrub,bindSource);const y=binding(2e-13,{zeroTolerance:()=>1e-12},2,scrub);y.input.focus();y.input._scrubStart({pointerId:1,clientX:0,clientY:0});assert.equal(y.value(),0);
  });
  check('Historical blur behavior would corrupt an untouched display-only zero',()=>{
   const old=bindSource.replace('if(textEdited&&parsed!==null)apply(parsed);','if(parsed!==null)apply(parsed);');assert.notEqual(old,bindSource);const x=binding(2e-13,{zeroTolerance:()=>1e-12},2,old);x.input.focus();x.input.blur();assert.equal(x.value(),0);assert.equal(x.counts().commits,1);
  });
  const start=performance.now();let total=0;for(let i=0;i<100000;i++){const values=[1200,(i%2?1:-1)*2e-13,1400],eps=tolerance(values);for(const v of values)total+=format(v,8,eps).length;}const ms=performance.now()-start;check('100000 completed three-axis formatting updates stay below 1 second',()=>{assert(ms<1000);assert.equal(total,900000);});timings.push({name:'100000 complete three-axis format updates',ms,budgetMs:1000});
  const edit=binding(1.234567891234567),editStart=performance.now();for(let i=0;i<10000;i++){edit.input.focus();edit.fire('keydown',{key:'ArrowUp'});edit.input.blur();}const editMs=performance.now()-editStart;check('10000 completed numeric edit sessions stay below 1 second',()=>{assert(editMs<1000);assert.equal(edit.counts().commits,10000);assert.equal(edit.counts().sets,10000);});timings.push({name:'10000 completed synthetic numeric edit sessions',ms:editMs,budgetMs:1000});
  return {pass:true,checks,timings,indexSHA256:createHash('sha256').update(html).digest('hex'),scope:'CPU shipped numeric formatter and numeric event handlers; native browser/GPU checks are separate.'};
 }catch(error){return {pass:false,checks,timings,error:error.stack,indexSHA256:createHash('sha256').update(html).digest('hex')};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const r=await numericDisplayChecks();await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/numeric-display.json',import.meta.url),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;}
