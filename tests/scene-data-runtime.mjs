import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {codecSource,keySource} from './hash-codec-fixture.mjs';
export const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
export function fragment(start,end='\n'){const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return html.slice(a,b);}
export function authorRuntime({nodes=[],commit=fn=>fn(),frameSyncEngineVisibility=()=>{},definitions={},FramePlugins={owner:()=>null,referenceField:()=>false},timelineFrame=0,frameGetTrack=()=>null}={}){return new Function('nodes','commit','frameSyncEngineVisibility','crypto','definitions','FramePlugins','timelineFrame','frameGetTrack',codecSource+'const FrameHash=createFrameHashCodec(),FrameValue=FrameHash.values;'+keySource+fragment('const FrameAuthorData=','const FrameDocumentation=')+';return {FrameAuthorData,FrameFields,FrameParameters};')(nodes,commit,frameSyncEngineVisibility,webcrypto,definitions,FramePlugins,timelineFrame,frameGetTrack);}
