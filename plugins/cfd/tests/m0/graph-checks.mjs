import {buildGraph} from './voronoi.mjs';
import {packGraph} from './graph-build.mjs';

// The sheet has zero sampled thickness. An exact two-sided crossing is required
// even when the sampled SDF is positive at both ends and inside the link.
export function verifyThinWalls(){
  const checks=[];
  for(const geometry of ['sheet','wedge'])for(const shift of [-.033,0,.027]){
    const lo=[-1,-1,-1],hi=[1,1,1],points=[],f={origin:lo,h:.15,name:'sphere',maxSpeed:1,nu:.001};
    const sdf=p=>geometry==='sheet'?Math.abs(p[0]-shift):Math.abs(p[0]-shift)-.075*(p[1]+1);
    const field={f,sample:sdf};
    const through=(a,b)=>{
      const da=a[0]-shift,db=b[0]-shift;
      if(da*db<0)return true;
      return geometry==='wedge' && Math.min(sdf(a),sdf(b))<0;
    };
    for(let z=0;z<5;z++)for(let y=0;y<5;y++)for(const side of [-1,1]){
      const yy=-.8+.4*y,zz=-.8+.4*z,edge=geometry==='sheet'?0:.075*(yy+1);
      for(const d of [.018,.085,.30,.68])points.push({p:[shift+side*(edge+d),yy,zz],solid:false,layer:d});
    }
    const graph=buildGraph({points,lo,hi,spacing:.4},field,through),p=packGraph(graph,f);
    let leaks=0,minC=Infinity,pairError=0;
    for(let i=0;i<graph.nodes.length;i++)for(const e of graph.nodes[i].links){minC=Math.min(minC,e.c);
      if(e.j<0)continue;
      const other=graph.nodes[e.j];
      if(through(graph.nodes[i].p,other.p))leaks++;
      const back=other.links.find(l=>l.j===i);
      pairError=Math.max(pairError,back?Math.max(Math.abs(e.c-back.c),...e.A.map((v,k)=>Math.abs(v+back.A[k]))):Infinity);
    }
    checks.push({geometry,shift,cuts:graph.cuts,components:p.components,minConductance:minC,maxRelativeClosure:graph.maxClosure,leaks,pairError,
      pass:graph.cuts>0&&p.components===2&&minC>0&&leaks===0&&pairError===0&&graph.maxClosure<2e-6});
  }
  return {checks,pass:checks.every(c=>c.pass)};
}
