window.frameBootDiagnostics={errors:[]};
const frameBootOutput=document.createElement('textarea');
frameBootOutput.id='frame-boot-errors';frameBootOutput.hidden=true;document.body.appendChild(frameBootOutput);
const recordFrameBootError=entry=>{window.frameBootDiagnostics.errors.push(entry);const value=JSON.stringify(window.frameBootDiagnostics.errors);frameBootOutput.value=value;frameBootOutput.textContent=value;frameBootOutput.setAttribute('data-errors',value);};
addEventListener('error',event=>recordFrameBootError({message:event.message,source:event.filename,line:event.lineno,column:event.colno}));
addEventListener('unhandledrejection',event=>recordFrameBootError({message:String(event.reason?.stack||event.reason)}));
