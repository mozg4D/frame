import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {evaluatePowerLedger, MAX_POWER_LEDGER_SOURCES} from '../validation/power-ledger.js';

const hash = n => n.toString(16).padStart(32, '0');
const source = (n, emittedWatts) => ({hash:hash(n), emittedWatts});
const terminal = (n, patch = {}) => ({sourceHash:hash(n), usefulWatts:0, unwantedWatts:0, absorbedWatts:0, escapedWatts:0, unresolvedWatts:0, ...patch});
const ledger = (sources = [source(1, 10)], terminals = [terminal(1, {usefulWatts:10})], tolerance = {absoluteWatts:0, relative:0}) => ({sources, terminals, tolerance});
const invalid = input => assert.throws(() => evaluatePowerLedger(input), {code:'OPTICS_LEDGER_INVALID'});
const overflow = input => assert.throws(() => evaluatePowerLedger(input), {code:'OPTICS_LEDGER_OVERFLOW'});

test('unequal explicit source powers retain all five terminal channels and native references', () => {
  const result = evaluatePowerLedger(ledger([source(1, 10), source(2, 90)], [terminal(2, {usefulWatts:72, unwantedWatts:8, absorbedWatts:5, escapedWatts:4, unresolvedWatts:1}), terminal(1, {usefulWatts:1, unwantedWatts:2, absorbedWatts:3, escapedWatts:1, unresolvedWatts:3})]));
  assert.deepEqual(result.sources.map(s => s.sourceHash), [hash(1), hash(2)]);
  assert.deepEqual(result.sources.map(s => s.emittedWatts), [10, 90]);
  assert.equal(result.totals.emittedWatts, 100);
  assert.equal(result.totals.usefulWatts, 73);
  assert.equal(result.totals.unwantedWatts, 10);
  assert.equal(result.totals.absorbedWatts, 8);
  assert.equal(result.totals.escapedWatts, 5);
  assert.equal(result.totals.unresolvedWatts, 4);
  assert.equal(result.totals.unresolvedFraction, .04);
  assert.equal(result.sources[0].unresolvedFraction, .3);
  assert.equal(result.totals.residualWatts, 0);
  assert.equal(result.balanced, true);
  assert.equal(result.solverCertified, false);
  assert.equal(result.physicalQualified, false);
});

test('missing and excess power stay signed residuals; unresolved fraction is never renormalized or clamped', () => {
  const missing = evaluatePowerLedger(ledger([source(1, 10)], [terminal(1, {usefulWatts:2, unresolvedWatts:3})]));
  assert.equal(missing.totals.residualWatts, 5);
  assert.equal(missing.totals.unresolvedFraction, .3);
  assert.equal(missing.balanced, false);
  const excess = evaluatePowerLedger(ledger([source(1, 10)], [terminal(1, {unresolvedWatts:20})]));
  assert.equal(excess.totals.residualWatts, -10);
  assert.equal(excess.totals.unresolvedFraction, 2);
  assert.equal(excess.balanced, false);
  const unresolved = evaluatePowerLedger(ledger([source(1, 10)], [terminal(1, {unresolvedWatts:10})]));
  assert.equal(unresolved.balanced, true);
  assert.equal(unresolved.totals.unresolvedFraction, 1);
  assert.equal(unresolved.physicalQualified, false);
});

test('opposing source errors cannot hide behind global balance', () => {
  const result = evaluatePowerLedger(ledger([source(1, 10), source(2, 10)], [terminal(1, {usefulWatts:15}), terminal(2, {usefulWatts:5})]));
  assert.equal(result.totals.balanced, true);
  assert.deepEqual(result.sources.map(s => s.residualWatts), [-5, 5]);
  assert.deepEqual(result.sources.map(s => s.balanced), [false, false]);
  assert.equal(result.balanced, false);
});

test('explicit inclusive absolute and source-relative tolerances also apply to global residual', () => {
  const input = ledger([source(1, 8)], [terminal(1, {usefulWatts:6})], {absoluteWatts:1, relative:.125});
  assert.equal(evaluatePowerLedger(input).totals.toleranceWatts, 2);
  assert.equal(evaluatePowerLedger(input).balanced, true);
  input.terminals[0].usefulWatts = 6 - 2 ** -48;
  assert.equal(evaluatePowerLedger(input).balanced, false);
  const global = evaluatePowerLedger(ledger([source(1, 8), source(2, 8)], [terminal(1, {usefulWatts:7}), terminal(2, {usefulWatts:7})], {absoluteWatts:1, relative:0}));
  assert.ok(global.sources.every(s => s.balanced));
  assert.equal(global.totals.balanced, false);
  assert.equal(global.balanced, false);
});

test('zero and empty sources have null fractions without physical qualification', () => {
  for (const input of [ledger([], []), ledger([source(1, 0)], [terminal(1)]), ledger([source(1, -0)], [terminal(1, {unresolvedWatts:-0})])]) {
    const result = evaluatePowerLedger(input);
    assert.equal(result.balanced, true);
    assert.equal(result.totals.hasSourcePower, false);
    assert.equal(result.totals.unresolvedFraction, null);
    assert.equal(result.physicalQualified, false);
    assert.equal(result.solverCertified, false);
    assert.equal(result.totals.emittedWatts, 0);
    assert.equal(result.totals.residualWatts, 0);
  }
  const result = evaluatePowerLedger(ledger([source(1, 0)], [terminal(1, {usefulWatts:Number.MIN_VALUE})], {absoluteWatts:1, relative:1}));
  assert.equal(result.balanced, false);
  assert.equal(result.totals.unresolvedFraction, null);
  assert.equal(result.totals.residualWatts, -Number.MIN_VALUE);
});

test('duplicate, missing, foreign and noncanonical source references reject', () => {
  invalid(ledger([source(1, 1), source(1, 2)], [terminal(1), terminal(1)]));
  invalid(ledger([source(1, 1), source(2, 2)], [terminal(1), terminal(1)]));
  invalid(ledger([source(1, 1)], []));
  invalid(ledger([], [terminal(1)]));
  invalid(ledger([source(1, 1)], [terminal(2)]));
  for (const id of ['', 'source', 'a'.repeat(31), 'a'.repeat(33), 'A'.repeat(32), 'g'.repeat(32), 1, null]) {
    invalid(ledger([{hash:id, emittedWatts:1}], [terminal(1)]));
    invalid(ledger([source(1, 1)], [terminal(1, {sourceHash:id})]));
  }
});

test('every watt and tolerance field rejects negative, nonfinite and nonnumeric values', () => {
  const bad = [-1, NaN, Infinity, -Infinity, '1', null, undefined, true, 1n];
  for (const value of bad) {
    invalid(ledger([{hash:hash(1), emittedWatts:value}]));
    for (const key of ['usefulWatts', 'unwantedWatts', 'absorbedWatts', 'escapedWatts', 'unresolvedWatts']) invalid(ledger(undefined, [terminal(1, {[key]:value})]));
    invalid(ledger(undefined, undefined, {absoluteWatts:value, relative:0}));
    invalid(ledger(undefined, undefined, {absoluteWatts:0, relative:value}));
  }
});

test('strict records reject unknown, omitted, inherited and accessor fields without invoking getters', () => {
  for (const value of [null, undefined, [], 'ledger', 1, new Date()]) invalid(value);
  for (const key of ['sources', 'terminals', 'tolerance']) { const input = ledger(); delete input[key]; invalid(input); }
  for (const key of ['hash', 'emittedWatts']) { const input = ledger(); delete input.sources[0][key]; invalid(input); }
  for (const key of Object.keys(terminal(1))) { const input = ledger(); delete input.terminals[0][key]; invalid(input); }
  for (const key of ['absoluteWatts', 'relative']) { const input = ledger(); delete input.tolerance[key]; invalid(input); }
  for (const select of [x => x, x => x.sources[0], x => x.terminals[0], x => x.tolerance]) {
    const input = ledger(); select(input).unexpected = 1; invalid(input);
  }
  const symbol = ledger(); symbol.sources[0][Symbol('extra')] = 1; invalid(symbol);
  invalid(ledger([Object.create(source(1, 10))]));
  let reads = 0;
  const accessor = ledger(); Object.defineProperty(accessor.sources[0], 'emittedWatts', {get() { reads++; return 10; }});
  invalid(accessor); assert.equal(reads, 0);
  invalid(ledger({}, [])); invalid(ledger([], {}));
  invalid(ledger(new Array(1), [terminal(1)])); invalid(ledger([source(1, 10)], new Array(1)));
});

test('bounded records reject oversized input before accessing source records', () => {
  const sources = new Array(MAX_POWER_LEDGER_SOURCES + 1), terminals = new Array(sources.length);
  let reads = 0; Object.defineProperty(sources, 0, {get() { reads++; throw new Error('must not read'); }});
  invalid(ledger(sources, terminals)); assert.equal(reads, 0);
});

test('source and terminal arrays reject iterators, accessors, holes and custom properties before execution', () => {
  for (const key of ['sources', 'terminals']) {
    let calls = 0;
    const iterator = ledger();
    iterator[key][Symbol.iterator] = () => { calls++; throw new Error('must not iterate'); };
    invalid(iterator); assert.equal(calls, 0);
    const accessor = ledger();
    Object.defineProperty(accessor[key], 0, {get() { calls++; throw new Error('must not read'); }});
    invalid(accessor); assert.equal(calls, 0);
    const sparse = ledger(); delete sparse[key][0]; invalid(sparse);
    for (const property of ['extra', Symbol('extra')]) {
      const extra = ledger(); extra[key][property] = 1; invalid(extra);
    }
    const inherited = ledger();
    Object.setPrototypeOf(inherited[key], Object.create(Array.prototype)); invalid(inherited);
  }
});

test('overflow in source, channel, cross-channel, tolerance and fraction arithmetic rejects', () => {
  const max = Number.MAX_VALUE;
  overflow(ledger([source(1, max), source(2, max)], [terminal(1), terminal(2)]));
  overflow(ledger([source(1, 1), source(2, 1)], [terminal(1, {usefulWatts:max}), terminal(2, {usefulWatts:max})]));
  overflow(ledger([source(1, 1)], [terminal(1, {usefulWatts:max, absorbedWatts:max})]));
  overflow(ledger([source(1, 1), source(2, 1)], [terminal(1, {usefulWatts:max}), terminal(2, {absorbedWatts:max})]));
  overflow(ledger([source(1, max)], [terminal(1)], {absoluteWatts:0, relative:2}));
  overflow(ledger([source(1, max)], [terminal(1)], {absoluteWatts:max, relative:1}));
  overflow(ledger([source(1, Number.MIN_VALUE)], [terminal(1, {unresolvedWatts:max})]));
});

test('finite extreme values and compensated small contributions preserve accounting', () => {
  for (const watts of [Number.MIN_VALUE, Number.MAX_VALUE]) {
    const result = evaluatePowerLedger(ledger([source(1, watts)], [terminal(1, {unresolvedWatts:watts})]));
    assert.equal(result.balanced, true); assert.equal(result.totals.unresolvedFraction, 1);
    assert.equal(result.totals.emittedWatts, watts);
  }
  const result = evaluatePowerLedger(ledger([source(1, 1e16), source(2, 1), source(3, 1)], [terminal(1, {usefulWatts:1e16}), terminal(2, {absorbedWatts:1}), terminal(3, {absorbedWatts:1})]));
  assert.equal(result.totals.emittedWatts, 1e16 + 2);
  assert.equal(result.totals.accountedWatts, 1e16 + 2);
  assert.equal(result.balanced, true);
});

test('frozen inputs remain untouched and output has no caller-owned record references', () => {
  const input = ledger(), before = structuredClone(input);
  for (const record of [...input.sources, ...input.terminals, input.tolerance, input.sources, input.terminals, input]) Object.freeze(record);
  const result = evaluatePowerLedger(input);
  assert.deepEqual(input, before);
  result.sources[0].emittedWatts = 123; result.tolerance.relative = 123; result.totals.usefulWatts = 123;
  assert.deepEqual(input, before);
  assert.equal(evaluatePowerLedger(input).totals.usefulWatts, 10);
});

test('completed maximum 16,384-source ledger fits the bounded CPU latency budget', t => {
  const count = MAX_POWER_LEDGER_SOURCES;
  const input = ledger(Array.from({length:count}, (_, i) => source(i, 32)), Array.from({length:count}, (_, i) => terminal(count - 1 - i, {usefulWatts:16, unwantedWatts:8, absorbedWatts:4, escapedWatts:2, unresolvedWatts:2})));
  const start = performance.now(), result = evaluatePowerLedger(input), wallMs = performance.now() - start;
  assert.equal(result.sourceCount, count); assert.equal(result.sources.length, count);
  assert.equal(result.sources.at(-1).sourceHash, hash(count - 1));
  assert.equal(result.totals.emittedWatts, count * 32); assert.equal(result.totals.unresolvedFraction, 1 / 16);
  assert.equal(result.balanced, true); assert.equal(result.physicalQualified, false);
  const budgetMs = 1000;
  t.diagnostic(JSON.stringify({operation:'evaluatePowerLedger', sources:count, wallMs, budgetMs, node:process.version, gpuUsed:false}));
  assert.ok(wallMs < budgetMs, `Completed maximum-size ledger took ${wallMs.toFixed(3)} ms (budget ${budgetMs} ms)`);
});
