import {postRuntime} from './source-loader.mjs';
// Source-only known-gap reproduction. This is not a normal Worker transport case:
// structured clone does not preserve getters on reply objects.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const runtime = postRuntime;
const cases = [];
for (const [label, thrown] of [['undefined', undefined], ['null', null], ['zero', 0], ['false', false], ['empty-string', '']]) {
  let worker;
  let active = 0, releases = 0, terminations = 0, revocations = 0, settlements = 0;
  class StubWorker {
    constructor() { worker = this; }
    postMessage() {}
    terminate() { terminations++; }
  }
  const task = Function('Worker', 'frameComputeBudget', 'URL', 'Blob', `
    function prepareSplineBVH() {}
    function frameWireIndices() {}
    const frameImportAbortError = () => Error('aborted');
    ${runtime}
    return frameSTLPostprocessTask;
  `)(StubWorker, {
    async acquire() {
      active++;
      return () => { active--; releases++; };
    }
  }, {
    createObjectURL: () => 'blob:source-only-falsy-validation',
    revokeObjectURL() { revocations++; }
  }, class StubBlob {});

  const operation = task('BVH', {}, []).then(
    value => { settlements++; return { direction: 'resolved', value }; },
    error => { settlements++; return { direction: 'rejected', error }; }
  );
  await new Promise(setImmediate);
  assert(worker, 'Task must create its controlled worker');
  const data = { kind: 'BVH' };
  Object.defineProperty(data, 'id', { get() { throw thrown; } });
  assert.doesNotThrow(() => worker.onmessage({ data }));
  let timeout;
  const result = await Promise.race([
    operation,
    new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Task did not settle')), 1000); })
  ]).finally(() => clearTimeout(timeout));

  // Assert the known gap explicitly, rather than describing this as acceptance.
  assert.equal(result.direction, 'resolved', 'Known gap: falsy exceptions are treated as success');
  assert.equal(result.value, undefined);
  assert.equal(settlements, 1);
  assert.equal(active, 0);
  assert.equal(releases, 1);
  assert.equal(terminations, 1);
  assert.equal(revocations, 1);
  cases.push({ thrown: label, direction: result.direction, resolvedUndefined: true,
    settlements, active, releases, terminations, revocations, balancedCleanup: true });
}

export default {
  knownGapReproduced: true,
  acceptancePass: false,
  scope: 'Five controlled falsy-throwing getters; impossible to preserve through ordinary Worker structured clone',
  cases
};
