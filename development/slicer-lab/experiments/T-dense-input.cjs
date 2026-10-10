'use strict';
function dense(q,{min=0,max=4096,name='array'}={}){if(!Array.isArray(q)||q.length<min||q.length>max)throw Error('bounded dense '+name+' required');for(let i=0;i<q.length;i++)if(!Object.hasOwn(q,i))throw Error('sparse '+name+' rejected');return q;}
module.exports={dense};
