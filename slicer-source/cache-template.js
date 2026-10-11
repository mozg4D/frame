  // Numeric diagnostics persist; cached baseline data belongs to one invocation.
  const BASELINE_TOPOLOGY_CACHE_LIMITS=Object.freeze({edgeRings:64,edgeKeys:8192,edgeCodeUnits:524288,areas:64,pairs:256});
  const baselineTopologyFactoryContexts=new WeakSet();
  const baselineTopologyLedger={contexts:0,closedContexts:0,activeContexts:0,edgeKeys:{hits:0,misses:0,evictions:0,bypasses:0,errors:0},areas:{hits:0,misses:0,evictions:0,bypasses:0,errors:0},pip:{hits:0,misses:0,evictions:0,bypasses:0,errors:0},peaks:{edgeRings:0,edgeKeys:0,edgeCodeUnits:0,areas:0,pairs:0}};
  function baselineTopologyCacheDiagnostics(){return structuredClone(baselineTopologyLedger);}
  function createBaselineTopologyContext(originals,limits=BASELINE_TOPOLOGY_CACHE_LIMITS){
    const bounds={...limits};for(const name of Object.keys(BASELINE_TOPOLOGY_CACHE_LIMITS))if(!Number.isSafeInteger(bounds[name])||bounds[name]<0||bounds[name]>BASELINE_TOPOLOGY_CACHE_LIMITS[name])throw RangeError('Invalid bounded baseline topology retention limit');
    const keys=new Map(),areas=new Map(),pairs=new Map(),stats={edgeKeys:{hits:0,misses:0,evictions:0,bypasses:0,errors:0},areas:{hits:0,misses:0,evictions:0,bypasses:0,errors:0},pip:{hits:0,misses:0,evictions:0,bypasses:0,errors:0},peaks:{edgeRings:0,edgeKeys:0,edgeCodeUnits:0,areas:0,pairs:0}};let keyCount=0,codeUnits=0;
    baselineTopologyLedger.contexts++;baselineTopologyLedger.activeContexts++;
    const peak=()=>{const values={edgeRings:keys.size,edgeKeys:keyCount,edgeCodeUnits:codeUnits,areas:areas.size,pairs:pairs.size};for(const name of Object.keys(values))stats.peaks[name]=Math.max(stats.peaks[name],values[name]);};
    const compute=(kind,fn)=>{stats[kind].misses++;try{return fn();}catch(e){stats[kind].errors++;throw e;}};
    const memo=(store,key,capacity,kind,fn)=>{if(store.has(key)){stats[kind].hits++;return store.get(key);}const value=compute(kind,fn);if(!capacity){stats[kind].bypasses++;return value;}if(store.size>=capacity){store.delete(store.keys().next().value);stats[kind].evictions++;}store.set(key,value);peak();return value;};
    const context={originals,active:true,
      edgeKeys(i){if(!context.active)throw Error('Released baseline topology context');if(keys.has(i)){stats.edgeKeys.hits++;return keys.get(i).value;}const value=compute('edgeKeys',()=>new Set(pathEdges([originals[i]]).map(e=>e.a.X+','+e.a.Y+'|'+e.b.X+','+e.b.Y)));
        if(!bounds.edgeRings||value.size>bounds.edgeKeys){stats.edgeKeys.bypasses++;return value;}
        let units=0;for(const key of value)units+=key.length;if(units>bounds.edgeCodeUnits){stats.edgeKeys.bypasses++;return value;}
        while(keys.size>=bounds.edgeRings||keyCount+value.size>bounds.edgeKeys||codeUnits+units>bounds.edgeCodeUnits){const oldest=keys.keys().next().value,entry=keys.get(oldest);keys.delete(oldest);keyCount-=entry.value.size;codeUnits-=entry.units;stats.edgeKeys.evictions++;}
        keys.set(i,{value,units});keyCount+=value.size;codeUnits+=units;peak();return value;
      },
      originalArea(i){if(!context.active)throw Error('Released baseline topology context');return memo(areas,i,bounds.areas,'areas',()=>area(originals[i]));},
      originalPIP(i,j){if(!context.active)throw Error('Released baseline topology context');if(i===j){stats.pip.bypasses++;return compute('pip',()=>C.Clipper.PointInPolygon(originals[i][0],originals[j]));}return memo(pairs,i+','+j,bounds.pairs,'pip',()=>C.Clipper.PointInPolygon(originals[i][0],originals[j]));},
      snapshot(){return {...structuredClone(stats),active:context.active,retained:{edgeRings:keys.size,edgeKeys:keyCount,edgeCodeUnits:codeUnits,areas:areas.size,pairs:pairs.size},limits:{...bounds}};},
      release(){if(!context.active)return;baselineTopologyFactoryContexts.delete(context);context.active=false;context.originals=null;originals=null;keys.clear();areas.clear();pairs.clear();keyCount=codeUnits=0;baselineTopologyLedger.closedContexts++;baselineTopologyLedger.activeContexts--;for(const kind of ['edgeKeys','areas','pip'])for(const name of Object.keys(stats[kind]))baselineTopologyLedger[kind][name]+=stats[kind][name];for(const name of Object.keys(stats.peaks))baselineTopologyLedger.peaks[name]=Math.max(baselineTopologyLedger.peaks[name],stats.peaks[name]);}
    };baselineTopologyFactoryContexts.add(context);return context;
  }
