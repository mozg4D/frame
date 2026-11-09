/**
 * Unloaded compact-result accounting; not a scene solver or transport certificate.
 * evaluatePowerLedger({
 *   sources: [{hash, emittedWatts}],
 *   terminals: [{sourceHash, usefulWatts, unwantedWatts, absorbedWatts,
 *                escapedWatts, unresolvedWatts}],
 *   tolerance: {absoluteWatts, relative}
 * })
 *
 * Records have exactly these own data fields. Source/terminal lists are dense
 * plain arrays with own data indices and no extra properties or symbols.
 * Caller-supplied iterators/accessors are rejected, not executed. JavaScript
 * proxies are unsupported; validation is not a sandbox for executable objects.
 * Hashes are canonical native
 * lowercase 32-hex identities. Each source needs exactly one terminal aggregate,
 * including zero-power sources; all five channels must be explicit. The producer
 * must partition terminal power into disjoint channels: useful/unwanted receiver
 * power, absorption, escape and unresolved transport (including interaction or
 * resource limits). This helper cannot prove that partition from aggregates.
 * Missing power stays a signed residual; it is never silently made unresolved.
 *
 * All numeric inputs are finite and nonnegative; tolerances are explicit.
 * Per-source and total tolerance = absoluteWatts + relative * emittedWatts.
 * Relative fractions use original emitted power, never accounted power, and are
 * null at zero emission. Any positive terminal power at zero emission is
 * unbalanced regardless of tolerance. Empty/zero ledgers may balance arithmetic
 * but have hasSourcePower:false; physicalQualified and solverCertified are always
 * false, even when balanced and unresolvedWatts is zero. No scene lookup, native
 * source eligibility/freshness check, GPU access or ray/geometry mirror occurs.
 *
 * O(source count) bounded work/storage; no input mutation or retained references.
 * Finite arithmetic overflow throws, rather than returning Infinity/NaN or
 * clamping. IEEE-754 rounding/underflow remain numerical limits, not proofs.
 */
export const MAX_POWER_LEDGER_SOURCES = 16384;
const channels = ['usefulWatts', 'unwantedWatts', 'absorbedWatts', 'escapedWatts', 'unresolvedWatts'];
const sourceKeys = ['hash', 'emittedWatts'], terminalKeys = ['sourceHash', ...channels];
const invalid = message => { throw Object.assign(new TypeError(message), {code:'OPTICS_LEDGER_INVALID'}); };
const finite = value => {
  if (!Number.isFinite(value)) throw Object.assign(new RangeError('Power ledger arithmetic overflow'), {code:'OPTICS_LEDGER_OVERFLOW'});
  return value;
};
function record(value, keys, label) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length)
    invalid(label + ' must contain exactly the declared fields');
  for (const key of keys) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) || {}, 'value'))
    invalid(label + '.' + key + ' must be an own data field');
}
function nonnegative(value, label) {
  if (!Number.isFinite(value) || value < 0) invalid(label + ' must be finite and nonnegative');
  return value === 0 ? 0 : value;
}
function array(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    invalid(label + ' must be a plain array');
  const count = value.length;
  if (count > MAX_POWER_LEDGER_SOURCES) invalid(label + ' exceeds 16384 records');
  if (Reflect.ownKeys(value).length !== count + 1) invalid(label + ' must be dense without extra properties');
  for (let i = 0; i < count; i++) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, i) || {}, 'value'))
    invalid(label + ' must contain only own data indices');
  return count;
}
function hash(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) invalid('Expected a canonical native source hash');
  return value;
}
// Compensated positive sums retain small contributions across many sources.
const accumulator = () => ({sum:0, correction:0});
function add(a, value) {
  const next = finite(a.sum + value);
  a.correction = finite(a.correction + (a.sum >= value ? (a.sum - next) + value : (value - next) + a.sum));
  a.sum = next;
}
const total = a => finite(a.sum + a.correction);
function summarize(emittedWatts, watts, tolerance) {
  const sum = accumulator();
  for (const channel of channels) add(sum, watts[channel]);
  const accountedWatts = total(sum), residualWatts = emittedWatts - accountedWatts;
  const toleranceWatts = finite(tolerance.absoluteWatts + finite(tolerance.relative * emittedWatts));
  return {
    emittedWatts, ...watts, accountedWatts, residualWatts, toleranceWatts,
    unresolvedFraction: emittedWatts > 0 ? finite(watts.unresolvedWatts / emittedWatts) : null,
    hasSourcePower: emittedWatts > 0,
    balanced: (emittedWatts > 0 || accountedWatts === 0) && Math.abs(residualWatts) <= toleranceWatts
  };
}
export function evaluatePowerLedger(input) {
  record(input, ['sources', 'terminals', 'tolerance'], 'Ledger');
  record(input.tolerance, ['absoluteWatts', 'relative'], 'Tolerance');
  const tolerance = {
    absoluteWatts:nonnegative(input.tolerance.absoluteWatts, 'Tolerance.absoluteWatts'),
    relative:nonnegative(input.tolerance.relative, 'Tolerance.relative')
  };
  const {sources, terminals} = input;
  const count = array(sources, 'Sources');
  if (array(terminals, 'Terminals') !== count) invalid('Expected one terminal aggregate per source');
  const byHash = new Map(), emitted = accumulator(), sums = channels.map(accumulator);
  for (let i = 0; i < count; i++) {
    const source = sources[i];
    record(source, sourceKeys, 'Source');
    const id = hash(source.hash), power = nonnegative(source.emittedWatts, 'Source.emittedWatts');
    if (byHash.has(id)) invalid('Duplicate source hash');
    byHash.set(id, {power, result:null});
    add(emitted, power);
  }
  for (let i = 0; i < count; i++) {
    const terminal = terminals[i];
    record(terminal, terminalKeys, 'Terminal');
    const id = hash(terminal.sourceHash), source = byHash.get(id);
    if (!source) invalid('Terminal references an unknown source');
    if (source.result) invalid('Duplicate terminal aggregate');
    const watts = {};
    for (let i = 0; i < channels.length; i++) {
      const key = channels[i];
      watts[key] = nonnegative(terminal[key], 'Terminal.' + key);
      add(sums[i], watts[key]);
    }
    source.result = {sourceHash:id, ...summarize(source.power, watts, tolerance)};
  }
  const results = Array.from(byHash.values(), source => source.result);
  const totals = summarize(total(emitted), Object.fromEntries(channels.map((key, i) => [key, total(sums[i])])), tolerance);
  return {
    sourceCount:results.length, tolerance, sources:results, totals,
    balanced:totals.balanced && results.every(source => source.balanced),
    solverCertified:false, physicalQualified:false
  };
}
