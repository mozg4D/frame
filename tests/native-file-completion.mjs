export async function installNativeFileCompletion(page,name){
 await page.evaluate(name=>{
  if(window.__testNativeFileCompletion)throw Error('Native file completion observer already installed');
  const state={name,seen:false,listener:event=>{if(event.detail.name===name)state.seen=true;}};
  window.__testNativeFileCompletion=state;
  window.addEventListener('frame-engine-scene',state.listener);
 },name);
}
export async function waitNativeFileCompletion(page,name,timeout=5000){
 await page.waitForFunction(name=>window.__testNativeFileCompletion?.name===name&&window.__testNativeFileCompletion.seen&&frameEngine.idle&&!document.getElementById('app').inert&&!document.getElementById('frame-file-progress'),name,{timeout});
}
export async function restoreNativeFileCompletion(page){
 await page.evaluate(()=>{
  const state=window.__testNativeFileCompletion;
  if(state)window.removeEventListener('frame-engine-scene',state.listener);
  delete window.__testNativeFileCompletion;
 });
}
