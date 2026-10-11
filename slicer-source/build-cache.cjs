'use strict';
// Pure final build step; only exact r241 module inputs are accepted.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),root=__dirname,sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const pins=Object.freeze({worker:'024140cd3fba17edf705801e383a378b49722bfa574aa84a754637abb74f46d5',printer:'23e68964365d7a8641680328e8e714632166c5ef5e55f23a4a04e0c1211f72f7'});
function once(s,a,b){if(s.split(a).length!==2)throw Error('Nonunique source anchor '+a.slice(0,100));return s.replace(a,b);}
function range(s,name){const start=s.indexOf('function '+name+'(');if(start<0)throw Error('Missing function '+name);const open=s.indexOf('{',start);let depth=0,quote=null,line=false,block=false;for(let i=open;i<s.length;i++){const c=s[i],n=s[i+1];if(line){if(c==='\n')line=false;continue;}if(block){if(c==='*'&&n==='/'){block=false;i++;}continue;}if(quote){if(c==='\\')i++;else if(c===quote)quote=null;continue;}if(c==='/'&&n==='/'){line=true;i++;continue;}if(c==='/'&&n==='*'){block=true;i++;continue;}if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if(c==='{')depth++;if(c==='}'&&!--depth)return{start,open,end:i+1};}throw Error('Unclosed function '+name);}
function edit(s,name,fn){const r=range(s,name);return s.slice(0,r.start)+fn(s.slice(r.start,r.end))+s.slice(r.end);}
function descriptionReuse(s){
 const componentStart=s.indexOf('function insetComponent(material,p,inputVertices){'),componentEnd=s.indexOf('function reserveInset',componentStart),groupsStart=s.indexOf('function insetGroups(groups,p){'),groupsEnd=s.indexOf('function insetContours',groupsStart);
 if(componentStart<0||componentEnd<0||groupsStart<0||groupsEnd<0)throw Error('Description reuse boundaries');
 let helper=s.slice(componentStart,componentEnd),description=s.slice(groupsStart,groupsEnd);
 helper=once(helper,'function insetComponent(material,p,inputVertices){','function insetPreparedComponent(part,p,inputVertices){let material=part.material;');
 helper=once(helper,'const cacheKey=exactSectionKey(material,p),cached=insetCache.get(cacheKey);','const cacheKey=part.key,cached=cacheKey===null?undefined:insetCache.get(cacheKey);');
 helper=once(helper,'material=prepareInsetMaterial(material,p);','// Material and its pre-preparation key already belong to the immutable description.');
 helper=once(helper,'if(cacheKey.length<=1000000){','if(cacheKey!==null){');
 description=once(description,'function insetGroups(groups,p){','function insetDescription(description,p){');
 description=once(description,'const normalized=groups.flatMap(normalize),inputVertices=groups.reduce((n,paths)=>n+paths.reduce((n,path)=>n+path.length,0),0),value=','const inputVertices=description.inputVertices,value=');
 description=once(description,'for(const component of independentComponents(normalized,p.lineWidth*SCALE)){const result=insetComponent(component,p,inputVertices);','for(const part of description.parts){const result=insetPreparedComponent(part,p,inputVertices);');
 s=once(s,'  function insetContours(groups,p){','  '+helper.trim()+'\n  '+description.trim()+'\n  function insetContours(groups,p){');
 s=once(s,'describeContours,calculateInsetMaterial,reserveInset,insetCacheMemory,sliceStats,contours,insetGroups,layerY','describeContours,calculateInsetMaterial,reserveInset,insetCacheMemory,sliceStats,contours,insetGroups,insetDescription,layerY');
 const route="if(size>maxJobBytes){await drain();status.mark('building-paths',layer);entry.job.values=[api.insetGroups(section.groups,p)];";
 return once(s,route,route.replace('api.insetGroups(section.groups,p)','api.insetDescription(section.description,p)'));
}
function edgeHoist(s){return edit(s,'oneSidedPostRdpCleanup',f=>{f=once(f,'while(remainingBudget-->0){let selected=null;','while(remainingBudget-->0){let selected=null,currentEdges=null;');return once(f,'const edges=pathEdges(current),after={a:start,b:end};','const edges=currentEdges||(currentEdges=pathEdges(current)),after={a:start,b:end};');});}
const template=fs.readFileSync(path.join(root,'cache-template.js'),'utf8');
function topologyCache(s){
 s=edit(s,'trajectoryQualityFailures',f=>{f=once(f,'function trajectoryQualityFailures(paths,originals){','function trajectoryQualityFailures(paths,originals,topology=null){');f=once(f,'const unchanged=originals.map(p=>new Set(pathEdges([p]).map(edgeKey)));','const topologyActive=baselineTopologyFactoryContexts.has(topology)&&topology.active&&topology.originals===originals;\n    const unchanged=originals.map((p,i)=>topologyActive?topology.edgeKeys(i):new Set(pathEdges([p]).map(edgeKey)));');f=once(f,'Math.sign(area(originals[i]))','Math.sign(topologyActive?topology.originalArea(i):area(originals[i]))');return once(f,'C.Clipper.PointInPolygon(originals[i][0],originals[j])!==C.Clipper.PointInPolygon(paths[i][0],paths[j])','(topologyActive?topology.originalPIP(i,j):C.Clipper.PointInPolygon(originals[i][0],originals[j]))!==C.Clipper.PointInPolygon(paths[i][0],paths[j])');});
 s=edit(s,'oneSidedPostRdpCleanup',f=>{f=once(f,'function oneSidedPostRdpCleanup(paths,originals,contexts,width,tolerance,metrics){','function oneSidedPostRdpCleanup(paths,originals,contexts,width,tolerance,metrics,getTopology=null){');return once(f,'trajectoryQualityFailures(proposal,baseline).size','trajectoryQualityFailures(proposal,baseline,getTopology?getTopology():null).size');});
 s=edit(s,'proposeTwoPercentInset',f=>{f=once(f,'function proposeTwoPercentInset(paths,material,p,inputVertices,metrics){','function proposeTwoPercentInset(paths,material,p,inputVertices,metrics,getTopology=null){');f=once(f,'oneSidedPostRdpCleanup(value,paths,provenanceContexts,width,tolerance,metrics)','oneSidedPostRdpCleanup(value,paths,provenanceContexts,width,tolerance,metrics,getTopology)');return once(f,'trajectoryQualityFailures(result,paths)','trajectoryQualityFailures(result,paths,getTopology?getTopology():null)');});
 s=edit(s,'simplifyInset',f=>{f=once(f,'proposeTwoPercentInset(paths,material,p,inputVertices,metrics)','proposeTwoPercentInset(paths,material,p,inputVertices,metrics,getBaselineTopology)');f=once(f,'trajectoryQualityFailures(result,paths).size','trajectoryQualityFailures(result,paths,getBaselineTopology()).size');const r=range(f,'simplifyInset');return f.slice(0,r.open+1)+'\n    let baselineTopology=null;const getBaselineTopology=()=>baselineTopology||(baselineTopology=createBaselineTopologyContext(paths));try{'+f.slice(r.open+1,r.end-1)+'}finally{baselineTopology?.release();}\n  }';});
 s=once(s,'function trajectoryQualityFailures(paths,originals,topology=null){',template+'\n  function trajectoryQualityFailures(paths,originals,topology=null){');
 return once(s,"const api={version:'counted-original-insets-1',","const api={baselineTopologyCacheDiagnostics,version:'counted-original-insets-1',");
}
function build(base,printer){
 if(sha(base)!==pins.worker||sha(printer)!==pins.printer)throw Error('Exact pre-cache worker/printer required');
 const P1=descriptionReuse(base),P1P2=edgeHoist(P1),candidate=topologyCache(P1P2);
 if(Buffer.byteLength(candidate)!==876753||sha(candidate)!=='069c5667bb5be698ada0f3fc49535b17fbd7750ee3f9e768643dd90619dc5340')throw Error('Cleared shipping worker reconstruction mismatch');
 return{base,printer,P1,P1P2,candidate};
}
module.exports={build,pins,sha,once,range,edit,descriptionReuse,edgeHoist,topologyCache,template};
