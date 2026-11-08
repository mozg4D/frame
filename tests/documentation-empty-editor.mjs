// Actual editor module and sync with minimal CPU DOM/port fixtures. No GPU claim.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {history} from '../core/documentation-history.mjs';
import * as sync from '../core/documentation-sync.mjs';
const source = await readFile(new URL('../core/documentation-editor.mjs', import.meta.url), 'utf8');
class Target {
  listeners = new Map();
  addEventListener(name, fn) {const a = this.listeners.get(name) || []; a.push(fn); this.listeners.set(name, a);}
  fire(name, e = {}) {for (const fn of this.listeners.get(name) || []) fn(e);}
}
const win = new Target(), area = new Target(), sent = [], output = {hidden: true, dataset: {}}, saved = new Map();
Object.assign(area, {value: '', disabled: true, readOnly: false, selectionStart: 0, selectionEnd: 0, selectionDirection: 'none',
  setRangeText(text, start, end) {this.value = this.value.slice(0, start) + text + this.value.slice(end);},
  setSelectionRange(start, end, direction) {Object.assign(this, {selectionStart: start, selectionEnd: end, selectionDirection: direction});}});
win.sessionStorage = {getItem: k => saved.get(k) ?? null, setItem: (k,v) => saved.set(k,v), removeItem: k => saved.delete(k)};
const opener = {closed: false, postMessage() {}}, port = {postMessage: m => sent.push(structuredClone(m)), close() {}};
const context = vm.createContext({...sync, history, performance, installDocumentationGeometry() {}, document: {querySelector: s => s === 'textarea' ? area : output}, window: win, opener,
  location: {hash: '#test', origin: 'https://frame.example'}, setInterval() {}, setTimeout, clearTimeout});
vm.runInContext(source.replace(/^import[^\n]*\n/gm, ''), context);
const check = (name, actual, expected = true) => {assert.deepEqual(actual, expected, name); checks.push(name);};
const checks = [], start = performance.now();
const receive = data => port.onmessage({data});
const snapshot = (text, version) => receive({kind: 'snapshot', state: {text, version}});
const input = text => {area.value = text; area.fire('input');};
const ack = (id, text, version) => receive({kind: 'reply', id, ok: true, state: {text, version}});
check('Editor waits for its initial connection', area.disabled);
win.fire('message', {source: opener, origin: 'https://frame.example', data: {kind: 'frame-docs-connect', token: 'test'}, ports: [port]});
snapshot('', 'first:0');
check('Initial empty document is enabled', area.disabled, false);
check('Initial empty document is writable', area.readOnly, false);
input('First text Ω');
check('First user input is sent from empty document', sent[0].text, 'First text Ω');
check('First write uses current scene version', sent[0].version, 'first:0');
ack(1, 'First text Ω', 'first:1');
input(''); ack(2, '', 'first:2');
check('Acknowledged clearing stays editable', area.disabled || area.readOnly, false);
input('Written again'); check('Typing works after clearing', sent[2].text, 'Written again'); ack(3, 'Written again', 'first:3');
snapshot('', 'second:0');
check('Clean switch to empty scene clears old text', area.value, '');
check('Clean empty scene switch remains editable', area.disabled || area.readOnly, false);
input('New scene text'); check('New empty scene accepts first input', sent[3].text, 'New scene text');
check('New write targets only the new scene', sent[3].version, 'second:0');
snapshot('', 'third:0'); receive({kind: 'reply', id: 4, ok: false, code: 'CONFLICT'});
check('Pending previous-scene draft is retained', area.value, 'New scene text');
check('Pending scene-change conflict stays copy-only', area.readOnly);
check('No old draft is submitted to newer scene', sent.length, 4);
const ms = performance.now() - start;
check('Empty-document lifecycle completes within 1000 ms', ms < 1000);
console.log(JSON.stringify({pass: true, checks, ms, budgetMs: 1000, scope: 'Actual editor and sync with CPU DOM/port fixtures'}, null, 2));
