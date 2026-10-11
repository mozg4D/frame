'use strict';
// A zero exit code alone is insufficient: Node can exit with unresolved promises.
const assert=require('node:assert/strict');
function requireCompletion(result,script,sentinel){assert.equal(result.status,0,script+' failed\n'+result.stdout+'\n'+result.stderr);if(!sentinel)return;const rows=String(result.stdout).split(/\r?\n/).filter(Boolean).flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}});assert(rows.some(q=>q.passed===true&&q.completionSentinel===sentinel),script+' exited without its completion sentinel');}
module.exports={requireCompletion};
