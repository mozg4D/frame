/** Structural numerical foundation: SI units, trilinear Hex8, full integration.
 * No global stiffness matrix, source geometry, or scene state is stored here.
 */
export const CORNERS = Object.freeze([[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(Object.freeze));
const positive = (x, label) => { if (!Number.isFinite(x) || x <= 0) throw Error(`Invalid ${label}`); return x; };
const vector = (x, n, label) => { if (!x || x.length !== n || !Array.from(x).every(Number.isFinite)) throw Error(`Invalid ${label}`); };
export function material({young, poisson, yieldStrength}) {
  positive(young, 'Young modulus'); positive(yieldStrength, 'yield strength');
  if (!Number.isFinite(poisson) || poisson <= -1 || poisson >= 0.5) throw Error('Invalid Poisson ratio');
  const mu = young / (2 * (1 + poisson)), lambda = young * poisson / ((1 + poisson) * (1 - 2 * poisson));
  const D = new Float64Array(36);
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) D[a * 6 + b] = lambda + (a === b ? 2 * mu : 0);
  D[21] = D[28] = D[35] = mu;
  if (!D.every(Number.isFinite)) throw Error('Material stiffness overflow');
  return {young, poisson, yieldStrength, D};
}
// Engineering shear convention: [xx, yy, zz, xy, yz, xz].
export function strainMatrix(spacing, local = [0,0,0]) {
  vector(spacing,3,'spacing'); spacing.forEach(x=>positive(x,'spacing')); vector(local,3,'local coordinate');
  const B = new Float64Array(6 * 24);
  for (let a = 0; a < 8; a++) {
    const s = CORNERS[a].map(v=>2*v-1), d = s.map((v,k)=>v / (4 * spacing[k]) * (1+s[(k+1)%3]*local[(k+1)%3]) * (1+s[(k+2)%3]*local[(k+2)%3]));
    const c = 3 * a;
    B[c] = d[0]; B[24+c+1] = d[1]; B[48+c+2] = d[2];
    B[72+c] = d[1]; B[72+c+1] = d[0];
    B[96+c+1] = d[2]; B[96+c+2] = d[1];
    B[120+c] = d[2]; B[120+c+2] = d[0];
  }
  return B;
}
export function elementStiffness(spacing, input) {
  const {D} = material(input), K = new Float64Array(576), g = 1 / Math.sqrt(3);
  const det = spacing.reduce((a,b)=>a*b,1) / 8;
  for (const x of [-g,g]) for (const y of [-g,g]) for (const z of [-g,g]) {
    const B = strainMatrix(spacing,[x,y,z]), DB = new Float64Array(144);
    for(let a=0;a<6;a++) for(let j=0;j<24;j++) for(let b=0;b<6;b++) DB[a*24+j]+=D[a*6+b]*B[b*24+j];
    for(let i=0;i<24;i++) for(let j=0;j<24;j++) for(let a=0;a<6;a++) K[i*24+j]+=B[a*24+i]*DB[a*24+j]*det;
  }
  if (!K.every(Number.isFinite) || Array.from({length:24},(_,i)=>K[i*24+i]).some(v=>v<=0)) throw Error('Element stiffness overflow');
  return K;
}
export function createGrid({cells, spacing, materials, materialIds}) {
  vector(cells,3,'cell counts'); vector(spacing,3,'spacing');
  if(cells.some(n=>!Number.isInteger(n)||n<1)) throw Error('Invalid cell counts');
  spacing.forEach(x=>positive(x,'spacing'));
  const count=cells.reduce((a,b)=>a*b,1);
  if(count>32768) throw Error('Numerical stage capacity: 32768 cells');
  if(!Array.isArray(materials)||!materials.length||materials.length>32) throw Error('Invalid materials');
  const ms=materials.map(material), matrices=ms.map(m=>elementStiffness(spacing,m));
  if(materialIds!==undefined && (materialIds.length!==count||Array.from(materialIds).some(v=>!Number.isInteger(v)||v< -1||v>=ms.length))) throw Error('Invalid material mapping');
  const ids=materialIds===undefined?new Int32Array(count):Int32Array.from(materialIds);
  const [nx,ny,nz]=cells, nodeCount=(nx+1)*(ny+1)*(nz+1), dofs=3*nodeCount;
  const node=(x,y,z)=>x+(nx+1)*(y+(ny+1)*z), elementNodes=new Uint32Array(count*8), diagonal=new Float64Array(dofs), active=new Uint8Array(nodeCount);
  for(let z=0;z<nz;z++) for(let y=0;y<ny;y++) for(let x=0;x<nx;x++) {
    const e=x+nx*(y+ny*z), ke=ids[e]<0?null:matrices[ids[e]];
    CORNERS.forEach((c,a)=>{const n=node(x+c[0],y+c[1],z+c[2]);elementNodes[e*8+a]=n;if(ke){active[n]=1;for(let k=0;k<3;k++)diagonal[3*n+k]+=ke[(3*a+k)*24+3*a+k];}});
  }
  return {cells:[...cells],spacing:[...spacing],materials:ms,materialIds:ids,matrices,elementNodes,diagonal,active,nodeCount,dofs,count,node,
    position:n=>[(n%(nx+1))*spacing[0],(Math.floor(n/(nx+1))%(ny+1))*spacing[1],Math.floor(n/((nx+1)*(ny+1)))*spacing[2]]};
}
export function applyStiffness(grid, u, out=new Float64Array(grid.dofs)) {
  vector(u,grid.dofs,'displacement'); if(out===u||out.length!==grid.dofs) throw Error('Invalid output vector'); out.fill(0);
  for(let e=0;e<grid.count;e++) {
    const id=grid.materialIds[e]; if(id<0) continue;
    const K=grid.matrices[id], nodes=grid.elementNodes.subarray(e*8,e*8+8);
    for(let a=0;a<24;a++) {let s=0;for(let b=0;b<24;b++)s+=K[a*24+b]*u[3*nodes[Math.floor(b/3)]+b%3];out[3*nodes[Math.floor(a/3)]+a%3]+=s;}
  }
  return out;
}
export function boundaryConditions(grid, constraints=[]) {
  const fixed=new Uint8Array(grid.dofs), prescribed=new Float64Array(grid.dofs);
  for(let n=0;n<grid.nodeCount;n++) if(!grid.active[n]) fixed.fill(1,3*n,3*n+3);
  for(const {dof,value=0} of constraints) {
    if(!Number.isInteger(dof)||dof<0||dof>=grid.dofs||!Number.isFinite(value))throw Error('Invalid constraint');
    if(!grid.active[Math.floor(dof/3)]&&value!==0)throw Error('Constraint on inactive node');
    if(fixed[dof]&&prescribed[dof]!==value) throw Error('Conflicting constraints');
    fixed[dof]=1; prescribed[dof]=value;
  }
  return {fixed,prescribed};
}
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
/** Float64 oracle PCG; not the production scene solver. Explicit nonconvergence. */
export function solve(grid,{loads=new Float64Array(grid.dofs),constraints=[],tolerance=1e-9,maxIterations=2000,signal}={}) {
  vector(loads,grid.dofs,'loads'); loads=Float64Array.from(loads); positive(tolerance,'tolerance');
  if(tolerance>=1||!Number.isInteger(maxIterations)||maxIterations<1||maxIterations>10000)throw Error('Invalid solver options');
  if(grid.count>4096)throw Error('Reference solver capacity: 4096 cells');
  if(!constraints.length)throw Error('Constraints are required');
  for(let n=0;n<grid.nodeCount;n++)if(!grid.active[n]&&loads.subarray(3*n,3*n+3).some(v=>v!==0))throw Error('Load on inactive node');
  const started=performance.now(),{fixed,prescribed}=boundaryConditions(grid,constraints),u=prescribed.slice(),ku=applyStiffness(grid,u),r=new Float64Array(grid.dofs),z=r.slice(),p=r.slice();
  let norm=0;for(let i=0;i<r.length;i++)if(!fixed[i]){r[i]=loads[i]-ku[i];z[i]=r[i]/grid.diagonal[i];p[i]=z[i];norm+=r[i]*r[i];}
  norm=Math.sqrt(norm);const threshold=tolerance*Math.max(norm,Number.MIN_VALUE);let rz=dot(r,z),iterations=0,reason='iteration-limit';
  if(norm===0)reason='converged';
  for(;reason==='iteration-limit'&&iterations<maxIterations;iterations++){
    if(signal?.aborted){reason='cancelled';break;}
    const ap=applyStiffness(grid,p);for(let i=0;i<ap.length;i++)if(fixed[i])ap[i]=0;
    const curvature=dot(p,ap);if(!(curvature>0)||!Number.isFinite(curvature)){reason='non-positive-curvature';break;}
    const alpha=rz/curvature;for(let i=0;i<u.length;i++){u[i]+=alpha*p[i];r[i]-=alpha*ap[i];}
    // Verify the actual equation residual, not only the recursive PCG residual.
    if(Math.sqrt(dot(r,r))<=threshold){const exact=applyStiffness(grid,u);for(let i=0;i<r.length;i++)r[i]=fixed[i]?0:loads[i]-exact[i];if(Math.sqrt(dot(r,r))<=threshold){reason='converged';iterations++;break;}
      for(let i=0;i<z.length;i++)z[i]=fixed[i]?0:r[i]/grid.diagonal[i];p.set(z);rz=dot(r,z);continue;}
    for(let i=0;i<z.length;i++)z[i]=fixed[i]?0:r[i]/grid.diagonal[i];
    const next=dot(r,z),beta=next/rz;for(let i=0;i<p.length;i++)p[i]=z[i]+beta*p[i];rz=next;
  }
  const internal=applyStiffness(grid,u),reactions=new Float64Array(grid.dofs);let residual2=0;
  for(let i=0;i<u.length;i++){const error=internal[i]-loads[i];if(fixed[i])reactions[i]=error;else residual2+=error*error;}
  const relativeResidual=norm?Math.sqrt(residual2)/norm:Math.sqrt(residual2);
  if(!u.every(Number.isFinite)||!Number.isFinite(relativeResidual))reason='non-finite';
  if(reason==='converged'&&relativeResidual>tolerance)reason='residual-failed';
  return {converged:reason==='converged',reason,iterations,relativeResidual,displacement:u,reactions,strainEnergy:dot(u,internal)/2,work:dot(u,loads),timeMs:performance.now()-started};
}
export function evaluateCells(grid,u) {
  vector(u,grid.dofs,'displacement');const g=1/Math.sqrt(3),points=[];
  for(const x of [-g,g])for(const y of [-g,g])for(const z of [-g,g])points.push([x,y,z]);
  return Array.from({length:grid.count},(_,e)=>{
    const id=grid.materialIds[e];if(id<0)return null;const m=grid.materials[id],ue=new Float64Array(24);
    for(let a=0;a<24;a++)ue[a]=u[3*grid.elementNodes[e*8+Math.floor(a/3)]+a%3];
    const samples=points.map(p=>{const B=strainMatrix(grid.spacing,p),strain=new Float64Array(6),stress=new Float64Array(6);
      for(let a=0;a<6;a++)for(let b=0;b<24;b++)strain[a]+=B[a*24+b]*ue[b];
      for(let a=0;a<6;a++)for(let b=0;b<6;b++)stress[a]+=m.D[a*6+b]*strain[b];
      if(!strain.every(Number.isFinite)||!stress.every(Number.isFinite))throw Error('Non-finite postprocessing');
      const [x,y,z,xy,yz,xz]=stress,vonMises=Math.sqrt(((x-y)**2+(y-z)**2+(z-x)**2)/2+3*(xy*xy+yz*yz+xz*xz));
      return {strain,stress,vonMises,safetyFactor:vonMises===0?Infinity:m.yieldStrength/vonMises};});
    const vonMises=Math.max(...samples.map(s=>s.vonMises));return {samples,vonMises,safetyFactor:vonMises===0?Infinity:m.yieldStrength/vonMises};
  });
}
/** Consistent nodal traction on a complete structured boundary face; total force is invariant under refinement. */
export function faceLoad(grid,axis,side,force) {
  if(!Number.isInteger(axis)||axis<0||axis>2||![0,1].includes(side))throw Error('Invalid face');vector(force,3,'force');
  const out=new Float64Array(grid.dofs),other=[0,1,2].filter(k=>k!==axis),faceCount=grid.cells[other[0]]*grid.cells[other[1]];
  for(let e=0;e<grid.count;e++) {const coords=[e%grid.cells[0],Math.floor(e/grid.cells[0])%grid.cells[1],Math.floor(e/(grid.cells[0]*grid.cells[1]))];if(coords[axis]!==side*(grid.cells[axis]-1))continue;
    if(grid.materialIds[e]<0)throw Error('Face load requires a complete solid face');
    for(let a=0;a<8;a++)if(CORNERS[a][axis]===side)for(let k=0;k<3;k++)out[3*grid.elementNodes[8*e+a]+k]+=force[k]/(4*faceCount);
  }return out;
}
/** Consistent affine traction for total force (N) and torque (N m) about the
 * face centre, in global XYZ. t = F/A + q cross r, J q = torque, where
 * J = integral (r.r I - r r^T) dA. Two-point face quadrature is exact. */
export function faceWrench(grid,axis,side,force,torque) {
  if(!Number.isInteger(axis)||axis<0||axis>2||![0,1].includes(side))throw Error('Invalid face');
  vector(force,3,'force');vector(torque,3,'torque');
  const other=[0,1,2].filter(k=>k!==axis),length=grid.cells.map((n,k)=>n*grid.spacing[k]);
  const area=length[other[0]]*length[other[1]],second=length.map((v,k)=>k===axis?0:area*v*v/12);
  const inertia=second.map((_,k)=>second.reduce((s,v,j)=>s+(j===k?0:v),0));
  if(!Number.isFinite(area)||area<=0||inertia.some(v=>!Number.isFinite(v)||v<=0))throw Error('Invalid face dimensions');
  const q=torque.map((v,k)=>v/inertia[k]),uniform=force.map(v=>v/area);
  if(!q.every(Number.isFinite)||!uniform.every(Number.isFinite))throw Error('Face wrench overflow');
  const out=new Float64Array(grid.dofs),g=1/Math.sqrt(3),weight=grid.spacing[other[0]]*grid.spacing[other[1]]/4;
  for(let e=0;e<grid.count;e++) {
    const c=[e%grid.cells[0],Math.floor(e/grid.cells[0])%grid.cells[1],Math.floor(e/(grid.cells[0]*grid.cells[1]))];
    if(c[axis]!==side*(grid.cells[axis]-1))continue;
    if(grid.materialIds[e]<0)throw Error('Face wrench requires a complete solid face');
    for(const u of [-g,g])for(const v of [-g,g]) {
      const local=[u,v],r=[0,0,0];other.forEach((k,j)=>r[k]=(c[k]+(local[j]+1)/2)*grid.spacing[k]-length[k]/2);
      const traction=[uniform[0]+q[1]*r[2]-q[2]*r[1],uniform[1]+q[2]*r[0]-q[0]*r[2],uniform[2]+q[0]*r[1]-q[1]*r[0]];
      for(let a=0;a<8;a++)if(CORNERS[a][axis]===side) {
        const shape=(1+(2*CORNERS[a][other[0]]-1)*u)*(1+(2*CORNERS[a][other[1]]-1)*v)/4;
        for(let k=0;k<3;k++)out[3*grid.elementNodes[8*e+a]+k]+=shape*weight*traction[k];
      }
    }
  }
  if(!out.every(Number.isFinite))throw Error('Face wrench overflow');
  return out;
}
/** Exact uniaxial bar solution with sliding lateral supports, not a clamped cantilever approximation. */
export function axialBenchmark(cells=[4,2,2]) {
  const length=[.2,.04,.04],young=210e9,poisson=.3,force=1000,area=length[1]*length[2];
  const grid=createGrid({cells,spacing:length.map((v,k)=>v/cells[k]),materials:[{young,poisson,yieldStrength:250e6}]}),constraints=[];
  for(let n=0;n<grid.nodeCount;n++){const p=grid.position(n);for(let k=0;k<3;k++)if(p[k]===0)constraints.push({dof:3*n+k});}
  return {grid,constraints,loads:faceLoad(grid,0,1,[force,0,0]),expected:force*length[0]/(young*area),stress:force/area,length,force};
}
