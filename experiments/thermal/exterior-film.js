// Shared boundary contract and physical checks only. No solver or GPU operator.
export const exteriorFaces=Object.freeze(['xMin','xMax','yMin','yMax','zMin','zMax']);
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const need=(ok,message,code='NUMERICAL_RANGE')=>{if(!ok)fail(code,message);};
export const normalPhysical=x=>Number.isFinite(x)&&Math.abs(x)>=2**-1022;
export const compensatedSum=values=>{let s=0,c=0;for(const x of values){const t=s+x;c+=Math.abs(s)>=Math.abs(x)?s-t+x:x-t+s;s=t;}return s+c;};
export function plainData(value,allowed,required=[]){
 need(value&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value)),'Expected plain boundary data.','INVALID_ARGUMENT');
 const keys=Reflect.ownKeys(value),d=Object.getOwnPropertyDescriptors(value);
 need(keys.every(k=>typeof k==='string'&&allowed.includes(k)&&d[k].enumerable&&Object.hasOwn(d[k],'value'))&&required.every(k=>Object.hasOwn(d,k)),'Unknown, missing, hidden or accessor boundary data.','INVALID_ARGUMENT');
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
export function boundaryDataProperty(object,key){
 const d=Object.getOwnPropertyDescriptor(object,key);need(!(key in object)||(d?.enumerable&&Object.hasOwn(d,'value')),'Boundary must be an own enumerable data field.','INVALID_ARGUMENT');return d?.value;
}
export const filmBoundarySchema={type:'object',additionalProperties:false,required:['kind','faces'],properties:{kind:{type:'string',enum:['exterior-film']},faces:{type:'object',additionalProperties:false,minProperties:1,maxProperties:6,properties:Object.fromEntries(exteriorFaces.map(f=>[f,{type:'object',additionalProperties:false,required:['hWPerM2K','ambientKelvin'],properties:{hWPerM2K:{type:'number',minimum:0},ambientKelvin:{type:'number',minimum:1,maximum:2000}}}]))}}};
export function snapshotFilmFaces(value,unit='ambientKelvin',nonempty=false){
 const map=plainData(value,exteriorFaces),keys=Object.keys(map);
 need(!nonempty||keys.length>0,'Select at least one exterior film face.','INVALID_ARGUMENT');
 const result={};for(const f of keys){const v=plainData(map[f],['hWPerM2K',unit],['hWPerM2K',unit]),t=v[unit],k=unit==='ambientKelvin'?t:t+273.15;
  need(typeof v.hWPerM2K==='number'&&Number.isFinite(v.hWPerM2K)&&v.hWPerM2K>=0&&typeof t==='number'&&Number.isFinite(t)&&k>=1&&k<=2000&&Math.abs(Math.fround(k-273.15)+273.15-k)<=1e-4,'Explicit finite h>=0 and representable 1..2000 K ambient required.','INVALID_ARGUMENT');
  result[f]=Object.freeze({hWPerM2K:v.hWPerM2K,[unit]:t});
 }return Object.freeze(result);
}
export function snapshotExteriorFilm(value){
 const v=plainData(value,['kind','faces'],['kind','faces']);need(v.kind==='exterior-film','Unsupported thermal boundary kind.','UNSUPPORTED_BOUNDARY');
 return Object.freeze({kind:'exterior-film',faces:snapshotFilmFaces(v.faces,'ambientKelvin',true)});
}
export function filmConductance(area,delta,k,h){
 need([area,delta,k].every(x=>normalPhysical(x)&&x>0),'Film geometry/material is not normal SI.');
 if(h===0)return 0;
 const a=delta/(2*k),b=1/h,r=a+b,g=area/r,uploaded=Math.fround(g);
 need([a,b,r,g].every(x=>normalPhysical(x)&&x>0)&&Number.isFinite(uploaded)&&uploaded>=2**-126&&Math.abs(uploaded/g-1)<=1e-6,'Exterior film resistance/conductance is not representable.');return g;
}
export function validateFilmUpload(grid,incidences){
 for(const {cell:i,g,ambientCelsius:t} of incidences){if(g===0)continue;
  const diagonal=grid.coefficients[i*8+6],rhs=grid.coefficients[i*8+7],initial=grid.initial[i],gt=g*t,drive=g*(t-initial);
  const representedG=Math.fround(diagonal)-Math.fround(diagonal-g),representedGT=Math.fround(rhs)-Math.fround(rhs-gt),representedDrive=representedGT-representedG*Math.fround(initial);
  need(normalPhysical(gt)||gt===0,'Exterior film bath term underflows.');
  need(Number.isFinite(representedG)&&Math.abs(representedG/g-1)<=1e-3,'Exterior film is not resolved in the Float32 diagonal.');
  if(drive!==0)need(normalPhysical(drive)&&Number.isFinite(representedDrive)&&Math.abs(representedDrive/drive-1)<=1e-3,'Exterior film driving term is not resolved in the combined Float32 system.');
 }
}
export function exteriorExchange(grid,temperature){
 const accounting=grid.boundaryAccounting??grid.accounting,stride=grid.boundaryAccounting?2:4;
 const n=grid.count,cellPower=new Float64Array(n),cellAbsolutePower=new Float64Array(n),parts=Object.fromEntries(exteriorFaces.map(f=>[f,[]])),absolute=[];
 for(const e of grid.exteriorFilm??[]){const q=e.g*(temperature[e.cell]-e.ambientKelvin);if(e.g===0)continue;
  const bg=accounting[e.cell*stride],bgt=accounting[e.cell*stride+1],representedG=Math.fround(bg)-Math.fround(bg-e.g),representedGT=Math.fround(bgt)-Math.fround(bgt-e.g*e.ambientCelsius),represented=representedG*(temperature[e.cell]-273.15)-representedGT;
  need(q===0?represented===0:normalPhysical(q)&&normalPhysical(q*grid.timeStep)&&Number.isFinite(represented)&&Math.abs(represented/q-1)<=1e-3,'Actual exterior film exchange is unresolved in uploaded boundary coefficients.');
  cellPower[e.cell]+=q;cellAbsolutePower[e.cell]+=Math.abs(q);parts[e.face].push(q);absolute.push(Math.abs(q));
 }
 const byFace=Object.fromEntries(exteriorFaces.map(f=>[f,compensatedSum(parts[f])])),powerOut=compensatedSum(Object.values(byFace)),absolutePower=compensatedSum(absolute);
 for(let i=0;i<n;i++)if(cellAbsolutePower[i]!==0){const represented=Math.fround(accounting[i*stride])*(temperature[i]-273.15)-Math.fround(accounting[i*stride+1]);need(Number.isFinite(represented)&&Math.abs(represented-cellPower[i])<=1e-3*cellAbsolutePower[i],'Combined uploaded boundary accounting loses the physical film exchange.');}
 need([powerOut,absolutePower,...Object.values(byFace),...cellPower,...cellAbsolutePower].every(Number.isFinite),'Exterior boundary power overflow.');
 return {cellPower,cellAbsolutePower,boundaryPowerOutW:powerOut,absoluteBoundaryPowerW:absolutePower,boundaryPowerByFaceW:byFace,boundaryEnergyOutJ:powerOut*grid.timeStep,boundaryEnergyByFaceJ:Object.fromEntries(exteriorFaces.map(f=>[f,byFace[f]*grid.timeStep])),absoluteBoundaryEnergyJ:absolutePower*grid.timeStep,netBoundaryPowerResolved:powerOut===0?absolutePower===0:Math.abs(powerOut)>1e-3*absolutePower};
}
// Original dimensional equations, independent of the uploaded RHS cancellation.
export function validateFilmHeat(grid,initial,temperature,capacities,power){
 const n=grid.count,dt=grid.timeStep,ex=exteriorExchange(grid,temperature),strides=[1,grid.dimensions[0],grid.dimensions[0]*grid.dimensions[1]],residualBounds=new Float64Array(n);let maxResidualK=0;
 need(initial.length===n&&temperature.length===n&&temperature.every((t,i)=>Number.isFinite(t)&&t>=1&&t<=2000&&normalPhysical(t*capacities[i])),'Invalid actual film Kelvin field.');
 for(let i=0;i<n;i++){
  let q=0;for(let a=0;a<3;a++)for(let side=0;side<2;side++){const g=grid.coefficients[i*8+2*a+side];if(g)q+=g*(temperature[i]-temperature[i+(side?1:-1)*strides[a]]);}
  const residual=capacities[i]*(temperature[i]-initial[i])/dt+q+ex.cellPower[i]-power[i],residualK=Math.abs(residual)*dt/capacities[i];maxResidualK=Math.max(maxResidualK,residualK);
  let bound=1e-3*capacities[i]/dt;if(power[i]!==0)bound=Math.min(bound,1e-3*Math.abs(power[i]));if(ex.cellAbsolutePower[i]!==0)bound=Math.min(bound,1e-3*ex.cellAbsolutePower[i]);
  need(Number.isFinite(residualK)&&residualK<=1e-3,'Actual film field violates the original BE equation.','NONCONVERGENCE');
  need(Math.abs(residual)<=bound,'Actual source/bath-cell residual is unresolved relative to its physical drive.');residualBounds[i]=bound;
 }
 const before=compensatedSum(Array.from(initial,(t,i)=>capacities[i]*t)),after=compensatedSum(Array.from(temperature,(t,i)=>capacities[i]*t)),sourcePower=compensatedSum(power),sourceEnergy=dt*sourcePower,absoluteSourceEnergy=compensatedSum(Array.from(power,p=>Math.abs(dt*p))),grossDriveEnergy=absoluteSourceEnergy+ex.absoluteBoundaryEnergyJ,energyError=after-before-sourceEnergy+ex.boundaryEnergyOutJ;
 need(sourcePower===0||(normalPhysical(sourcePower)&&normalPhysical(sourceEnergy)),'Net solid source underflows.');
 const energyRoundoffAllowance=256*Number.EPSILON*(before+after+absoluteSourceEnergy+ex.absoluteBoundaryEnergyJ);
 let energyAllowance=8*2**-23*(before+grossDriveEnergy);if(grossDriveEnergy>0)energyAllowance=Math.min(energyAllowance,1e-3*grossDriveEnergy);energyAllowance+=energyRoundoffAllowance;
 need([before,after,sourcePower,sourceEnergy,grossDriveEnergy,energyError,energyAllowance].every(Number.isFinite)&&Math.abs(energyError)<=energyAllowance,'Film global thermal balance is unresolved.');
 if(power.every(p=>p===0)){const baths=(grid.exteriorFilm??[]).filter(e=>e.g>0).map(e=>e.ambientKelvin),lo=Math.min(...initial,...baths),hi=Math.max(...initial,...baths);need(temperature.every(t=>t>=lo-1e-3&&t<=hi+1e-3),'Source-free film diffusion violates initial/bath extrema.');}
 return {...ex,energyBefore:before,energyAfter:after,sourcePower,sourceEnergy,absoluteSourceEnergy,grossDriveEnergy,energyError,energyAllowance,energyRoundoffAllowance,netDriveEnergyResolved:sourceEnergy-ex.boundaryEnergyOutJ===0?grossDriveEnergy===0:Math.abs(sourceEnergy-ex.boundaryEnergyOutJ)>1e-3*grossDriveEnergy,maxResidualK,residualBounds};
}
