/** Explicit, bounded closed graph oracle. Does not inspect or preprocess native geometry. */
const MAX_NODES = 32, MAX_EDGES = 64, MIN_RESISTANCE_RATIO = 1e-12, RESIDUAL_LIMIT = 2e-10;
const graphs = new WeakSet(), solutions = new WeakMap();
const frozen = xs => Object.freeze(xs);
function fields(x, names, label) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(x)) if (!names.includes(key)) throw new TypeError(`Unsupported ${label} field: ${key}`);
}
function finite(x, label) {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError(`${label} must be finite`);
  return x;
}
function positive(x, label) {
  finite(x, label);
  if (x <= 0) throw new RangeError(`${label} must be positive`);
  return x;
}
function identifier(x, label) {
  if (typeof x !== 'string' || !x.length || x.length > 256) throw new TypeError(`${label} must be a nonempty identifier`);
  return x;
}
function vector(x, label) {
  if (!Array.isArray(x) || x.length !== 3) throw new TypeError(`${label} must be vec3`);
  return frozen(Array.from(x, v => finite(v, label)));
}
function representable(x, label, nonzero = false) {
  if (!Number.isFinite(x) || (nonzero && x === 0)) throw new RangeError(`${label} is outside representable numerical scale`);
  return x;
}
// Log products avoid overflowing intermediates when the final positive quantity is representable.
function expProduct(log, label) { return representable(Math.exp(log), label, true); }
function sum(xs) { let s = 0, c = 0; for (const x of xs) { const y = x - c, t = s + y; c = (t - s) - y; s = t; } return s; }
const dot = (a, b) => sum(a.map((v, i) => v * b[i]));
function assertGraph(graph) { if (!graphs.has(graph)) throw new TypeError('Use createConductorGraph'); }

export const CONDUCTOR_CURRENT_CAPABILITIES = frozen({backend: 'CPU_EXPLICIT_GRAPH_REFERENCE', maxNodes: MAX_NODES,
  maxEdges: MAX_EDGES, minResistanceRatio: MIN_RESISTANCE_RATIO, nativeGeometry: false,
  arbitraryPolygonPreprocessing: false, continuumCurrentDensity: false, sourceReactionLoads: false});

export function createConductorGraph(input) {
  fields(input, ['units', 'nodes', 'edges', 'cut'], 'graph');
  if (input.units !== 'SI') throw new TypeError('Graph must explicitly use SI units');
  if (!Array.isArray(input.nodes) || input.nodes.length < 2 || input.nodes.length > MAX_NODES) throw new RangeError(`Graph requires 2..${MAX_NODES} nodes`);
  const nodes = Array.from(input.nodes, n => identifier(n, 'node id'));
  if (new Set(nodes).size !== nodes.length) throw new TypeError('Duplicate node id');
  const nodeIndex = new Map(nodes.map((n, i) => [n, i])), edgeIds = new Set();
  if (!Array.isArray(input.edges) || !input.edges.length || input.edges.length > MAX_EDGES) throw new RangeError(`Graph requires 1..${MAX_EDGES} edges`);
  const edges = Array.from(input.edges, e => {
    fields(e, ['id', 'from', 'to', 'length', 'area', 'conductivity', 'localPosition', 'direction'], 'edge');
    identifier(e.id, 'edge id');
    if (edgeIds.has(e.id)) throw new TypeError('Duplicate edge id');
    edgeIds.add(e.id);
    if (!nodeIndex.has(e.from) || !nodeIndex.has(e.to) || e.from === e.to) throw new TypeError('Edges require two distinct known nodes; self loops are unsupported');
    const length = positive(e.length, 'length'), area = positive(e.area, 'area'), conductivity = positive(e.conductivity, 'conductivity');
    const resistance = expProduct(Math.log(length) - Math.log(area) - Math.log(conductivity), 'edge resistance');
    let geometry = {};
    if (e.localPosition !== undefined || e.direction !== undefined) {
      const localPosition = vector(e.localPosition, 'localPosition'), direction = vector(e.direction, 'direction');
      if (Math.abs(Math.hypot(...direction) - 1) > 1e-12) throw new RangeError('direction must be a unit vector from from to to');
      geometry = {localPosition, direction};
    }
    return frozen({id: e.id, from: e.from, to: e.to, length, area, conductivity, resistance, ...geometry});
  });
  const resistanceScale = Math.max(...edges.map(e => e.resistance));
  if (Math.min(...edges.map(e => e.resistance / resistanceScale)) < MIN_RESISTANCE_RATIO) throw new RangeError('Resistance dynamic range exceeds bounded reference capacity');
  fields(input.cut, ['edges'], 'cut');
  if (!Array.isArray(input.cut.edges) || !input.cut.edges.length || input.cut.edges.length > edges.length) throw new RangeError('Cut requires a nonempty list of distinct graph edges');
  const cutIds = new Set(), edgeIndex = new Map(edges.map((e, i) => [e.id, i]));
  const cut = Array.from(input.cut.edges, entry => {
    fields(entry, ['edgeId', 'sign'], 'cut entry');
    if (!edgeIndex.has(entry.edgeId) || cutIds.has(entry.edgeId)) throw new TypeError('Cut edges must be known and unique');
    if (entry.sign !== 1 && entry.sign !== -1) throw new TypeError('Cut sign must be +1 or -1');
    cutIds.add(entry.edgeId);
    return frozen({edgeId: entry.edgeId, sign: entry.sign});
  });
  const cutArea = representable(sum(cut.map(e => edges[edgeIndex.get(e.edgeId)].area)), 'cut area', true);
  const graph = frozen({units: 'SI', nodes: frozen(nodes), edges: frozen(edges), cut: frozen(cut), cutArea, resistanceScale});
  graphs.add(graph);
  return graph;
}

// Fundamental cycles of a spanning forest; each chord and its unique tree return path
// have integer signed flows. Therefore every column is exactly divergence-free.
function cycleBasis(graph) {
  const n = graph.nodes.length, m = graph.edges.length;
  const index = new Map(graph.nodes.map((id, i) => [id, i]));
  const parent = Array.from({length: n}, (_, i) => i), adjacency = Array.from({length: n}, () => []), chords = [];
  const root = i => { while (parent[i] !== i) i = parent[i]; return i; };
  graph.edges.forEach((e, i) => {
    const u = index.get(e.from), v = index.get(e.to), a = root(u), b = root(v);
    if (a === b) chords.push({u, v, i});
    else { parent[a] = b; adjacency[u].push({node: v, edge: i, sign: 1}); adjacency[v].push({node: u, edge: i, sign: -1}); }
  });
  const columns = chords.map(({u, v, i}) => {
    const previous = Array(n).fill(null), queue = [v]; previous[v] = {node: -1};
    for (let at = 0; at < queue.length && previous[u] === null; at++) {
      const node = queue[at];
      for (const step of adjacency[node]) if (previous[step.node] === null) { previous[step.node] = {node, edge: step.edge, sign: step.sign}; queue.push(step.node); }
    }
    if (previous[u] === null) throw new Error('Internal cycle construction failed');
    const z = Array(m).fill(0); z[i] = 1;
    for (let at = u; at !== v; at = previous[at].node) z[previous[at].edge] = previous[at].sign;
    return z;
  });
  return {columns, components: new Set(parent.map((_, i) => root(i))).size,
    edgeComponents: graph.edges.map(e => root(index.get(e.from)))};
}

function choleskySolve(H, rhs) {
  const n = rhs.length, L = Array.from({length: n}, () => Array(n).fill(0));
  const scale = Math.max(...H.map((r, i) => r[i]));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    const value = H[i][j] - sum(Array.from({length: j}, (_, k) => L[i][k] * L[j][k]));
    if (i === j) {
      if (!Number.isFinite(value) || value <= 1e-13 * scale) throw new RangeError('Cycle system is numerically ill-conditioned');
      L[i][j] = Math.sqrt(value);
    } else L[i][j] = representable(value / L[j][j], 'Cholesky coefficient');
  }
  const y = Array(n), x = Array(n);
  for (let i = 0; i < n; i++) y[i] = (rhs[i] - sum(Array.from({length: i}, (_, j) => L[i][j] * y[j]))) / L[i][i];
  for (let i = n - 1; i >= 0; i--) x[i] = representable((y[i] - sum(Array.from({length: n - i - 1}, (_, k) => L[k + i + 1][i] * x[k + i + 1]))) / L[i][i], 'cycle solution');
  return x;
}

export function solveConductorCurrent(graph, options = {}) {
  const start = performance.now(); assertGraph(graph);
  fields(options, ['current'], 'solve option');
  const current = finite(options.current ?? 1, 'signed cut current');
  const {columns: Z, components, edgeComponents} = cycleBasis(graph), m = graph.edges.length;
  const coefficients = graph.edges.map(e => graph.cut.find(c => c.edgeId === e.id)?.sign ?? 0);
  if (new Set(edgeComponents.filter((_, i) => coefficients[i] !== 0)).size !== 1) throw new RangeError('Cut spans disconnected conductors; solve one active conductor at a time');
  const d = Z.map(z => dot(z, coefficients));
  if (!d.some(x => x !== 0)) throw new RangeError('Impossible cut: no closed cycle carries nonzero signed cut flux');
  const r = graph.edges.map(e => e.resistance / graph.resistanceScale);
  const H = Z.map(a => Z.map(b => sum(a.map((v, i) => v * r[i] * b[i]))));
  const x = choleskySolve(H, d), denominator = dot(d, x);
  if (!Number.isFinite(denominator) || denominator <= 0) throw new RangeError('Invalid positive cut conductance');
  const a = x.map(v => v / denominator), lambda = 1 / denominator;
  const unitFlux = Array.from({length: m}, (_, i) => representable(sum(Z.map((z, j) => z[i] * a[j])), 'unit flux'));
  const cutResidual = Math.abs(dot(coefficients, unitFlux) - 1);
  const unitDivergence = graph.nodes.map(n => sum(graph.edges.map((e, i) => e.from === n ? -unitFlux[i] : e.to === n ? unitFlux[i] : 0)));
  const fluxScale = Math.max(1, ...unitFlux.map(Math.abs));
  const conservationResidual = Math.max(...unitDivergence.map(Math.abs)) / fluxScale;
  const gradient = Z.map(z => sum(z.map((v, i) => v * r[i] * unitFlux[i])));
  const stationarityScale = Math.max(...Z.map(z => sum(z.map((v, i) => Math.abs(v * r[i] * unitFlux[i])))), ...d.map(v => Math.abs(lambda * v)));
  const optimalityResidual = Math.max(...gradient.map((v, i) => Math.abs(v - lambda * d[i]))) / stationarityScale;
  if (![cutResidual, conservationResidual, optimalityResidual].every(v => Number.isFinite(v) && v <= RESIDUAL_LIMIT)) throw new RangeError('Current solve failed conservation, cut normalization, or optimality residual check');
  const flux = unitFlux.map(v => representable(v * current, 'edge current', v !== 0 && current !== 0));
  const currentDensity = flux.map((v, i) => representable(v / graph.edges[i].area, 'edge current density', v !== 0));
  const averageCurrentDensity = representable(current / graph.cutArea, 'average cut current density', current !== 0);
  const unitPowerScaled = sum(unitFlux.map((v, i) => r[i] * v * v));
  const effectiveResistance = expProduct(Math.log(graph.resistanceScale) + Math.log(unitPowerScaled), 'effective resistance');
  const dissipatedPower = current === 0 ? 0 : expProduct(Math.log(effectiveResistance) + 2 * Math.log(Math.abs(current)), 'dissipated power');
  const divergence = graph.nodes.map(n => representable(sum(graph.edges.map((e, i) => e.from === n ? -flux[i] : e.to === n ? flux[i] : 0)), 'node divergence'));
  // Verify actual scaled outputs too; a finite amplitude does not guarantee representable physics.
  const scaledFluxScale = Math.max(Math.abs(current), ...flux.map(Math.abs));
  if (current !== 0 && (Math.abs(sum(coefficients.map((c, i) => c * (flux[i] / current))) - 1) > RESIDUAL_LIMIT || Math.max(...divergence.map(v => Math.abs(v / scaledFluxScale))) > RESIDUAL_LIMIT)) throw new RangeError('Scaled flux failed residual check');
  const result = frozen({kind: 'magneto-explicit-graph-current-v1', current, cutArea: graph.cutArea, averageCurrentDensity,
    edgeIds: frozen(graph.edges.map(e => e.id)), unitFlux: frozen(unitFlux), flux: frozen(flux), currentDensity: frozen(currentDensity),
    nodeIds: graph.nodes, divergence: frozen(divergence), effectiveResistance, dissipatedPower,
    metrics: frozen({wallMs: performance.now() - start, nodes: graph.nodes.length, edges: m, cycleRank: Z.length, components,
      cutResidual, conservationResidual, optimalityResidual, residualLimit: RESIDUAL_LIMIT, status: 'CPU_GRAPH_REFERENCE_ONLY'})});
  solutions.set(result, graph); return result;
}

/** Optional explicit one-point-per-straight-tube quadrature adapter. No scene integration. */
export function toReferenceCurrentBasis(graph, solution, options) {
  assertGraph(graph);
  if (solutions.get(solution) !== graph) throw new TypeError('Use a solution issued for this exact graph');
  fields(options, ['id', 'objectId'], 'quadrature option');
  const id = identifier(options.id, 'basis id'), objectId = identifier(options.objectId, 'object id');
  const samples = graph.edges.map((e, i) => {
    if (!e.localPosition || !e.direction) throw new TypeError('Quadrature requires explicit localPosition and direction on every edge');
    const volume = expProduct(Math.log(e.area) + Math.log(e.length), 'tube volume');
    const q = solution.unitFlux[i];
    const amplitude = q === 0 ? 0 : Math.sign(q) * expProduct(Math.log(Math.abs(q)) + Math.log(graph.cutArea) - Math.log(e.area), 'basis density');
    const basisDensity = frozen(e.direction.map(v => representable(v * amplitude, 'basis density vector', v !== 0 && amplitude !== 0)));
    // Reject scales that the downstream scalar-times-vector contract cannot represent.
    basisDensity.forEach(v => representable(v * solution.averageCurrentDensity, 'quadrature current density', v !== 0 && solution.current !== 0));
    return frozen({id: e.id, objectId, localPosition: e.localPosition, basisDensity, volume});
  });
  return frozen({id, density: solution.averageCurrentDensity, samples: frozen(samples)});
}
