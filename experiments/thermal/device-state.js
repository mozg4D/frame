// Subscribe once per shared device, outside every job's lexical environment.
// A pending device.lost promise must never retain retired scene/result closures.
const deviceStates=new WeakMap(),noDeviceState=Object.freeze({lost:false});
function makeDeviceState(device){
 const state={lost:false};
 device.lost?.then(()=>{state.lost=true;},()=>{state.lost=true;});
 return state;
}
export function sharedThermalDeviceState(device){
 if(!device||(typeof device!=='object'&&typeof device!=='function'))return noDeviceState;
 let state=deviceStates.get(device);
 if(!state){state=makeDeviceState(device);deviceStates.set(device,state);}
 return state;
}
