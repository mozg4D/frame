// Constant-size telemetry. Occupancy is source intersection, not printable-path count.
function frameSliceStatusReporter(send,runId){
  const started=performance.now();let last=-Infinity,closed=false,timer=null;
  const state={stage:'preparing',layer:null,completedOccupiedLayers:0,totalOccupiedLayers:null,nonemptyLayers:0,volumeLayers:null,lastOccupiedLayer:null};
  function close(){if(closed)return;closed=true;if(timer!==null){clearInterval(timer);timer=null;}}
  function flush(force=false){const now=performance.now();if(closed||!force&&now-last<500)return;last=now;try{send({type:'sliceStatus',runId,...state,elapsedMS:now-started});}catch(error){close();throw error;}}
  // Initial send happens before timer allocation; a failed send cannot leak a timer.
  flush();timer=setInterval(()=>flush(),500);
  return{
    mark(stage,layer=null,publish=true){state.stage=stage;state.layer=layer;if(publish)flush();},
    total(occupied,volume,lastLayer){state.totalOccupiedLayers=occupied;state.volumeLayers=volume;state.lastOccupiedLayer=lastLayer;},
    commit(layer,nonempty){state.completedOccupiedLayers++;state.nonemptyLayers=nonempty;state.layer=layer;},
    finish(){state.stage='geometry-complete';flush(true);},
    close
  };
}
