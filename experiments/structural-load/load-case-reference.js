const vec=(a,name)=>{if(!a||a.length!==3||Array.from(a).some(v=>!Number.isFinite(v)))throw Error('Invalid '+name);return Array.from(a);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
function orthogonal(b){if(!Array.isArray(b)||b.length!==3)throw Error('Invalid wrench basis');b.forEach(v=>vec(v,'wrench basis'));for(let i=0;i<3;i++)for(let j=0;j<3;j++)if(Math.abs(dot(b[i],b[j])-(i===j?1:0))>1e-10)throw Error('Nonorthonormal wrench basis');if(dot(b[0],cross(b[1],b[2]))<0)throw Error('Reflected wrench basis');}
export function wrenchInGrid({force,torque,pivotWorldMetres,basisWorld},domain){
 orthogonal(basisWorld);orthogonal(domain.basis);force=vec(force,'force');torque=vec(torque,'torque');const p=vec(pivotWorldMetres,'pivot'),origin=vec(domain.originWorldMetres,'domain origin');
 const rotate=v=>{const world=[0,1,2].map(k=>basisWorld.reduce((s,b,a)=>s+b[k]*v[a],0));return domain.basis.map(b=>dot(world,b));};
 return {force:rotate(force),torque:rotate(torque),pivot:domain.basis.map(b=>dot(p.map((v,k)=>v-origin[k]),b))};
}
function selectedCells(grid,cells){if(!Array.isArray(cells)&&!ArrayBuffer.isView(cells))throw Error('Expected resolved region cell indices');if(cells.length>grid.count)throw Error('Region exceeds grid capacity');const unique=new Set(cells);if([...unique].some(i=>!Number.isInteger(i)||i<0||i>=grid.count))throw Error('Invalid region cell');return [...unique].filter(i=>grid.materialIds[i]>=0);}
/** Total body-region wrench, consistent trilinear nodal weights. SI throughout. */
export function regionWrench(grid,cells,{force,torque,pivot}){
 force=vec(force,'force');torque=vec(torque,'torque');pivot=vec(pivot,'pivot');cells=selectedCells(grid,cells);
 const loads=new Float64Array(grid.dofs);if(!cells.length)return {loads,applied:false};
 const weights=new Map();for(const cell of cells)for(const node of grid.elementNodes.subarray(cell*8,cell*8+8))weights.set(node,(weights.get(node)||0)+1/(8*cells.length));
 const center=[0,0,0];for(const [n,w]of weights){const p=grid.position(n);for(let k=0;k<3;k++)center[k]+=w*p[k];}
 const arm=center.map((v,k)=>v-pivot[k]),offset=cross(arm,force),moment=torque.map((v,k)=>v-offset[k]),J=new Float64Array(9);
 for(const [n,w]of weights){const r=grid.position(n).map((v,k)=>v-center[k]),rr=dot(r,r);for(let i=0;i<3;i++)for(let j=0;j<3;j++)J[3*i+j]+=w*((i===j?rr:0)-r[i]*r[j]);}
 // Scaled Cholesky avoids a dimensional fixed tolerance for metre-sized regions.
 const scale=Math.max(J[0],J[4],J[8]);if(!(scale>0)||!Number.isFinite(scale))throw Error('Unresolved load region inertia');const L=new Float64Array(9);
 for(let i=0;i<3;i++)for(let j=0;j<=i;j++){let s=J[3*i+j]/scale;for(let k=0;k<j;k++)s-=L[3*i+k]*L[3*j+k];if(i===j){if(!(s>1e-12))throw Error('Load region cannot represent requested wrench robustly');L[3*i+j]=Math.sqrt(s);}else L[3*i+j]=s/L[3*j+j];}
 const y=[0,0,0],q=[0,0,0];for(let i=0;i<3;i++){let s=moment[i]/scale;for(let k=0;k<i;k++)s-=L[3*i+k]*y[k];y[i]=s/L[3*i+i];}for(let i=2;i>=0;i--){let s=y[i];for(let k=i+1;k<3;k++)s-=L[3*k+i]*q[k];q[i]=s/L[3*i+i];}
 for(const [n,w]of weights){const r=grid.position(n).map((v,k)=>v-center[k]),rot=cross(q,r);for(let k=0;k<3;k++)loads[n*3+k]=w*(force[k]+rot[k]);}
 if(!loads.every(Number.isFinite))throw Error('Load assembly overflow');return {loads,applied:true,center,pivot,force,torque};
}
