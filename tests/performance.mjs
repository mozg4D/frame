// All shared-suite API operations carry a wall-time budget, including serialization and rendering.
export function measuredAPI(api,metrics){
 metrics.operations={};
 return {...api,async call(name,args={}){
  const start=performance.now(),key=name+(args.type?':'+args.type:args.op?':'+args.op:''),samples=metrics.operations[key]??=[];
  try{return await api.call(name,args);}finally{samples.push(performance.now()-start);}
 }};
}
export function performanceFailures(metrics){
 return Object.entries(metrics.operations).flatMap(([name,samples])=>{
  const limit=/scene\.(open|create|export|convert)|spline\.(rebuild|replace)|geometry\.|render\./.test(name)?60000:5000,max=Math.max(...samples);
  return max>limit?[{operation:name,maxMs:max,limitMs:limit}]:[];
 });
}
