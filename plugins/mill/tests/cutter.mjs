import {MillCutter} from '../plugin.js';
import {pathToFileURL} from 'node:url';
// Independent convex minimization oracle; production uses analytic feature intersections.
export function cutterChecks(){
 const checks=[],check=(name,pass,detail)=>{checks.push({name:'Mill cutter: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const signed=(tool,p)=>{const r=Math.hypot(p[0],p[1]),h=p[2],R=tool.radius,a=tool.angle*Math.PI/360;return tool.kind==='Flat'?Math.max(r-R,-h):tool.kind==='Ball'?Math.hypot(r,Math.min(h-R,0))-R:Math.max(r-R,Math.cos(a)*r-Math.sin(a)*h);};
 const swept=(tool,A,B,p)=>{const f=t=>signed(tool,p.map((v,i)=>v-A[i]-(B[i]-A[i])*t));let low=0,high=1;for(let i=0;i<80;i++){const a=low+(high-low)/3,b=high-(high-low)/3;if(f(a)<f(b))high=b;else low=a;}return Math.min(f(0),f(1),f((low+high)/2));};
 let seed=13719;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32),range=(a,b)=>a+(b-a)*random();
 for(const [kind,angle]of [['Flat',90],['Ball',90],['V',20],['V',90],['V',160]]){
  const tool=new MillCutter({Tool:kind,Diameter:6,Angle:angle});check(kind+' has an infinite shank and the expected tip profile',tool.profile(0)===0&&tool.profile(3.001)===Infinity&&tool.radiusAt(1e8)===3&&tool.radiusAt(-1)<0,{edge:tool.profile(3)});
  let worst=0,comparisons=0;
  for(let sample=0;sample<300;sample++){
   const A=[range(-5,5),range(-5,5),range(-8,2)],B=A.map(v=>v+range(-12,12)),axis=sample%3,cross=[range(-8,8),range(-8,8)],plane=axis===0?[1,2]:axis===1?[0,2]:[0,1],interval=tool.sweepRay(A,B,axis,cross,-20,30);
   for(let i=0;i<14;i++){const coordinate=interval&&i<4?interval[i%2]+(i<2?-1:1)*.0001:range(-20,30),point=[0,0,0];point[axis]=coordinate;plane.forEach((v,k)=>point[v]=cross[k]);const distance=swept(tool,A,B,point),actual=!!interval&&coordinate>=interval[0]&&coordinate<=interval[1];if(coordinate>=-20&&coordinate<=30&&Math.abs(distance)>1e-6){comparisons++;if(actual!==(distance<0)){worst=Math.max(worst,Math.abs(distance));check(kind+' sweep agrees with a continuous convex oracle',false,{A,B,axis,cross,interval,coordinate,distance,actual});}}
   }
  }
  check(kind+' '+angle+' analytic XYZ sweeps agree with independent minimization',comparisons>3000&&worst===0,{comparisons,worst});
  for(const axis of [0,1,2]){const a=[0,0,-5],b=[0,0,-5],cross=axis===2?[0,0]:[0,-4],interval=tool.sweepRay(a,b,axis,cross,-20,20);check(kind+' stationary '+axis+' matches its radial profile',!!interval&&interval[1]>interval[0],interval);}
 }
 const flat=new MillCutter({Tool:'Flat',Diameter:2}),middle=flat.sweepRay([-10,0,-5],[10,0,-5],2,[0,0],-10,10);check('continuous sweep removes stock between distant endpoints',middle?.[0]===-5&&middle?.[1]===10,middle);
 check('shorter Step Down does not truncate the cutter shank',flat.sweepRay([0,0,-100],[0,0,-100],0,[0,1000],-10,10)?.join(',')==='-1,1');
 return {pass:true,checks};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){try{const started=performance.now(),r=cutterChecks();console.log(JSON.stringify({pass:r.pass,checks:r.checks.length,ms:performance.now()-started},null,2));}catch(e){console.error(e.stack);process.exitCode=1;}}
