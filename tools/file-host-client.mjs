// This exact function is embedded in index.html; tests reject divergence.
export async function connectFrameFileHost({url,token}){
  const fail=(message,code='FILE_HOST_CONNECTION_FAILED',status)=>{throw Object.assign(Error(message),{code,...(status===undefined?{}:{status})});};
  let endpoint;try{endpoint=new URL(url);}catch{fail('A loopback file host URL is required','INVALID_ARGUMENT');}
  if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||!endpoint.port||endpoint.pathname!=='/frame-file/v1/'||endpoint.search||endpoint.hash||endpoint.username||endpoint.password||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))fail('Use the exact URL and session token printed by the local Frame file host','INVALID_ARGUMENT');
  if(window.top!==window)fail('Connect the main Frame document, not an embedded frame','INVALID_ARGUMENT');
  if(typeof window.__frameFileHost==='function')fail('A file host is already attached to this document','FILE_HOST_ALREADY_CONNECTED');
  const request=async(route,key,body)=>{let response;try{response=await fetch(new URL(route,endpoint),{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify(body),credentials:'omit',redirect:'error',cache:'no-store'});}catch{fail('Cannot reach the local Frame file host. Keep the host running and allow the browser local-network permission if requested.');}let result;try{result=await response.json();}catch{fail('Invalid response from the local Frame file host');}if(!response.ok||result.error)fail(result.error||'Local file host rejected the request',result.code||'FILE_HOST_REJECTED',response.status);return result;};
  let session=null,closed=false,last=0,idleMs=0,renewing=null;
  const renew=()=>{if(closed)fail('File host connection is closed','FILE_HOST_DISCONNECTED');if(!renewing)renewing=(async()=>{const connected=await request('connect',token,{session});if(typeof connected.session!=='string'||!/^[a-f0-9]{64}$/.test(connected.session)||!Number.isFinite(connected.idleMs)||connected.idleMs<=0)fail('Invalid file host session');session=connected.session;idleMs=connected.idleMs;last=Date.now();if(closed)fail('File host connection is closed','FILE_HOST_DISCONNECTED');})().finally(()=>{renewing=null;});return renewing;};
  await renew();
  const host=async args=>{if(closed)fail('File host connection is closed','FILE_HOST_DISCONNECTED');const begin=args?.op==='beginRead'||args?.op==='beginWrite';if(begin&&Date.now()-last>=idleMs*0.75)await renew();let result;try{result=await request('file',session,args);}catch(error){if(!begin||error.status!==403||error.code!=='FILE_HOST_DENIED'||closed)throw error;await renew();result=await request('file',session,args);}last=Date.now();return result;};
  const close=async()=>{if(closed)return;closed=true;token=null;window.removeEventListener('pagehide',hide);if(window.__frameFileHost===host)delete window.__frameFileHost;if(window.__frameFileHostConnection===connection)delete window.__frameFileHostConnection;if(renewing)await renewing.catch(()=>{});const key=session;session=null;if(key)await request('disconnect',key,{});};
  const hide=()=>{void close().catch(()=>{});},connection={url:endpoint.href,close};
  window.__frameFileHost=host;window.__frameFileHostConnection=connection;window.addEventListener('pagehide',hide,{once:true});
  return {connected:true,url:endpoint.href};
}
