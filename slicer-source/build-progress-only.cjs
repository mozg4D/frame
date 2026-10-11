'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),root=__dirname;
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function replace(s,a,b){if(s.split(a).length!==2)throw Error('Unique r235 anchor required: '+a.slice(0,90));return s.replace(a,b);}
function build(worker,printer){
 if(hash(worker)!=='e120c24f46831ec5c53de96d5704b4942fef99771e3fe19268aa4915fba40475'||hash(printer)!=='23dc2471227dc3d445229f027c5fb02be759d45f1985d876ace8f3fd259b4872')throw Error('Pinned r235 runtime SHA mismatch');
 let w=worker,p=printer;
 w=replace(w,'async function frameSliceFinalized(meshes,p,options,send){',fs.readFileSync(path.join(root,'progress-status-reporter.js'),'utf8')+'\nasync function frameSliceFinalized(meshes,p,options,send){\n  let status;try{status=frameSliceStatusReporter(send,options.runId);');
 w=replace(w,'if(occupancy)activeLayers.push(layer);}','if(occupancy)activeLayers.push(layer);}\n  status.total(activeLayers.length,prepared.count,last);');
 w=replace(w,'wait=async()=>{await new Promise(resolve=>wakeups.push(resolve));if(failure)throw failure;};',"wait=async()=>{status.mark('waiting-workers');await new Promise(resolve=>wakeups.push(resolve));if(failure)throw failure;};");
 w=replace(w,'inputBytes-=entry.bytes;reserved-=entry.reservation;resultBytes-=entry.resultBytes||0;entry.job=null;entry.result=null;',"status.commit(entry.layer,stats.nonemptyLayers);inputBytes-=entry.bytes;reserved-=entry.reservation;resultBytes-=entry.resultBytes||0;entry.job=null;entry.result=null;");
 w=replace(w,'function sectionOwner(layer,describe){const result=',"function sectionOwner(layer,describe){status.mark('section',layer);const result=");
 w=replace(w,'async function finalize(entry,description,slot){\n    const job=',"async function finalize(entry,description,slot){\n    status.mark('building-paths',entry.layer);const job=");
 w=replace(w,'if(!slots){entry.job.values=[api.insetGroups(section.groups,p)];',"if(!slots){status.mark('building-paths',layer);entry.job.values=[api.insetGroups(section.groups,p)];");
 w=replace(w,'if(size>maxJobBytes){await drain();entry.job.values=[api.insetGroups(section.groups,p)];',"if(size>maxJobBytes){await drain();status.mark('building-paths',layer);entry.job.values=[api.insetGroups(section.groups,p)];");
 w=replace(w,'if(last)writer({layers:batch,progress:1,stats:{...stats}});return{...stats,...writer.counts()};',"if(last)writer({layers:batch,progress:1,stats:{...stats}});status.finish();return{...stats,...writer.counts()};\n  }finally{status?.close();}");
 const formatter=`function framePrinterSliceActivityText(activity,now=performance.now()){
  const q=activity.packet,names={preparing:'Preparing geometry',section:'Intersecting model','building-paths':'Building paths','waiting-workers':'Waiting for workers','geometry-complete':'Preparing preview'};
  let text=names[q.stage]||'Slicing';
  if(Number.isSafeInteger(q.layer)&&q.layer>0)text+=' · layer '+q.layer;
  if(Number.isSafeInteger(q.totalOccupiedLayers)&&q.totalOccupiedLayers>=0)text+=' · '+q.completedOccupiedLayers+'/'+q.totalOccupiedLayers+' model layers';
  const age=Math.floor(Math.max(0,now-activity.receivedAt)/1000);if(age>=2)text+=' · status message '+age+' s ago';
  if(Number.isFinite(q.lastCommittedElapsedMS)&&Number.isFinite(q.elapsedMS)){const commitAge=Math.floor(Math.max(0,q.elapsedMS-q.lastCommittedElapsedMS+now-activity.receivedAt)/1000);if(commitAge>=2)text+=' · last completed layer '+commitAge+' s ago';}
  else if(q.completedOccupiedLayers===0&&Number.isSafeInteger(q.totalOccupiedLayers))text+=' · no completed model layers yet';
  return text;
}
`;
 p=replace(p,'function framePrinterStatus(h){',formatter+'function framePrinterStatus(h){');
 p=replace(p,"el.textContent=s.busy?framePrinterProgressPercent(s.sliceProgress)+'%':'';","el.textContent=s.busy?(s.sliceActivity?framePrinterSliceActivityText(s.sliceActivity):s.status):'';");
 p=replace(p,"s.busy=true;s.sliceProgress=0;s.status='Preparing geometry.';","s.busy=true;s.sliceProgress=0;s.sliceActivity=null;s.status='Preparing geometry.';");
 p=replace(p,'const controller=new AbortController(),endScope=',"let activityTimer=null;\n  const controller=new AbortController(),endScope=");
 p=replace(p,'try{await window.frameAI.waitForIdle();s.sourceSnapshot=',"try{activityTimer=setInterval(()=>{if(s.busy&&s.sliceActivity)framePrinterStatus(h);},1000);await window.frameAI.waitForIdle();s.sourceSnapshot=");
 p=replace(p,'controller.signal,data=>{check();for(const q of data.angleValuesList||[])',"controller.signal,data=>{if(data.type==='sliceStatus'){s.sliceActivity={packet:data,receivedAt:performance.now()};s.status=framePrinterSliceActivityText(s.sliceActivity);framePrinterStatus(h);return;}check();for(const q of data.angleValuesList||[])");
 p=replace(p,"s.status='Slicing '+framePrinterProgressPercent(s.sliceProgress)+'%';","s.status=s.sliceActivity?framePrinterSliceActivityText(s.sliceActivity):'Slicing';");
 p=replace(p,'const outlineFinished=performance.now();displayStage=',"s.sliceActivity=null;const outlineFinished=performance.now();displayStage=");
 p=replace(p,'finally{if(displayStage){displayStage.paths.traverse',"finally{clearInterval(activityTimer);s.sliceActivity=null;if(displayStage){displayStage.paths.traverse");
 return{worker:w,printer:p};
}
module.exports={build};
