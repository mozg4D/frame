import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
export const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
export function fragment(start,end='\n'){const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return html.slice(a,b);}
export function authorRuntime({nodes=[],commit=fn=>fn(),frameSyncEngineVisibility=()=>{},definitions={},FramePlugins={owner:()=>null,referenceField:()=>false},timelineFrame=0,frameGetTrack=()=>null}={}){return new Function('nodes','commit','frameSyncEngineVisibility','crypto','definitions','FramePlugins','timelineFrame','frameGetTrack',fragment('const FrameAuthorData=','const FrameDocumentation=')+';return {FrameAuthorData,FrameFields,FrameParameters};')(nodes,commit,frameSyncEngineVisibility,webcrypto,definitions,FramePlugins,timelineFrame,frameGetTrack);}
export function reverseAuthorLayer(source,layer){for(const {before,after,count} of [...layer.patches].reverse()){assert.equal(source.split(after).length-1,count,'Exact author-layer patch match: '+before.slice(0,80));source=source.split(after).join(before);}return source;}
