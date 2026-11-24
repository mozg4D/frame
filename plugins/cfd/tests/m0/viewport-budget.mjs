// Queue time, including transfers, is learned on the actual shared device.
// Numerical passes stay ordered. No GPU work is outstanding when a slice ends.
export function viewportBudget(device,lastFrame){
  const costs=new Map(),frameMs=1000/60,drawReserve=4;
  let slices=0,maxSliceMs=0,frameYields=0;
  async function perform(phases,assertCurrent){
    for(let i=0;i<phases.length;){
      const cost=costs.get(phases[i].kind)??1;
      let available=frameMs-(performance.now()-lastFrame())-drawReserve;
      if(available<Math.min(6,Math.max(1,cost))){await new Promise(requestAnimationFrame);frameYields++;
        available=frameMs-(performance.now()-lastFrame())-drawReserve;}
      const budget=Math.min(6,Math.max(1,available)),first=i;
      let estimate=0;
      do{const next=costs.get(phases[i].kind);
        if(i>first&&(next===undefined||estimate+next>budget))break;
        estimate+=next??1;i++;if(next===undefined)break;
      }while(i<phases.length);
      assertCurrent?.();const start=performance.now(),e=device.createCommandEncoder();
      for(let j=first;j<i;j++)phases[j].encode(e);
      device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();
      const ms=performance.now()-start;maxSliceMs=Math.max(maxSliceMs,ms);slices++;
      const ratio=Math.min(4,Math.max(.25,ms/estimate)),seen=new Set();
      for(let j=first;j<i;j++){
        const kind=phases[j].kind;if(seen.has(kind))continue;seen.add(kind);
        const prev=costs.get(kind);costs.set(kind,prev===undefined?Math.max(.05,ms):Math.max(.02,prev*(.75+.25*ratio)));
      }
    }
  }
  return {perform,measure:()=>({slices,frameYields,maxSliceMs})};
}
