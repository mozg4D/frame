import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {captureNativeThermalInputs,nativeMaterialSI} from '../native-inputs.js';
import {assembleHeaterPowerStep,snapshotHeatedConduction} from '../heater-power.js';
import {nativeInputFixture,OWNER,SOURCE,html} from './native-input-fixture.mjs';
const near=(a,b,t=1e-12)=>assert.ok(Math.abs(a-b)<=t*Math.max(1,Math.abs(a),Math.abs(b)),`${a} != ${b}`);
const capture=f=>captureNativeThermalInputs(f.context,OWNER);
const throwsCurrent=async(lease,codes=['STALE_INPUT'])=>{await assert.rejects(lease.checkObservedInputs(),e=>codes.includes(e.code));await assert.rejects(lease.checkObservedInputs(),{code:'RETIRED_INPUT'});};

test('actual current capture is unfiltered and untagged; bridge snapshots direct native data without resources',async()=>{
 const f=nativeInputFixture(),native=f.context.scene.capture(OWNER,[],['thermal_material']);
 assert.equal(native.meshes.length,1);assert.ok(native.meshes[0].positions);assert.equal(native.meshes[0].tags,undefined);
 const before=f.core.snapshot(),lease=await capture(f),s=lease.snapshot;
 assert.equal(f.core.snapshot(),before);assert.equal(s.solverReady,false);assert.equal(s.geometryClassified,false);
 assert.equal(s.initialCelsius,20);assert.equal(s.ambientCelsius,25);assert.equal(s.boundaryCondition,'not-defined-by-ambient');
 assert.equal(s.occurrences[0].material.volumetricHeatCapacityJPerM3K,2430000);assert.equal(s.occurrences[0].heater.powerWatts,40);
 assert.equal(s.occurrences[0].material.sourceOwner,SOURCE);assert.equal(s.occurrences[0].heater.sourceOwner,SOURCE);
 assert.ok(!JSON.stringify(s).includes('sentinel'));assert.ok(Object.isFrozen(s.occurrences[0].material));assert.equal(lease.metrics.adapterOwnedGPUBytes,0);assert.equal(lease.metrics.adapterGeometryReadbackBytes,0);
 assert.deepEqual(await lease.checkObservedInputs(),{observationMatched:true,currentnessCertified:false});assert.equal(lease.metrics.completedChecks,1);lease.dispose();lease.dispose();await assert.rejects(lease.checkObservedInputs(),{code:'RETIRED_INPUT'});
});

test('tag discovery inherits real native settlement; zero resource metrics are adapter-scoped only',async()=>{
 const f=nativeInputFixture(),before=f.core.settles,lease=await capture(f);assert.equal(f.core.settles-before,2);assert.equal(lease.metrics.inheritedNativeSettlement,true);assert.equal(lease.metrics.wholeCallGPUWorkMeasured,false);await lease.checkObservedInputs();assert.equal(f.core.settles-before,4);lease.dispose();
});

test('installed authoring-only preview and opaque preserved tags never become active physical data',async()=>{
 const f=nativeInputFixture({installed:false});f.source.ignoredAuthoring={tags:[{kind:'thermal_material',params:{Conductivity:205,'Heat capacity':2430000}},{kind:'thermal_heater',params:{Power:40}}]};
 await assert.rejects(capture(f),{code:'THERMAL_TAGS_UNAVAILABLE'});assert.equal(f.calls,1);
 const manifest=JSON.parse(readFileSync(new URL('../../../plugins/thermal/plugin.json',import.meta.url),'utf8'));assert.ok(!manifest.tags?.length);
 const plugin=readFileSync(new URL('../../../plugins/thermal/plugin.js',import.meta.url),'utf8');assert.doesNotMatch(plugin,/native-inputs|heater-power|experiments/);
 const other=nativeInputFixture();other.tagOwners.get('thermal_material').manifest.id='unrelated-plugin';await assert.rejects(capture(other),{code:'THERMAL_TAGS_UNAVAILABLE'});
});

test('mass-specific heat is converted exactly once; legacy volumetric ambiguity, defaults and extra physics reject',()=>{
 const si=nativeMaterialSI({Density:2700,'Specific heat':900,Conductivity:205});assert.equal(si.volumetricHeatCapacityJPerM3K,2430000);
 for(const p of [{Conductivity:205,'Heat capacity':2430000},{Density:2700,Conductivity:205},{Density:2700,'Specific heat':900,Conductivity:205,Emissivity:.5},{Density:0,'Specific heat':900,Conductivity:205},{Density:-2700,'Specific heat':900,Conductivity:205},{Density:1e308,'Specific heat':1e308,Conductivity:1},{Density:1e-300,'Specific heat':1e-300,Conductivity:1}])assert.throws(()=>nativeMaterialSI(p));
 let hits=0;const p={Density:2700,'Specific heat':900,Conductivity:205};Object.defineProperty(p,'Density',{enumerable:true,get(){hits++;return 2700;}});assert.throws(()=>nativeMaterialSI(p));assert.equal(hits,0);
});

test('actual native scalar tag setter preserves UID/container and edits invalidate captured physics',async()=>{
 const f=nativeInputFixture(),lease=await capture(f),tag=f.source.tags.find(t=>t.kind==='thermal_heater'),container=tag.params,uid=tag.uid;
 f.tags.setTags([f.source],'thermal_heater',true,{Power:-40});assert.equal(tag.uid,uid);assert.equal(tag.params,container);await throwsCurrent(lease);
 const next=await capture(f);assert.equal(next.snapshot.occurrences[0].heater.powerWatts,-40);next.dispose();
});

test('real native checkpoint generation detects ABA edits with equal final authored values',async()=>{
 const f=nativeInputFixture(),lease=await capture(f),revision=f.core.FrameAuthorData.generation;
 f.tags.setTags([f.source],'thermal_heater',true,{Power:80});f.tags.setTags([f.source],'thermal_heater',true,{Power:40});
 assert.equal(f.core.FrameAuthorData.generation,revision+2);assert.equal(f.source.tags.find(t=>t.kind==='thermal_heater').params.Power,40);await throwsCurrent(lease);
});

test('actual author-data CAS enforces revision and invalidates even unrelated inert edits conservatively',async()=>{
 const f=nativeInputFixture(),lease=await capture(f),d=f.core.FrameAuthorData,old=d.get(SOURCE),record={id:'c'.repeat(32),revision:0,name:'Inert',kind:'opaque',refs:[],payload:{format:'test',version:1,data:{value:7}}};
 const result=await f.core.call('authorData.replace',{owner:SOURCE,expected:{epoch:old.epoch,revision:old.data.revision},records:[record]});assert.equal(result.data.revision,1);await throwsCurrent(lease);
 await assert.rejects(f.core.call('authorData.replace',{owner:SOURCE,expected:{epoch:old.epoch,revision:0},records:[record]}),{code:'CONFLICT'});
});

test('native Undo/history epoch and authoritative document replacement fence old leases',async()=>{
 for(const mode of ['history','replacement']){const f=nativeInputFixture(),lease=await capture(f),epoch=f.core.FrameAuthorData.epoch;
  if(mode==='history'){await f.core.frameUndoUI(true);assert.notEqual(f.core.FrameAuthorData.epoch,epoch);}else{f.core.FrameAuthorData.invalidateDocument();f.core.FrameAuthorData.installed();assert.notEqual(f.core.FrameAuthorData.epoch,epoch);}
  await throwsCurrent(lease,['STALE_INPUT','INVALID_NATIVE_INPUT']);
 }
});

test('same-hash owner/source replacement, deletion and ambiguous native owners reject',async()=>{
 for(const mode of ['owner','source','delete','duplicate']){const f=nativeInputFixture(),lease=await capture(f),i=mode==='owner'?0:1;
  if(mode==='delete')f.core.nodes.splice(1,1);else if(mode==='duplicate')f.core.nodes.push(structuredClone(f.source));else f.core.nodes.splice(i,1,structuredClone(f.core.nodes[i]));
  await throwsCurrent(lease,['STALE_INPUT','INVALID_OWNER','NATIVE_INPUT_LIMIT']);
 }
});

test('sub-signature exact transform motion, resource swaps, source accuracy and scene/device changes invalidate',async()=>{
 for(const mode of ['tiny-move','resource','accuracy','scene','device']){const f=nativeInputFixture(),lease=await capture(f),m=f.env.scene.meshes[0];
  if(mode==='tiny-move'){const old=f.context.scene.capture(OWNER).signature;f.frames.get(SOURCE)[12]=1e-11;assert.equal(f.context.scene.capture(OWNER).signature,old);}else if(mode==='resource')m.positions={label:'replacement'};else if(mode==='accuracy'){m.splineGenerated=true;m.sourceAccuracy={version:1,surfaceCertified:false};}else if(mode==='scene')f.env.scene={meshes:[m]};else f.env.device={label:'replacement'};
  await throwsCurrent(lease);
 }
});

test('schema changes, old Heat capacity schema, duplicate tags and missing active materials reject',async()=>{
 const f=nativeInputFixture(),lease=await capture(f);f.definitions.thermal_material.fields.Density=8000;await throwsCurrent(lease);
 for(const mode of ['legacy','missing','duplicate','unresolved','wrong-uid','curve']){const q=nativeInputFixture();if(mode==='legacy')q.definitions.thermal_material.fields={'Heat capacity':2430000,Conductivity:205};if(mode==='missing')q.source.tags=q.source.tags.filter(t=>t.kind!=='thermal_material');if(mode==='duplicate')q.source.tags.push(structuredClone(q.source.tags[0]));if(mode==='unresolved')q.source.tags[0].referencesUnresolved=true;if(mode==='wrong-uid')q.source.tags[0].uid='session-id';if(mode==='curve')q.source.tags[1].params.Curve=[{temperatureCelsius:0,powerWatts:40},{temperatureCelsius:100,powerWatts:0}];await assert.rejects(capture(q));}
});

test('instances/repeated occurrences and inherited tags never duplicate watts or infer a source role',async()=>{
 const f=nativeInputFixture();f.env.scene.meshes.push({...f.env.scene.meshes[0]});await assert.rejects(capture(f),{code:'UNSUPPORTED_OCCURRENCES'});
 const q=nativeInputFixture(),parent={id:'group',nativeHash:'d'.repeat(32),type:'group',enabled:true,parent:null,tags:[structuredClone(q.source.tags[1])],params:{}};q.core.nodes.push(parent);q.source.parent=parent.id;await assert.rejects(capture(q),{code:'UNCAPTURED_PHYSICAL_SOURCE'});
});

test('single actual-shaped replica owners reject before assigning occurrence-as-source provenance',async()=>{
 for(const type of ['instance','cloner','symmetry']){
  const f=nativeInputFixture(),canonical=f.env.scene.meshes[0],hash='d'.repeat(32),node={...structuredClone(f.source),id:'replica',nativeHash:hash,type,params:{object:SOURCE}};
  f.source.tags=[];canonical.frameVisible=false;f.core.nodes.push(node);f.frames.set(hash,Array.from(f.math.I()));
  // Exact current syncReplicas descriptor ownership shape. Native capture drops
  // replicaSource/replicaMatrix, so admission must reject by native owner state.
  f.env.scene.meshes.push({...canonical,hashId:hash,replicaSource:canonical,replicaMatrix:f.math.I(),frameWorld:f.math.I(),frameVisible:true,splineGenerated:true});
  const actual=f.context.scene.capture(OWNER);assert.equal(actual.meshes.length,1);assert.equal(actual.meshes[0].hash,hash);assert.equal(actual.meshes[0].positions,canonical.positions);assert.equal(actual.meshes[0].replicaSource,undefined);
  await assert.rejects(capture(f),{code:'UNSUPPORTED_SOURCE_KIND'});f.core.nodes[1]=structuredClone(f.source);await assert.rejects(capture(f),{code:'UNSUPPORTED_SOURCE_KIND'});
  node.params.object=hash;await assert.rejects(capture(f),{code:'UNSUPPORTED_SOURCE_KIND'});
 }
});

test('single instanceCloud occurrence from exact native cloudRows/nativeSurfaceOccurrences rejects',async()=>{
 const f=nativeInputFixture(),hash='d'.repeat(32),field='e'.repeat(32),node={...structuredClone(f.source),id:'cloud',nativeHash:hash,type:'group',params:{},instanceCloud:[{source:SOURCE,field}],pluginRecords:{[field]:{type:6,value:[0,0,0,1]}}};
 f.source.tags=[];f.env.scene.meshes[0].frameVisible=false;f.core.nodes.push(node);f.frames.set(hash,Array.from(f.math.I()));
 const actual=f.context.scene.capture(OWNER);assert.equal(actual.meshes.length,1);assert.equal(actual.meshes[0].hash,hash);assert.equal(actual.meshes[0].positions,f.env.scene.meshes[0].positions);await assert.rejects(capture(f),{code:'UNSUPPORTED_SOURCE_KIND'});
});

test('HASH-accepted/restored physical UID collisions reject against all active owner tags',async()=>{
 for(const kind of ['physical','other-active']){
  const f=nativeInputFixture(),rows=structuredClone(f.source.tags),uid=rows[0].uid;
  if(kind==='physical')rows[1].uid=uid;else{f.definitions.other_active={fields:{},plugin:'thermal'};rows.push({uid,kind:'other_active',params:{}});}
  const data=f.authoring.validate(JSON.stringify({version:1,tags:rows,animation:[]}));f.source.tags=[];f.authoring.restore(f.source,data);assert.equal(f.source.tags.filter(t=>t.uid===uid).length,2);await assert.rejects(capture(f),{code:'AMBIGUOUS_TAG_IDENTITY'});
 }
 const f=nativeInputFixture({count:2}),sources=f.core.nodes.filter(n=>n.type==='mesh');sources[1].tags=structuredClone(sources[0].tags);const lease=await capture(f);assert.equal(lease.snapshot.occurrences.length,2);assert.equal(lease.snapshot.occurrences[0].heater.tagUID,lease.snapshot.occurrences[1].heater.tagUID);assert.notEqual(lease.snapshot.occurrences[0].heater.sourceOwner,lease.snapshot.occurrences[1].heater.sourceOwner);lease.dispose();
});

test('native visibility is captured as-is; outside/partial geometry is never classified or silently clipped',async()=>{
 const f=nativeInputFixture();f.frames.get(SOURCE)[12]=100000;const outside=await capture(f);assert.equal(outside.snapshot.occurrences.length,1);assert.equal(outside.snapshot.geometryClassified,false);assert.equal(outside.snapshot.solverReady,false);assert.equal(outside.snapshot.occurrences[0].heater.powerWatts,40);outside.dispose();
 f.env.scene.meshes[0].frameVisible=false;await assert.rejects(capture(f),{code:'UNCAPTURED_PHYSICAL_SOURCE'});
});

test('cancellation before and after every native await prevents publication and retires leases',async()=>{
 for(const read of [0,1,2,3]){const f=nativeInputFixture(),c=new AbortController();if(read===0)c.abort();else f.afterRead=(_n,_a,calls)=>{if(calls===read)c.abort();};await assert.rejects(captureNativeThermalInputs(f.context,OWNER,{signal:c.signal}),{code:'CANCELLED'});}
 for(const offset of [0,1,2]){const f=nativeInputFixture(),c=new AbortController(),lease=await captureNativeThermalInputs(f.context,OWNER,{signal:c.signal});if(offset===0)c.abort();else{const at=f.calls+offset;f.afterRead=(_n,_a,calls)=>{if(calls===at)c.abort();};}await assert.rejects(lease.checkObservedInputs(),{code:'CANCELLED'});}
});

test('changed physical values and exact owner replacement are checked after awaits',async()=>{
 for(const read of [2,3]){const f=nativeInputFixture();f.afterRead=(_n,_a,calls)=>{if(calls===read)f.tags.setTags([f.source],'thermal_heater',true,{Power:80});};await assert.rejects(capture(f),{code:'STALE_INPUT'});}
 const f=nativeInputFixture(),lease=await capture(f),at=f.calls+2;f.afterRead=(_n,_a,calls)=>{if(calls===at)f.core.nodes[0]=structuredClone(f.owner);};await throwsCurrent(lease);
});

test('negative control proves async ABA gap and never certifies an authoritative currentness guard',async()=>{
 const f=nativeInputFixture(),lease=await capture(f),at=f.calls+2,revision=f.core.FrameAuthorData.generation;
 f.afterRead=(_n,_a,calls)=>{if(calls===at){f.tags.setTags([f.source],'thermal_heater',true,{Power:80});f.tags.setTags([f.source],'thermal_heater',true,{Power:40});}};
 const observed=await lease.checkObservedInputs();assert.equal(f.core.FrameAuthorData.generation,revision+2);assert.deepEqual(observed,{observationMatched:true,currentnessCertified:false});assert.equal(lease.snapshot.currentnessCertified,false);assert.equal(lease.snapshot.solverReady,false);
 // The next read catches that prior gap, but no finite sequence of async reads
 // can substitute for a synchronous native generation/capture contract.
 await throwsCurrent(lease);
});

test('native IO readiness/busy and ongoing playback/transform/export refuse capture',async()=>{
 for(const mode of ['io','not-ready','playing','transforming','exporting','disabled']){const f=nativeInputFixture();if(mode==='io')f.core.block(true);else if(mode==='not-ready')f.core.FrameAuthorData.invalidateDocument();else if(mode==='disabled')f.owner.enabled=false;else f[mode]=true;await assert.rejects(capture(f));}
});

test('rotated/reflected nonuniform owner scales yield metres exactly once; shear/degeneracy reject',async()=>{
 const f=nativeInputFixture(),m=[0,2,0,0,-3,0,0,0,0,0,-.5,0,10,20,30,1];f.frames.set(OWNER,m);const lease=await capture(f);assert.deepEqual(lease.snapshot.ownerLocalMillimetresToMetres,[.002,.003,.0005]);lease.dispose();
 for(const bad of [[1,0,0,0,.2,1,0,0,0,0,1,0,0,0,0,1],[0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]]){f.frames.set(OWNER,bad);await assert.rejects(capture(f));}
});

test('independent explicit full-grid units oracle preserves total watts under cell refinement',async()=>{
 const f=nativeInputFixture(),lease=await capture(f),s=lease.snapshot,m=s.occurrences[0].material,p=s.occurrences[0].heater.powerWatts;
 // These dimensions are an EXPLICIT analytic test oracle, not a bridge-issued
 // classification of captured triangles, native grid, or native solve.
 for(const n of [1,2,4,8]){const count=n**3,cellSize=[20/n,20/n,10/n].map((v,i)=>v*s.ownerLocalMillimetresToMetres[i]),V=cellSize.reduce((a,b)=>a*b,1),input={dimensions:[n,n,n],cellSize,conductivity:[m.conductivityWPerMK],heatCapacity:[m.volumetricHeatCapacityJPerM3K],initialKelvin:new Array(count).fill(s.initialCelsius+273.15),boundaryKelvin:{},timeStep:.01,heaters:[{cells:Array.from({length:count},(_,i)=>i),curve:[{temperatureCelsius:0,powerWatts:p},{temperatureCelsius:100,powerWatts:p}]}]};
  const plan=assembleHeaterPowerStep(input);near(count*V,4e-6);near(m.densityKgPerM3*count*V,.0108);near(m.volumetricHeatCapacityJPerM3K*count*V,9.72);near(plan.power.reduce((a,b)=>a+b),40);near(plan.grid.sourcePower,40);near(snapshotHeatedConduction(input).heaters[0].capacity,9.72);near(p*.01/9.72,.0411522633744856);
 }lease.dispose();
});

test('realistic large-block Float32 source precision remains an explicit unresolved constraint',()=>{
 const capacity=2700*900*.1**3,watts=100,dt=.01,initialC=20,exact=initialC+watts*dt/capacity,nearest=Math.fround(exact),residual=capacity*(nearest-initialC)/dt-watts;
 near(capacity,2430);assert.ok(Math.abs(residual/watts)>.001);assert.ok(Math.abs((capacity*(Math.fround(initialC+watts*.1/capacity)-initialC)/.1-watts)/watts)<.001);
});

test('64 occurrence completed capture/check has bounded CPU latency and zero GPU ownership',async()=>{
 const f=nativeInputFixture({count:64}),times=[];for(let i=0;i<5;i++){const start=performance.now(),lease=await capture(f);await lease.checkObservedInputs();times.push(performance.now()-start);assert.equal(lease.snapshot.occurrences.length,64);assert.equal(lease.metrics.adapterOwnedGPUBytes,0);lease.dispose();}assert.ok(Math.max(...times)<1000,JSON.stringify(times));console.log('Completed native capture + verify 64 occurrences ms:',JSON.stringify(times));
});

test('native core extraction is exact; existing synchronous stamp is not consumed by this async observation',()=>{
 assert.match(html,/capture:\(hash,keys=\[\]\)=>window\.frameEngine\.pluginSnapshot\(hash,keys,true\)/);assert.doesNotMatch(html,/prepareVolume:/);
 assert.ok(html.includes('fields:Object.freeze({authoringStamp:()=>window.frameEngine.pluginAuthoringStamp()})'));
 const source=readFileSync(new URL('../native-inputs.js',import.meta.url),'utf8');assert.doesNotMatch(source,/from ['"].*(?:heater-power|conduction|cfd|aero)|createBuffer|prepareVolume|operations\.register|viewport\.register/);
 const runtime=source.slice(source.indexOf('export async function captureNativeThermalInputs'));assert.doesNotMatch(runtime,/authoringStamp|context\.fields/);
 console.log('Native core SHA256:',createHash('sha256').update(html).digest('hex'));
});
