// Existing Thermal conduction backend, extracted without mathematical changes.
import {snapshotFilmFaces,plainData,filmConductance,validateFilmUpload,normalPhysical} from './exterior-film.js';
import {copyPhysicalFrame} from '../../plugins/thermal/native-frame.js';
export const MAX_CELLS = 262144;
const FACES = ['xMin', 'xMax', 'yMin', 'yMax', 'zMin', 'zMax'];
const error = (code, message) => Object.assign(new Error(message), {code});
const objectSchema = properties => ({type:'object', properties, additionalProperties:false});
const emptySchema = objectSchema({});
const numericArray = (minItems, maxItems, minimum) => ({type:'array', minItems, maxItems, items:{type:'number', ...(minimum === undefined ? {} : {exclusiveMinimum:minimum})}});
export const gridSchema = {...objectSchema({
  dimensions:{type:'array', minItems:3, maxItems:3, items:{type:'integer', minimum:1, maximum:256}},
  cellSize:numericArray(3, 3, 0),
  conductivity:numericArray(1, MAX_CELLS, 0),
  heatCapacity:numericArray(1, MAX_CELLS, 0),
  source:numericArray(1, MAX_CELLS),
  initial:numericArray(1, MAX_CELLS),
  boundary:objectSchema(Object.fromEntries(FACES.map(k => [k, {type:'number', minimum:-273.15}]))),
  boundaryFlux:objectSchema(Object.fromEntries(FACES.map(k => [k, {type:'number'}]))),
  timeStep:{type:'number', exclusiveMinimum:0},
  tolerance:{type:'number', minimum:1e-6, maximum:.1},
  maxIterations:{type:'integer', minimum:1, maximum:20000}
}), required:['dimensions', 'cellSize', 'conductivity']};

// Cell-centred finite volumes. Each shared face has one reciprocal conductance.
// The returned Float64 coefficients are also useful for independent numerical inspection.
export function assembleConduction(input, defaults = {ambient:20, initial:20}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw error('INVALID_ARGUMENT', 'Expected a grid object.');
  for (const key of Object.keys(input)) if (!Object.hasOwn(gridSchema.properties, key)&&key!=='boundaryRobin') throw error('INVALID_ARGUMENT', 'Unknown grid field: '+key);
  const dimensions = input.dimensions;
  if (!Array.isArray(dimensions) || dimensions.length !== 3 || dimensions.some(n => !Number.isInteger(n) || n < 1 || n > 256)) throw error('INVALID_ARGUMENT', 'dimensions must contain three integers from 1 to 256.');
  const count = dimensions.reduce((a,b) => a*b, 1);
  if (count > MAX_CELLS) throw error('GRID_LIMIT', 'The explicit-grid foundation supports at most '+MAX_CELLS+' cells.');
  const cellSize = input.cellSize;
  if (!Array.isArray(cellSize) || cellSize.length !== 3 || cellSize.some(x => !Number.isFinite(x) || x <= 0)) throw error('INVALID_ARGUMENT', 'cellSize must contain three positive metre lengths.');
  const volume = cellSize.reduce((a,b) => a*b, 1);
  if (!Number.isFinite(volume) || volume <= 0) throw error('INVALID_ARGUMENT', 'Invalid physical cell volume.');
  const field = (name, fallback, positive = false, temperature = false) => {
    const values = input[name] ?? fallback;
    if (!Array.isArray(values) || (values.length !== 1 && values.length !== count) || values.some(x => !Number.isFinite(x) || positive && x <= 0 || temperature && x < -273.15)) throw error('INVALID_ARGUMENT', name+' must contain one value or one valid value per cell.');
    return i => values[values.length === 1 ? 0 : i];
  };
  const conductivity = field('conductivity', null, true), capacity = field('heatCapacity', [1e6], true);
  const source = field('source', [0]), temperature = field('initial', [defaults.initial], false, true);
  const robinDescriptor=Object.getOwnPropertyDescriptor(input,'boundaryRobin');
  if('boundaryRobin' in input&&(!robinDescriptor?.enumerable||!Object.hasOwn(robinDescriptor,'value')))throw error('INVALID_ARGUMENT','Robin boundary must be an own enumerable data field.');
  const robin=robinDescriptor?.value===undefined?null:snapshotFilmFaces(robinDescriptor.value,'ambientCelsius'),film=[];
  const flux = input.boundaryFlux ?? {};
  if(robin){plainData(flux,FACES);if(input.boundary!==undefined)plainData(input.boundary,FACES);}
  if (!flux || typeof flux !== 'object' || Array.isArray(flux) || Object.entries(flux).some(([k,v]) => !FACES.includes(k) || !Number.isFinite(v))) throw error('INVALID_ARGUMENT', 'Boundary flux faces must be finite inward heat flux densities in W/m².');
  const boundary = input.boundary ?? Object.fromEntries(FACES.filter(k => !Object.hasOwn(flux, k)&&!Object.hasOwn(robin??{},k)).map(k => [k, defaults.ambient]));
  if (!boundary || typeof boundary !== 'object' || Array.isArray(boundary) || Object.entries(boundary).some(([k,v]) => !FACES.includes(k) || !Number.isFinite(v) || v < -273.15)) throw error('INVALID_ARGUMENT', 'Boundary faces must be finite temperatures in Celsius; omit insulated faces.');
  if (Object.keys(flux).some(k => Object.hasOwn(boundary, k))) throw error('INVALID_ARGUMENT', 'A face cannot prescribe both temperature and heat flux.');
  if(robin&&Object.keys(robin).some(k=>Object.hasOwn(boundary,k)||Object.hasOwn(flux,k)))throw error('INVALID_ARGUMENT','A face cannot combine temperature, heat flux and exterior film, including zero values.');
  const timeStep = input.timeStep;
  if (timeStep !== undefined && (!Number.isFinite(timeStep) || timeStep <= 0)) throw error('INVALID_ARGUMENT', 'timeStep must be positive seconds.');
  if (timeStep === undefined && !Object.keys(boundary).length && !Object.values(robin??{}).some(v=>v.hWPerM2K>0)) throw error('UNANCHORED_DOMAIN', 'An insulated steady domain has no unique temperature. Supply a fixed-temperature/positive-film face or a transient timeStep.');
  const tolerance = input.tolerance ?? 1e-4, maxIterations = input.maxIterations ?? 20000;
  if (!Number.isFinite(tolerance) || tolerance < 1e-6 || tolerance > .1 || !Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 20000) throw error('INVALID_ARGUMENT', 'Invalid numerical convergence limits.');
  const coefficients = new Float64Array(count*8), accounting = new Float64Array(count*4), initial = new Float64Array(count);
  const strides = [1, dimensions[0], dimensions[0]*dimensions[1]];
  let sourcePower = 0, sourceCorrection = 0;
  for (let i=0; i<count; i++) {
    const xyz = [i%dimensions[0], Math.floor(i/dimensions[0])%dimensions[1], Math.floor(i/strides[2])];
    const k = conductivity(i), massRate = timeStep === undefined ? 0 : capacity(i)*volume/timeStep;
    let diagonal = massRate, rhs = source(i)*volume + massRate*temperature(i), boundaryG = 0, boundaryGT = 0;
    const cellPower=source(i)*volume,nextPower=sourcePower+cellPower;
    sourceCorrection+=Math.abs(sourcePower)>=Math.abs(cellPower)?(sourcePower-nextPower)+cellPower:(cellPower-nextPower)+sourcePower;
    sourcePower=nextPower;
    initial[i] = temperature(i);
    for (let axis=0; axis<3; axis++) for (let side=0; side<2; side++) {
      const face = axis*2+side, step = side ? 1 : -1;
      if (xyz[axis]+step >= 0 && xyz[axis]+step < dimensions[axis]) {
        const other = conductivity(i+step*strides[axis]);
        const g = (2/(1/k+1/other))*volume/(cellSize[axis]*cellSize[axis]);
        if (!Number.isFinite(g) || g <= 0) throw error('NUMERICAL_RANGE', 'A face conductance is not representable.');
        coefficients[i*8+face] = g;
        diagonal += g;
      } else if (Object.hasOwn(boundary, FACES[face])) {
        const g = 2*k*volume/(cellSize[axis]*cellSize[axis]);
        if (!Number.isFinite(g) || g <= 0) throw error('NUMERICAL_RANGE', 'A boundary conductance is not representable.');
        diagonal += g;
        rhs += g*boundary[FACES[face]];
        boundaryG += g;
        boundaryGT += g*boundary[FACES[face]];
      } else if (robin&&Object.hasOwn(robin,FACES[face])) {
        const r=robin[FACES[face]],area=cellSize[(axis+1)%3]*cellSize[(axis+2)%3],g=filmConductance(area,cellSize[axis],k,r.hWPerM2K),gt=g*r.ambientCelsius;
        if(g!==0&&(!normalPhysical(gt)&&gt!==0))throw error('NUMERICAL_RANGE','Film bath product underflows.');
        diagonal+=g;rhs+=gt;boundaryG+=g;boundaryGT+=gt;film.push({cell:i,face:FACES[face],g,ambientCelsius:r.ambientCelsius,ambientKelvin:r.ambientCelsius+273.15});
      } else if (Object.hasOwn(flux, FACES[face])) {
        const power = flux[FACES[face]]*volume/cellSize[axis];
        rhs += power;
        // Positive inward flux contributes negative outward boundary power.
        boundaryGT += power;
      }
    }
    coefficients[i*8+6] = diagonal;
    coefficients[i*8+7] = rhs;
    accounting.set([boundaryG, boundaryGT, massRate, temperature(i)], i*4);
    if (!Number.isFinite(diagonal) || diagonal <= 0 || !Number.isFinite(rhs)) throw error('NUMERICAL_RANGE', 'Grid coefficients exceed the supported numerical range.');
  }
  // Fail before any GPU mutation on overflow/underflow of a nonzero coefficient.
  for (const data of [coefficients, accounting, initial]) for (const value of data) {
    const f = Math.fround(value);
    if (!Number.isFinite(f) || value !== 0 && f === 0) throw error('NUMERICAL_RANGE', 'Grid values are not representable in Float32.');
  }
  sourcePower+=sourceCorrection;
  if (!Number.isFinite(sourcePower)) throw error('NUMERICAL_RANGE', 'Source power overflow.');
  const grid={dimensions:[...dimensions], cellSize:[...cellSize], count, volume, coefficients, accounting, initial, sourcePower, timeStep:timeStep ?? null, tolerance, maxIterations};
  if(film.some(e=>e.g>0)){
    for(let i=0;i<count;i++){const c=capacity(i)*volume,p=source(i)*volume;
      if(!normalPhysical(c)||!normalPhysical(c*(temperature(i)+273.15))||temperature(i)<-272.15||temperature(i)>1726.85||timeStep!==undefined&&!normalPhysical(c/timeStep)||source(i)!==0&&(!normalPhysical(p)||timeStep!==undefined&&!normalPhysical(p*timeStep)))throw error('NUMERICAL_RANGE','Exterior-film physical capacity/source/temperature is unsupported.');
      if(p!==0){const rhs=coefficients[i*8+7],represented=Math.fround(rhs)-Math.fround(rhs-p);if(!Number.isFinite(represented)||Math.abs(represented/p-1)>1e-3)throw error('NUMERICAL_RANGE','Source is not resolved after exterior film assembly.');}
    }
    for(const values of [coefficients,accounting,initial])for(const v of values)if(v!==0&&Math.abs(Math.fround(v))<2**-126)throw error('NUMERICAL_RANGE','Exterior-film upload contains a subnormal coefficient.');
  }
  if(robin){validateFilmUpload(grid,film);grid.exteriorFilm=Object.freeze(film.map(Object.freeze));}
  return grid;
}

export const conductionWGSL = `
struct Config { dimensions:vec4u, groups:vec4u };
struct Cell { a:vec4f, b:vec4f };
@group(0) @binding(0) var<storage,read> cells:array<Cell>;
@group(0) @binding(1) var<storage,read> accounts:array<vec4f>;
@group(0) @binding(2) var<storage,read> sourceT:array<f32>;
@group(0) @binding(3) var<storage,read_write> targetT:array<f32>;
@group(0) @binding(4) var<storage,read_write> partials:array<Cell>;
@group(0) @binding(5) var<storage,read_write> summary:array<vec4f>;
@group(0) @binding(6) var<uniform> cfg:Config;
var<workgroup> valuesA:array<vec4f,64>;
var<workgroup> valuesB:array<vec4f,64>;
fn finite(v:f32)->bool { return (bitcast<u32>(v)&0x7f800000u)!=0x7f800000u; }
fn neighbours(i:u32,c:Cell)->f32 {
  let x=i%cfg.dimensions.x; let y=(i/cfg.dimensions.x)%cfg.dimensions.y;
  let stride=cfg.dimensions.x*cfg.dimensions.y; let z=i/stride; var sum=0.;
  if(x>0u){sum+=c.a.x*sourceT[i-1u];} if(x+1u<cfg.dimensions.x){sum+=c.a.y*sourceT[i+1u];}
  if(y>0u){sum+=c.a.z*sourceT[i-cfg.dimensions.x];} if(y+1u<cfg.dimensions.y){sum+=c.a.w*sourceT[i+cfg.dimensions.x];}
  if(z>0u){sum+=c.b.x*sourceT[i-stride];} if(z+1u<cfg.dimensions.z){sum+=c.b.y*sourceT[i+stride];}
  return sum;
}
@compute @workgroup_size(64) fn iterate(@builtin(global_invocation_id) id:vec3u) {
  let i=id.x; if(i>=cfg.dimensions.w){return;} let c=cells[i];
  targetT[i]=sourceT[i]+(2./3.)*((c.b.w+neighbours(i,c))/c.b.z-sourceT[i]);
}
fn reduce(lane:u32) {
  workgroupBarrier(); var stride=32u;
  loop { if(lane<stride){let a=valuesA[lane];let b=valuesA[lane+stride];valuesA[lane]=vec4f(max(a.x,b.x),min(a.y,b.y),max(a.z,b.z),a.w+b.w);valuesB[lane]+=valuesB[lane+stride];}
    workgroupBarrier(); if(stride==1u){break;} stride/=2u;
  }
}
@compute @workgroup_size(64) fn diagnose(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u) {
  var a=vec4f(0.,3.402823e38,-3.402823e38,0.);var b=vec4f(0.);let i=id.x;
  if(i<cfg.dimensions.w){let c=cells[i];let t=sourceT[i];let q=accounts[i];let residual=abs(c.b.z*t-neighbours(i,c)-c.b.w)/c.b.z;
    let outflow=q.x*t-q.y;let storage=q.z*(t-q.w);
    if(finite(t)&&finite(residual)&&finite(outflow)&&finite(storage)){a=vec4f(residual,t,t,outflow);b.x=storage;}else{b.y=1.;}
  }
  valuesA[lane]=a;valuesB[lane]=b;reduce(lane);if(lane==0u){partials[group.x]=Cell(valuesA[0],valuesB[0]);}
}
@compute @workgroup_size(64) fn summarize(@builtin(local_invocation_index) lane:u32) {
  var a=vec4f(0.,3.402823e38,-3.402823e38,0.);var b=vec4f(0.);
  for(var i=lane;i<cfg.groups.x;i+=64u){let p=partials[i];a=vec4f(max(a.x,p.a.x),min(a.y,p.a.y),max(a.z,p.a.z),a.w+p.a.w);b+=p.b;}
  valuesA[lane]=a;valuesB[lane]=b;reduce(lane);if(lane==0u){summary[0]=valuesA[0];summary[1]=valuesB[0];}
}
`;

// Push and pop the shared-device scope stack within one synchronous JS turn.
// Never hold an open scope across an await: other plugins use this same device.
async function checkedGPU(device, work) {
  device.pushErrorScope('validation');device.pushErrorScope('out-of-memory');
  let value, failure;
  try {value=work();} catch(e) {failure=e;}
  const memory=device.popErrorScope(),validation=device.popErrorScope();
  const errors=await Promise.all([memory,validation]);
  if(failure)throw failure;
  const gpuError=errors.find(Boolean);if(gpuError)throw error('GPU_ERROR',gpuError.message);
  return value;
}

// Caller owns the result, but never the borrowed shared device.
export async function solveConductionGPU(device, grid, {check=()=>{}} = {}) {
  check();
  const fieldFrame=grid.fieldFrame?copyPhysicalFrame(grid.fieldFrame):null;
  if (!device) throw error('WEBGPU_REQUIRED', 'Thermal requires the existing Frame WebGPU device.');
  const started = performance.now(), resources = new Set();
  let retained = null, peakBytes = 0, allocatedBytes = 0, readbackBytes = 0;
  const make = (label, size, usage) => {
    if (size > device.limits.maxBufferSize || (usage&GPUBufferUsage.STORAGE) && size > device.limits.maxStorageBufferBindingSize) throw error('GPU_LIMIT', 'Thermal allocation exceeds shared-device limits.');
    const buffer = device.createBuffer({label:'Thermal '+label, size, usage}); resources.add(buffer);
    allocatedBytes += size; peakBytes = Math.max(peakBytes, allocatedBytes); return buffer;
  };
  try {
    const module = device.createShaderModule({label:'Thermal finite-volume conduction', code:conductionWGSL});
    const info = await module.getCompilationInfo();check();
    const errors = info.messages.filter(m => m.type === 'error');
    if (errors.length) throw error('SHADER_COMPILATION', errors.map(m=>m.message).join('; '));
    const entries = [0,1,2,3,4,5,6].map(binding => ({binding, visibility:GPUShaderStage.COMPUTE, buffer:{type:binding===6?'uniform':binding<3?'read-only-storage':'storage'}}));
    const layout = device.createBindGroupLayout({entries}), pipelineLayout = device.createPipelineLayout({bindGroupLayouts:[layout]});
    const pipelines = {};
    for (const entryPoint of ['iterate','diagnose','summarize']) {pipelines[entryPoint] = await device.createComputePipelineAsync({label:'Thermal '+entryPoint, layout:pipelineLayout, compute:{module,entryPoint}});check();}
    const {temperatures,groups,summary,staging,bindings}=await checkedGPU(device,()=>{
    const storage = GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
    const coefficients = make('conductances',grid.count*32,storage), accounts = make('energy accounting',grid.count*16,storage);
    const temperatures = [make('temperature A',grid.count*4,storage),make('temperature B',grid.count*4,storage)];
    const groups = Math.ceil(grid.count/64);
    if (groups > device.limits.maxComputeWorkgroupsPerDimension) throw error('GPU_LIMIT','Grid dispatch exceeds the shared device limit.');
    const partials = make('partial metrics',groups*32,storage), summary = make('metrics',32,storage);
    const uniform = make('configuration',32,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    const staging = make('metric readback',32,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(coefficients,0,new Float32Array(grid.coefficients));
    device.queue.writeBuffer(accounts,0,new Float32Array(grid.accounting));
    device.queue.writeBuffer(temperatures[0],0,new Float32Array(grid.initial));
    device.queue.writeBuffer(uniform,0,new Uint32Array([...grid.dimensions,grid.count,groups,0,0,0]));
    const bindings = [0,1].map(parity => device.createBindGroup({layout,entries:[coefficients,accounts,temperatures[parity],temperatures[1-parity],partials,summary,uniform].map((buffer,binding)=>({binding,resource:{buffer}}))}));
    return {temperatures,groups,summary,staging,bindings};
    });
    check();
    let parity = 0, iterations = 0, metrics;
    const diagnose = async () => {
      check(); await checkedGPU(device,()=>{const encoder = device.createCommandEncoder({label:'Thermal residual and energy'});
      const pass = encoder.beginComputePass(); pass.setBindGroup(0,bindings[parity]);
      pass.setPipeline(pipelines.diagnose); pass.dispatchWorkgroups(groups);
      pass.setPipeline(pipelines.summarize); pass.dispatchWorkgroups(1); pass.end();
      encoder.copyBufferToBuffer(summary,0,staging,0,32); device.queue.submit([encoder.finish()]);
      });
      check();await staging.mapAsync(GPUMapMode.READ); let values;
      try { check();values = new Float32Array(staging.getMappedRange()).slice(); } finally { staging.unmap(); }
      readbackBytes += 32; check();
      if (values[5] > 0 || !Array.from(values).every(Number.isFinite)) throw error('NONFINITE_RESULT','The numerical solve produced a non-finite value.');
      return values;
    };
    metrics = await diagnose();
    while (metrics[0] > grid.tolerance && iterations < grid.maxIterations) {
      check(); await checkedGPU(device,()=>{const encoder = device.createCommandEncoder({label:'Thermal bounded iteration batch'}), pass = encoder.beginComputePass();
      pass.setPipeline(pipelines.iterate);
      const batch = Math.min(64,grid.maxIterations-iterations);
      for (let i=0;i<batch;i++) {pass.setBindGroup(0,bindings[parity]);pass.dispatchWorkgroups(groups);parity=1-parity;}
      pass.end();device.queue.submit([encoder.finish()]);iterations += batch;
      });
      metrics = await diagnose();
      // Yield between bounded submissions so cancel and ordinary editor input can run.
      await new Promise(resolve => setTimeout(resolve,0));
    }
    if (metrics[0] > grid.tolerance) throw error('NOT_CONVERGED','The conduction residual did not reach the requested tolerance.');
    if (metrics[1] < -273.15-.001) throw error('NONPHYSICAL_TEMPERATURE','The prescribed source would drive temperature below absolute zero.');
    check();retained = temperatures[parity];
    const result = {
      dimensions:[...grid.dimensions],cellSize:[...grid.cellSize],count:grid.count,...fieldFrame?{fieldFrame}:{},
      buffer:retained,device,
      metrics:{iterations,residualK:metrics[0],minTemperature:metrics[1],maxTemperature:metrics[2],sourcePowerW:grid.sourcePower,boundaryPowerW:metrics[3],storagePowerW:metrics[4],energyImbalanceW:grid.sourcePower-metrics[3]-metrics[4],timeStep:grid.timeStep,wallMs:performance.now()-started,peakGPUBytes:peakBytes,retainedGPUBytes:grid.count*4,readbackBytes},
      dispose(){this.buffer?.destroy();this.buffer=null;this.metrics.retainedGPUBytes=0;},
      async inspect(offset=0,count=1){
        check();if (!this.buffer) throw error('RETIRED_RESULT','The thermal field was retired.');
        if (!Number.isInteger(offset)||offset<0||!Number.isInteger(count)||count<1||count>256||offset+count>this.count) throw error('INVALID_ARGUMENT','Inspect at most 256 existing cells.');
        const source = this.buffer;let staging;
        try {await checkedGPU(device,()=>{staging=device.createBuffer({label:'Thermal bounded temperature inspection',size:count*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(source,offset*4,staging,0,count*4);device.queue.submit([encoder.finish()]);});check();await staging.mapAsync(GPUMapMode.READ);
          let temperatures;try{check();if(this.buffer!==source)throw error('RETIRED_RESULT','The thermal field was retired during inspection.');temperatures=Array.from(new Float32Array(staging.getMappedRange()));}finally{staging.unmap();}
          if(this.buffer!==source)throw error('RETIRED_RESULT','The thermal field was retired during inspection.');
          check();this.metrics.readbackBytes+=count*4;return {offset,temperatures};
        } finally {staging?.destroy();}
      }
    };
    return result;
  } finally {
    for (const buffer of resources) if (buffer !== retained) buffer.destroy();
  }
}

