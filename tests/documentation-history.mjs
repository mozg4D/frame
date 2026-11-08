import assert from 'node:assert/strict';
import {history} from '../core/documentation-history.mjs';
const checks=[];const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks.push(name);};
const s=(start,end=start)=>({start,end,direction:'none'});
let h=history();h.reset('');let text='',time=0;
function type(value,type='insertText'){const before=text;text+=value;h.record(before,text,s(before.length),s(text.length),type,time+=100);}
type('с');type('л');type('о');type('в');type('о');type('\n','insertLineBreak');check('Enter is an independent step',h.step().text,'слово');check('Cyrillic word is one typing step',h.step().text,'');check('Undo exhausted does not invent changes',h.step(),null);check('Redo restores whole word',h.step(false).text,'слово');check('Redo restores Enter separately',h.step(false).text,'слово\n');
h=history();h.reset('old');h.record('old','old word',s(3),s(8),'insertFromPaste',1);h.remote('PREFIX old word');check('Disjoint remote prefix keeps local undo',h.step().text,'PREFIX old');check('Redo retains remote prefix',h.step(false).text,'PREFIX old word');
h.remote('PREFIX old word END');check('Second disjoint remote suffix is retained by undo',h.step().text,'PREFIX old END');h.remote('START PREFIX old END');check('Remote update transforms redo entries',h.step(false).text,'START PREFIX old word END');
h=history();h.reset('old');h.record('old','old word',s(3),s(8),'insertFromPaste',1);h.record('old word','old word\n',s(8),s(9),'insertLineBreak',2);h.remote('new word\n');check('Overlapping old base remote replacement does not destroy safe later newline undo',h.step().text,'new word');check('Disjoint old local insertion still undoable',h.step().text,'new');
h=history();h.reset('hello');h.record('hello','hello word',s(5),s(10),'insertText',1);h.record('hello word','hello word\n',s(10),s(11),'insertLineBreak',2);h.remote('hello WORD\n');check('Remote overlapping local word retains newer newline undo',h.step().text,'hello WORD');check('Overlapping old typing is not reverted',h.step(),null);
h=history();h.reset('abc');h.record('abc','ab',s(3),s(2),'deleteContentBackward',1);h.record('ab','a',s(2),s(1),'deleteContentBackward',2);check('Consecutive backspace is one step',h.step().text,'abc');check('Deletion redo is exact',h.step(false).text,'a');
h=history();h.reset('abc');h.record('abc','bc',s(0),s(0),'deleteContentForward',1);h.record('bc','c',s(0),s(0),'deleteContentForward',2);check('Consecutive Delete is one step',h.step().text,'abc');
h=history();h.reset('A');h.record('A','Aone',s(1),s(4),'insertText',1);h.breakGroup();h.record('Aone','Aonetwo',s(4),s(7),'insertText',2);check('Explicit boundary stops grouping',h.step().text,'Aone');h.record('Aone','Aone new',s(4),s(8),'insertFromPaste',3);check('New edit clears redo',h.step(false),null);h.reset('other scene');check('Scene reset clears old undo',h.step(),null);
h=history({limit:3,maxCharacters:5});h.reset('');text='';time=0;for(let i=0;i<10;i++)type(String(i),'insertFromPaste');check('History count is bounded',h.state.undo,3);check('History payload is bounded',h.state.characters<=5,true);
h=history();h.reset('start');h.record('start','start Ω',s(5),s(7),'insertCompositionText',1);check('Composition is a single transaction',h.step().text,'start');
console.log(JSON.stringify({pass:true,assertions:checks.length,checks},null,2));
// Deterministic independent text oracle: unrelated prefix/suffix must survive
// the whole undo/redo chain, including patches at the old document boundaries.
for(let caseSeed=1;caseSeed<=25;caseSeed++){
 let seed=caseSeed;
 const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
 const engine=history(),states=['BASE'],sels=[s(4)];let value='BASE';engine.reset(value);
 for(let i=0;i<20;i++){const p=random()%(value.length+1),next=value.slice(0,p)+String.fromCharCode(97+i)+value.slice(p);engine.record(value,next,s(p),s(p+1),'insertFromPaste',i);value=next;states.push(value);sels.push(s(p+1));}
 engine.remote('PREFIX '+value);engine.remote('PREFIX '+value+' SUFFIX');
 for(let i=19;i>=0;i--){const step=engine.step();assert.equal(step?.text,'PREFIX '+states[i]+' SUFFIX');}
 for(let i=1;i<=20;i++){const step=engine.step(false);assert.equal(step?.text,'PREFIX '+states[i]+' SUFFIX');}

}
const large=history(),base='x'.repeat(1024*1024-256);large.reset(base);let current=base;const timings=[];let begin=performance.now();
for(let i=0;i<128;i++){const next=current+'a';large.record(current,next,s(current.length),s(next.length),'insertFromPaste',i);current=next;}
timings.push({name:'128 completed 1-MiB document history writes',ms:performance.now()-begin,budgetMs:5000});
begin=performance.now();large.remote('PRE'+current);timings.push({name:'Remote transform across 128 entries at document limit',ms:performance.now()-begin,budgetMs:100});
begin=performance.now();for(let i=0;i<128;i++)assert.ok(large.step());timings.push({name:'128 completed history undo operations',ms:performance.now()-begin,budgetMs:1000});
for(const t of timings)assert.ok(t.ms<t.budgetMs,t.name);assert.equal(large.state.text,'PRE'+base);console.log(JSON.stringify({pass:true,oracleUndoRedoChecks:1000,timings},null,2));
