/** Opaque-lease lifecycle only. The native backend owns magnetic physics and GPU data. */
export function createPhysicalStateController({ initialState, releaseState = () => {} } = {}) {
  const isState = value => value !== null && typeof value === 'object' && typeof value.then !== 'function';
  if (!isState(initialState)) throw new TypeError('initialState must be an opaque state lease');
  if (typeof releaseState !== 'function') throw new TypeError('releaseState must be a function');
  let current = initialState;
  let preceding = initialState;
  let time = null;
  let canRecomputeTime = true;
  let revision = 0;
  let epoch = 0;
  let serial = 0;
  let active = null;
  let disposed = false;
  const releaseErrors = [];
  const retired = new WeakSet();
  const pins = new WeakMap();
  const deferred = new Set();
  const candidates = new WeakMap();
  const stateError = message => Object.assign(new Error(message), { name: 'MagnetoStateError' });
  const checkLive = () => { if (disposed) throw stateError('Controller is disposed'); };
  const finiteTime = value => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Physical time must be finite');
    return value;
  };
  // Every object is one immutable ownership lease. A retired lease cannot be reused.
  const freshState = value => {
    if (!isState(value) || retired.has(value) || deferred.has(value)) throw new TypeError('A live opaque state lease is required');
    return value;
  };
  const release = value => {
    if (!isState(value) || value === current || value === preceding || retired.has(value)) return;
    if (pins.get(value)) { deferred.add(value); return; }
    deferred.delete(value);
    retired.add(value);
    try { releaseState(value); } catch (error) { releaseErrors.push(String(error?.message || error)); }
  };
  const retireOld = values => { for (const value of new Set(values)) release(value); };
  const pin = value => { if (value) pins.set(value, (pins.get(value) || 0) + 1); };
  const unpin = value => {
    if (!value) return;
    const count = (pins.get(value) || 0) - 1;
    if (count > 0) pins.set(value, count); else pins.delete(value);
    if (deferred.has(value)) release(value);
  };
  const inspect = () => Object.freeze({
    time, canRecomputeTime, revision, epoch, disposed, active: active ? active.inspect() : null,
    releaseErrors: [...releaseErrors],
  });
  const cancelActive = reason => { if (active) active.abort(reason); };
  const install = (state, nextTime, recomputeTime = true) => {
    checkLive();
    freshState(state);
    if (state === current || state === preceding || candidates.has(state) || pins.get(state)) {
      throw stateError('Replacement requires an independent state lease');
    }
    const beforeRevision = revision, beforeEpoch = epoch;
    cancelActive('Physical state replaced');
    checkLive();
    if (revision !== beforeRevision || epoch !== beforeEpoch || active) throw stateError('Reentrant physical state change');
    freshState(state);
    const old = [current, preceding];
    current = preceding = state;
    time = nextTime;
    canRecomputeTime = recomputeTime;
    epoch++;
    revision++;
    retireOld(old);
    return inspect();
  };
  function beginStep({ time: requestedTime, signal } = {}) {
    checkLive();
    finiteTime(requestedTime);
    if (time !== null && requestedTime < time) throw stateError('Backward physical time requires a preceding checkpoint restore');
    if (requestedTime === time && !canRecomputeTime) throw stateError('A restored checkpoint must be reused at its time, not physically applied twice');
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      throw new TypeError('signal must be an AbortSignal');
    }
    if (signal?.aborted) throw stateError('Physical step was already aborted');
    const beforeRevision = revision, beforeEpoch = epoch;
    cancelActive('Superseded by a newer physical step');
    checkLive();
    if (revision !== beforeRevision || epoch !== beforeEpoch || active) throw stateError('Reentrant physical state change');
    const sourceRevision = revision;
    const sourceEpoch = epoch;
    // Repeated Solve Frame must not reapply irreversible history to its own result.
    const baseState = requestedTime === time ? preceding : current;
    const controller = new AbortController();
    const id = ++serial;
    let phase = 'open';
    let iteration = 0;
    let busy = false;
    let candidate = null;
    let convergence = null;
    let ready = false;
    const detach = () => signal?.removeEventListener('abort', onAbort);
    const assertCurrent = () => {
      checkLive();
      if (phase !== 'open' || active !== step || revision !== sourceRevision || epoch !== sourceEpoch || controller.signal.aborted) {
        throw stateError('Physical step is closed or stale');
      }
    };
    const onAbort = () => step.abort('External abort');
    const releaseCandidate = value => {
      if (value && candidates.get(value) === step) candidates.delete(value);
      release(value);
    };
    const close = (nextPhase, reason) => {
      if (phase !== 'open') return false;
      phase = nextPhase;
      ready = false;
      detach();
      controller.abort(reason);
      if (active === step) active = null;
      const old = candidate;
      candidate = null;
      convergence = null;
      releaseCandidate(old);
      return true;
    };
    const step = Object.freeze({
      inspect: () => Object.freeze({ id, time: requestedTime, iteration, phase, busy, ready,
        convergence: convergence ? { ...convergence } : null }),
      abort: reason => close('aborted', reason || 'Physical step aborted'),
      async iterate(evaluate) {
        assertCurrent();
        if (busy) throw stateError('A nonlinear iteration is already pending');
        if (typeof evaluate !== 'function') throw new TypeError('evaluate must be a function');
        busy = true;
        ready = false;
        const previousState = candidate;
        const nextIteration = ++iteration;
        const held = [...new Set([baseState, previousState].filter(Boolean))];
        held.forEach(pin);
        let result;
        let resultState;
        try {
          result = await evaluate(Object.freeze({ time: requestedTime, iteration: nextIteration,
            baseState, previousState, signal: controller.signal }));
          resultState = result?.state;
          assertCurrent();
          freshState(resultState);
          if (resultState === baseState || resultState === current || resultState === preceding || resultState === previousState || candidates.has(resultState)) {
            throw stateError('Iteration must return a new independent state lease');
          }
          const { residual, tolerance } = result;
          if (typeof residual !== 'number' || !Number.isFinite(residual) || residual < 0 ||
              typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0) {
            throw new TypeError('Convergence residual and tolerance must be finite and nonnegative');
          }
          assertCurrent();
          candidate = resultState;
          candidates.set(candidate, step);
          convergence = { residual, tolerance, converged: residual <= tolerance };
          ready = true;
          releaseCandidate(previousState);
          return step.inspect();
        } catch (error) {
          // Baselines and the last owned candidate are protected, including stale aliases.
          if (resultState !== candidate && !candidates.has(resultState)) release(resultState);
          throw error;
        } finally { busy = false; held.forEach(unpin); }
      },
      commit() {
        assertCurrent();
        if (busy) throw stateError('Cannot commit while a nonlinear iteration is pending');
        if (!ready || !candidate || !convergence?.converged) throw stateError('A converged final iteration is required');
        const old = [current, preceding];
        preceding = baseState;
        current = candidate;
        candidates.delete(candidate);
        candidate = null;
        time = requestedTime;
        canRecomputeTime = true;
        revision++;
        phase = 'committed';
        ready = false;
        detach();
        active = null;
        // Synchronous swap above is the only physical publication point.
        retireOld(old);
        return inspect();
      },
    });
    active = step;
    signal?.addEventListener('abort', onAbort, { once: true });
    // A custom signal can abort synchronously during addEventListener.
    if (signal?.aborted) step.abort('External abort');
    return step;
  }
  return Object.freeze({
    beginStep, inspect,
    invalidate() { checkLive(); epoch++; cancelActive('Authoring changed'); return inspect(); },
    clearTransient() { checkLive(); cancelActive('Transient work cleared'); return inspect(); },
    reset({ state } = {}) { return install(state, time); },
    restoreCheckpoint({ state, time: checkpointTime } = {}) { finiteTime(checkpointTime); return install(state, checkpointTime, false); },
    dispose() {
      if (disposed) return false;
      disposed = true;
      epoch++;
      cancelActive('Controller disposed');
      const old = [current, preceding];
      current = preceding = null;
      retireOld(old);
      return true;
    },
  });
}
