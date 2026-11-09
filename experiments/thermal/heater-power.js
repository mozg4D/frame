import {assembleConduction,solveConductionGPU} from './conduction.js';
import {sharedThermalDeviceState} from './device-state.js';
// Unregistered numerical experiment. No native authoring, UI or device creation.
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const need=(ok,message,code='INVALID_ARGUMENT')=>{if(!ok)fail(code,message);};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const normal=x=>finite(x)&&(x===0||Math.abs(x)>=2**-1022);
const faces=['xMin','xMax','yMin','yMax','zMin','zMax'];
const sum=a=>{let s=0,c=0;for(const x of a){const t=s+x;c+=Math.abs(s)>=Math.abs(x)?(s-t)+x:(x-t)+s;s=t;}return s+c;};
function data(v,keys,required=keys){
 need(v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v)),'Plain own-data object required.');
 const descriptors=Object.getOwnPropertyDescriptors(v);
 need(Reflect.ownKeys(descriptors).every(k=>typeof k==='string'&&keys.includes(k)&&descriptors[k].enumerable&&Object.hasOwn(descriptors[k],'value'))&&required.every(k=>Object.hasOwn(descriptors,k)),'Unknown, missing or non-data property.');
 return Object.fromEntries(Object.keys(descriptors).map(k=>[k,descriptors[k].value]));
}
function array(v,min,max){
 need(Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype&&v.length>=min&&v.length<=max,'Dense ordinary array required.');
 const d=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(d);
 need(keys.length===v.length+1&&keys.every(k=>k==='length'||typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<v.length&&d[k].enumerable&&Object.hasOwn(d[k],'value')),'Array must contain only dense own data elements.');
 return Array.from({length:v.length},(_,i)=>d[i].value);
}
export function snapshotPowerCurve(value){
 const curve=array(value,2,128).map(point=>{const p=data(point,['temperatureCelsius','powerWatts']);need(finite(p.temperatureCelsius)&&p.temperatureCelsius>=-272.15&&p.temperatureCelsius<=1726.85&&normal(p.powerWatts),'Curve requires finite Celsius temperatures and normal signed watts.');return Object.freeze(p);});
 need(curve.every((p,i)=>i===0||p.temperatureCelsius>curve[i-1].temperatureCelsius),'Curve temperatures must strictly increase.');
 return Object.freeze(curve);
}
export function powerAtTemperature(curve,temperatureCelsius){
 need(finite(temperatureCelsius)&&temperatureCelsius>=curve[0].temperatureCelsius&&temperatureCelsius<=curve.at(-1).temperatureCelsius,'Heater temperature lies outside its explicit curve.','POWER_CURVE_RANGE');
 let j=1;while(j<curve.length-1&&temperatureCelsius>curve[j].temperatureCelsius)j++;
 const a=curve[j-1],b=curve[j],fraction=(temperatureCelsius-a.temperatureCelsius)/(b.temperatureCelsius-a.temperatureCelsius);
 // A convex combination avoids overflowing the difference between opposite watts.
 const power=(1-fraction)*a.powerWatts+fraction*b.powerWatts;
 need(normal(power),'Interpolated power is unrepresentable.','NUMERICAL_RANGE');return power;
}
export function snapshotHeatedConduction(value){
 const v=data(value,['dimensions','cellSize','conductivity','heatCapacity','initialKelvin','boundaryKelvin','timeStep','heaters','tolerance','maxIterations'],['dimensions','cellSize','conductivity','heatCapacity','initialKelvin','boundaryKelvin','timeStep','heaters']);
 const dimensions=array(v.dimensions,3,3),cellSize=array(v.cellSize,3,3);
 need(dimensions.every(n=>Number.isInteger(n)&&n>=1&&n<=64)&&dimensions.reduce((a,b)=>a*b,1)<=4096&&cellSize.every(x=>finite(x)&&x>0),'Explicit SI grid supports at most 4096 cells.');
 const count=dimensions.reduce((a,b)=>a*b,1),volume=cellSize.reduce((a,b)=>a*b,1);
 need(normal(volume)&&volume>0&&finite(v.timeStep)&&v.timeStep>0&&v.timeStep<=.1,'Representable volume and explicit timeStep in (0,0.1] seconds required.');
 const field=(name,positive=false)=>{const a=array(v[name],1,count);need((a.length===1||a.length===count)&&a.every(x=>finite(x)&&(!positive||x>0)),name+' requires finite physical values.');return Object.freeze(a);};
 const conductivity=field('conductivity',true),heatCapacity=field('heatCapacity',true),initialKelvin=field('initialKelvin');
 need(initialKelvin.length===count&&initialKelvin.every(t=>t>=1&&t<=2000&&Math.abs(Math.fround(t-273.15)+273.15-t)<=1e-4),'Dense 1..2000 K initial field required.');
 const boundaryKelvin=data(v.boundaryKelvin,faces,[]);need(Object.values(boundaryKelvin).every(t=>finite(t)&&t>=1&&t<=2000),'Explicit Kelvin boundary temperatures required.');
 const occupied=new Set(),heaters=array(v.heaters,1,64).map(h=>{const x=data(h,['cells','curve']);const cells=array(x.cells,1,count);need(cells.every((i,j)=>Number.isInteger(i)&&i>=0&&i<count&&(j===0||i>cells[j-1])&&!occupied.has(i)),'Heater cells must be sorted, unique, in bounds and disjoint.');for(const i of cells)occupied.add(i);
  const cv=heatCapacity[heatCapacity.length===1?0:cells[0]];need(cells.every(i=>heatCapacity[heatCapacity.length===1?0:i]===cv),'This stage requires one constant volumetric heat capacity within each heater.');
  const capacity=cv*volume*cells.length,curve=snapshotPowerCurve(x.curve);need(normal(capacity)&&capacity>0,'Heater capacity is unrepresentable.','NUMERICAL_RANGE');
  let maximumSlope=0;for(let j=1;j<curve.length;j++){const slope=(curve[j].powerWatts-curve[j-1].powerWatts)/(curve[j].temperatureCelsius-curve[j-1].temperatureCelsius);need(normal(slope),'Heater slope is unrepresentable.','NUMERICAL_RANGE');maximumSlope=Math.max(maximumSlope,Math.abs(slope));}
  const feedbackNumber=v.timeStep*maximumSlope/capacity;need(finite(feedbackNumber)&&feedbackNumber<=.25,'Time step does not resolve heater feedback: dt*max|dP/dT|/capacity must be <=0.25.','HEATER_TIMESTEP');
  return Object.freeze({cells:Object.freeze(cells),curve,capacity,maximumSlope,feedbackNumber});});
 if(v.tolerance!==undefined)need(finite(v.tolerance)&&v.tolerance>=1e-6&&v.tolerance<=1e-4,'Supported tolerance is 1e-6..1e-4 K.');
 if(v.maxIterations!==undefined)need(Number.isInteger(v.maxIterations)&&v.maxIterations>=1&&v.maxIterations<=20000,'Invalid iteration bound.');
 const snapshot={dimensions:Object.freeze(dimensions),cellSize:Object.freeze(cellSize),conductivity,heatCapacity,initialKelvin,boundaryKelvin:Object.freeze(boundaryKelvin),timeStep:v.timeStep,heaters:Object.freeze(heaters),...(v.tolerance===undefined?{}:{tolerance:v.tolerance}),...(v.maxIterations===undefined?{}:{maxIterations:v.maxIterations})};
 // Invoke the same physical assembly preflight before borrowing any GPU resources.
 assembleStep(snapshot,initialKelvin);
 return Object.freeze(snapshot);
}
export function assembleHeaterPowerStep(input,temperature){const s=snapshotHeatedConduction(input),count=s.initialKelvin.length;return assembleStep(s,temperature===undefined?s.initialKelvin:array(temperature,count,count));}
function assembleStep(s,temperature){
 const count=s.dimensions.reduce((a,b)=>a*b,1),volume=s.cellSize.reduce((a,b)=>a*b,1);
 need(temperature?.length===count&&Array.from(temperature).every(t=>finite(t)&&t>=1&&t<=2000),'Complete physical Kelvin field required.');
 const source=new Array(count).fill(0),heaterStates=s.heaters.map((h,index)=>{const temperatureCelsius=sum(h.cells.map(i=>temperature[i]-273.15))/h.cells.length,powerWatts=powerAtTemperature(h.curve,temperatureCelsius),perCellPower=powerWatts/h.cells.length,sourceDensity=perCellPower/volume;
  need(normal(sourceDensity)&&(powerWatts===0||sourceDensity!==0)&&normal(perCellPower)&&(powerWatts===0||perCellPower!==0),'Heater source density is unrepresentable.','NUMERICAL_RANGE');
  const restoredPower=sourceDensity*volume*h.cells.length;need(finite(restoredPower)&&(powerWatts===0?restoredPower===0:Math.abs(restoredPower/powerWatts-1)<=1e-12),'Assembled heater source loses requested watts.','NUMERICAL_RANGE');for(const i of h.cells)source[i]=sourceDensity;return {index,temperatureCelsius,powerWatts,feedbackNumber:h.feedbackNumber};});
 const grid=assembleConduction({dimensions:[...s.dimensions],cellSize:[...s.cellSize],conductivity:[...s.conductivity],heatCapacity:[...s.heatCapacity],initial:Array.from(temperature,t=>t-273.15),source,boundary:Object.fromEntries(Object.entries(s.boundaryKelvin).map(([f,t])=>[f,t-273.15])),timeStep:s.timeStep,...(s.tolerance===undefined?{}:{tolerance:s.tolerance}),...(s.maxIterations===undefined?{}:{maxIterations:s.maxIterations})});
 for(const values of [grid.coefficients,grid.accounting,grid.initial])for(const x of values)need(x===0||Math.abs(Math.fround(x))>=2**-126,'Subnormal Float32 uploads are unsupported by this precision contract.','NUMERICAL_RANGE');
 const capacities=Float64Array.from({length:count},(_,i)=>s.heatCapacity[s.heatCapacity.length===1?0:i]*volume),power=Float64Array.from(source,q=>q*volume);
 for(let i=0;i<count;i++){
  need(normal(capacities[i])&&capacities[i]>0&&normal(capacities[i]*temperature[i])&&normal(capacities[i]/s.timeStep),'Cell energy/capacity is unrepresentable.','NUMERICAL_RANGE');
  if(power[i]!==0){const rhs=grid.coefficients[8*i+7],resolved=Math.fround(rhs)-Math.fround(rhs-power[i]);need(normal(power[i]*s.timeStep)&&normal(resolved)&&Math.abs(resolved/power[i]-1)<=1e-3,'Heater power is not resolved by the Float32 RHS.','NUMERICAL_RANGE');}
 }
 return {grid,capacities,power,heaterStates};
}
function validateStep(plan,before,after){
 const {grid,capacities,power}=plan,n=grid.count,dt=grid.timeStep,strides=[1,grid.dimensions[0],grid.dimensions[0]*grid.dimensions[1]];
 let maximumResidualK=0,boundaryPowerOutW=0,absoluteBoundaryPowerW=0;
 const changes=[],residuals=[],precisionBounds=[];
 for(let i=0;i<n;i++){
  const t=after[i]-273.15;let q=grid.accounting[4*i]*t-grid.accounting[4*i+1];boundaryPowerOutW+=q;absoluteBoundaryPowerW+=Math.abs(q);
  for(let a=0;a<3;a++)for(let side=0;side<2;side++){const g=grid.coefficients[8*i+2*a+side];if(g)q+=g*(after[i]-after[i+(side?1:-1)*strides[a]]);}
  // Bound only upload/solver precision, separately from physical drive. The
  // uploaded real stencil can differ from original coefficients and f32 shader
  // arithmetic. gamma32 bounds <=32 f32 operations conservatively;
  // 32*min-normal also covers possible flush-to-zero intermediates.
  const c=grid.coefficients,fd=Math.fround(c[8*i+6]),fr=Math.fround(c[8*i+7]);
  let defect=(c[8*i+6]-fd)*t-(c[8*i+7]-fr),magnitude=Math.abs(fd*t)+Math.abs(fr),conversionPower=Math.abs(c[8*i+6])*Number.EPSILON*(Math.abs(after[i])+2*273.15);
  for(let a=0;a<3;a++)for(let side=0;side<2;side++){const g=c[8*i+2*a+side];if(g){const tj=after[i+(side?1:-1)*strides[a]]-273.15,fg=Math.fround(g);defect-=(g-fg)*tj;magnitude+=Math.abs(fg*tj);conversionPower+=Math.abs(g)*Number.EPSILON*(Math.abs(after[i+(side?1:-1)*strides[a]])+2*273.15);}}
  const gamma32=32*2**-24/(1-32*2**-24);
  precisionBounds.push(dt*(Math.abs(defect)+fd*grid.tolerance+gamma32*magnitude+conversionPower+32*2**-126));
  const storage=capacities[i]*(after[i]-before[i])/dt,residual=storage+q-power[i],residualK=Math.abs(residual)*dt/capacities[i];maximumResidualK=Math.max(maximumResidualK,residualK);
  need(finite(residualK)&&residualK<=1e-3,'Original physical per-cell heat equation failed.','PHYSICAL_RESIDUAL');
  if(power[i]!==0)need(Math.abs(residual)<=1e-3*Math.abs(power[i])+256*Number.EPSILON*(Math.abs(storage)+Math.abs(q)+Math.abs(power[i])),'Original heater-cell source balance failed.','SOURCE_RESIDUAL');
  changes.push(capacities[i]*(after[i]-before[i]));residuals.push(residual*dt);
 }
 const sourceEnergyJ=dt*sum(power),boundaryEnergyOutJ=dt*boundaryPowerOutW,energyChangeJ=sum(changes),balanceErrorJ=energyChangeJ-sourceEnergyJ+boundaryEnergyOutJ,grossDriveJ=dt*(sum(Array.from(power,Math.abs))+absoluteBoundaryPowerW),roundoffJ=512*Number.EPSILON*sum(Array.from(capacities,(c,i)=>c*(Math.abs(before[i])+Math.abs(after[i]))));
 const physicalDriveAllowanceJ=1e-3*grossDriveJ,precisionAllowanceJ=sum(precisionBounds)+roundoffJ,balanceAllowanceJ=physicalDriveAllowanceJ+precisionAllowanceJ;
 need([sourceEnergyJ,boundaryEnergyOutJ,energyChangeJ,balanceErrorJ,balanceAllowanceJ].every(finite)&&Math.abs(balanceErrorJ)<=balanceAllowanceJ,'Actual field global source/boundary energy balance failed.','ENERGY_BALANCE');
 need(Math.abs(sum(residuals)-balanceErrorJ)<=512*Number.EPSILON*Math.max(1,grossDriveJ,Math.abs(energyChangeJ)),'Reciprocal heat accounting failed.','ENERGY_BALANCE');
 const absoluteSourceEnergyJ=dt*sum(Array.from(power,Math.abs)),netSourceCancellationResolved=absoluteSourceEnergyJ===0||Math.abs(sourceEnergyJ)>1e-3*absoluteSourceEnergyJ;
 return {sourceEnergyJ,absoluteSourceEnergyJ,netSourceCancellationResolved,boundaryEnergyOutJ,energyChangeJ,balanceErrorJ,balanceAllowanceJ,physicalDriveAllowanceJ,precisionAllowanceJ,sourceEnergyAbovePrecisionFloor:Math.abs(sourceEnergyJ)>precisionAllowanceJ,precisionLimited:precisionAllowanceJ>physicalDriveAllowanceJ,grossDriveJ,maximumResidualK};
}
// Dependency injection is exported only for independent lifecycle tests; no CPU production fallback.
export function createTemperaturePowerStepper(solve=solveConductionGPU){
 return async function advance(context,input,{stepCount=1,signal,check=()=>{}}={}){
  need(Number.isInteger(stepCount)&&stepCount>=1&&stepCount<=10&&typeof check==='function'&&(!signal||typeof signal.aborted==='boolean'),'Invalid duration/lifecycle controls.');
  const s=snapshotHeatedConduction(input);need(stepCount*s.timeStep<=.1,'Duration must not exceed 0.1 s.');
  const device=context?.device;need(device&&typeof device==='object','Borrowed GPU device required.');const loss=sharedThermalDeviceState(device);
  const guard=()=>{need(!signal?.aborted,'Heater solve cancelled.','CANCELLED');need(context.device===device,'Shared device changed.','STALE_JOB');need(!loss.lost,'Shared device lost.','DEVICE_LOST');check();};
  guard();let temperature=Float64Array.from(s.initialKelvin),field=null,peakGPUBytes=0;const steps=[],started=performance.now();
  try{
   for(let step=0;step<stepCount;step++){
    guard();const t=performance.now(),plan=assembleStep(s,temperature);field=await solve(device,plan.grid,{check:guard});guard();
    const after=new Float64Array(temperature.length);for(let offset=0;offset<after.length;offset+=256){const r=await field.inspect(offset,Math.min(256,after.length-offset));guard();need(r?.temperatures?.length===Math.min(256,after.length-offset),'Incomplete GPU readback.','INVALID_RESULT');for(let j=0;j<r.temperatures.length;j++)after[offset+j]=r.temperatures[j]+273.15;}
    need(after.every(t=>finite(t)&&t>=1&&t<=2000),'Nonphysical GPU temperature.','INVALID_RESULT');
    // Do not extrapolate after completing a step, even if no next step is requested.
    for(const h of s.heaters)powerAtTemperature(h.curve,sum(h.cells.map(i=>after[i]-273.15))/h.cells.length);
    const diagnostics=validateStep(plan,temperature,after);peakGPUBytes=Math.max(peakGPUBytes,field.metrics?.peakGPUBytes??0);field.dispose();field=null;guard();
    steps.push({...diagnostics,heaters:plan.heaterStates,wallMs:performance.now()-t});temperature=after;
    if(step+1<stepCount){await new Promise(resolve=>setTimeout(resolve,0));guard();}
   }
   guard();return {scope:'explicit-grid-temperature-power-experiment',temperatureUnit:'K',temperature,completedSteps:stepCount,completedTime:s.timeStep*stepCount,sourceEnergyJ:sum(steps.map(s=>s.sourceEnergyJ)),boundaryEnergyOutJ:sum(steps.map(s=>s.boundaryEnergyOutJ)),energyChangeJ:sum(steps.map(s=>s.energyChangeJ)),balanceErrorJ:sum(steps.map(s=>s.balanceErrorJ)),balanceAllowanceJ:sum(steps.map(s=>s.balanceAllowanceJ)),precisionAllowanceJ:sum(steps.map(s=>s.precisionAllowanceJ)),physicalDriveAllowanceJ:sum(steps.map(s=>s.physicalDriveAllowanceJ)),steps,metrics:{wallMs:performance.now()-started,peakGPUBytes,retainedGPUBytes:0},accuracy:'First-order lagged source, backward-Euler conduction; feedback limit is a time-resolution gate, not an error estimate.'};
  }finally{field?.dispose();}
 };
}
export const advanceTemperaturePowerGPU=createTemperaturePowerStepper();
