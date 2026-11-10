// Frame world distances are millimetres; numerical Hex8 distances are metres.
// A domain is NOT occupancy. Never fill its cells implicitly with material.
const MM_TO_M = 0.001;
function finiteVector(value,n,name){if(!value||value.length!==n||Array.from(value).some(x=>typeof x!=='number'||!Number.isFinite(x)))throw Error('Invalid '+name);return Array.from(value);}
export function gridDomain({min,max,pitchMetres,world}){
 min=finiteVector(min,3,'domain minimum');max=finiteVector(max,3,'domain maximum');world=finiteVector(world,16,'world frame');
 if(!(typeof pitchMetres==='number'&&Number.isFinite(pitchMetres)&&pitchMetres>0))throw Error('Invalid physical pitch');
 if(world[3]!==0||world[7]!==0||world[11]!==0||world[15]!==1)throw Error('Expected affine world frame');
 const axes=[0,1,2].map(k=>world.slice(k*4,k*4+3)),scale=axes.map(a=>Math.hypot(...a));
 if(scale.some(s=>!Number.isFinite(s)||s<=0))throw Error('Singular world frame');
 const basis=axes.map((a,k)=>a.map(x=>x/scale[k]));
 for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)if(Math.abs(basis[i].reduce((s,v,k)=>s+v*basis[j][k],0))>1e-10)throw Error('Sheared owner frame is not an orthogonal Hex8 domain');
 const handedness=basis[0][0]*(basis[1][1]*basis[2][2]-basis[1][2]*basis[2][1])-basis[0][1]*(basis[1][0]*basis[2][2]-basis[1][2]*basis[2][0])+basis[0][2]*(basis[1][0]*basis[2][1]-basis[1][1]*basis[2][0]);
 // Right-handed basis is required by later strain/torque transformations.
 if(handedness<=0)throw Error('Reflected owner frame requires an explicit right-handed remapping');
 const extent=max.map((x,k)=>x-min[k]);
 if(extent.some(x=>!Number.isFinite(x)||x<=0))throw Error('Empty or unrepresentable domain');
 const lengthsMetres=extent.map((x,k)=>x*scale[k]*MM_TO_M);
 if(lengthsMetres.some(x=>!Number.isFinite(x)||x<=0))throw Error('Unrepresentable physical domain');
 const cells=lengthsMetres.map(x=>Math.ceil(x/pitchMetres)),count=cells.reduce((a,b)=>a*b,1);
 if(cells.some(n=>!Number.isSafeInteger(n)||n<1)||!Number.isSafeInteger(count)||count>32768)throw Error('Numerical stage capacity: 32768 domain cells');
 const spacingMetres=lengthsMetres.map((x,k)=>x/cells[k]),spacingLocal=extent.map((x,k)=>x/cells[k]);
 const originWorldMetres=[0,1,2].map(k=>(world[12+k]+world[k]*min[0]+world[4+k]*min[1]+world[8+k]*min[2])*MM_TO_M);
 if([...spacingMetres,...spacingLocal,...originWorldMetres].some(x=>!Number.isFinite(x))||spacingMetres.some(x=>x<=0))throw Error('Unrepresentable grid coordinates');
 for(let k=0;k<3;k++)if(min[k]+spacingLocal[k]===min[k]||max[k]-spacingLocal[k]===max[k])throw Error('Domain cells below coordinate precision');
 return {min,max,cells,count,spacingLocal,spacingMetres,lengthsMetres,originWorldMetres,basis,requestedPitchMetres:pitchMetres,occupancy:'unclassified',analysisReady:false};
}
