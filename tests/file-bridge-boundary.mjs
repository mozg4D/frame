import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {attachFileBridge} from '../tools/file-bridge.mjs';
// Execute the real attachment lifecycle against a controllable Playwright-shaped page.
const page=new EventEmitter(),bindings=new Map(),context=vm.createContext({window:{}});let url='https://example.test/frame/';const main={url:()=>url};
page.url=()=>url;page.mainFrame=()=>main;page.evaluate=(fn,arg)=>{context.arg=arg;return Promise.resolve(vm.runInContext(`(${fn})(arg)`,context));};page.exposeBinding=async(name,fn)=>{assert.ok(!bindings.has(name));bindings.set(name,fn);context.window[name]=a=>fn({page,frame:main},a);};
let bridge=await attachFileBridge(page,[]),first=bindings.values().next().value;
await assert.rejects(first({page,frame:{url:()=>url}},{op:'beginRead',path:'/ungranted'}),/selected Frame document/);
await assert.rejects(first({page:{},frame:main},{op:'beginRead',path:'/ungranted'}),/selected Frame document/);
await bridge.close();await assert.rejects(first({page,frame:main},{}),/selected Frame document/);
bridge=await attachFileBridge(page,[]);assert.equal(bindings.size,2);assert.equal(typeof context.window.__frameFileHost,'function');
url='https://example.test/unrelated/';const second=[...bindings.values()][1];await assert.rejects(second({page,frame:main},{}),/selected Frame document/);
page.emit('framenavigated',main);await bridge.close();await assert.rejects(second({page,frame:main},{}),/selected Frame document/);
url='https://example.test/frame/';await assert.rejects(second({page,frame:main},{}),/selected Frame document/);
console.log(JSON.stringify({pass:true,checks:8,scope:'host attachment lifecycle, wrong page/frame, same-origin navigation, reconnect and revocation'}));
