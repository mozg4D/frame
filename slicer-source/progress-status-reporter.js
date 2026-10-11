// Constant-size telemetry. Occupancy is source intersection, not printable-path count.
function frameSliceStatusReporter(send,runId){
  const started=performance.now(),publishedStages=new Set();let last=-Infinity,closed=false,timer=null;
  const state={stage:'preparing',layer:null,completedOccupiedLayers:0,totalOccupiedLayers:null,nonemptyLayers:0,volumeLayers:null,lastOccupiedLayer:null,lastCommittedElapsedMS:null};
  function close(){if(closed)return;closed=true;if(timer!==null){clearInterval(timer);timer=null;}}
  function flush(force=false,notification='heartbeat'){const now=performance.now();if(closed||!force&&now-last<500)return;last=now;try{send({type:'sliceStatus',runId,...state,notification,elapsedMS:now-started});publishedStages.add(state.stage);}catch(error){close();throw error;}}
  // Initial send happens before timer allocation; a failed send cannot leak a timer.
  flush(false,'stage');timer=setInterval(()=>flush(),500);
  return{
    // Force only the first occurrence of each stage: at most four extra packets/run.
    // Repeated layer/stage changes retain the 500 ms throttle and latest state.
    mark(stage,layer=null,publish=true){state.stage=stage;state.layer=layer;if(publish)flush(!publishedStages.has(stage),'stage');},
    total(occupied,volume,lastLayer){state.totalOccupiedLayers=occupied;state.volumeLayers=volume;state.lastOccupiedLayer=lastLayer;},
    commit(layer,nonempty){state.completedOccupiedLayers++;state.nonemptyLayers=nonempty;state.layer=layer;state.lastCommittedElapsedMS=performance.now()-started;},
    finish(){state.stage='geometry-complete';flush(true,'completion');},
    close
  };
}
