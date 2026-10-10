'use strict';
function integersForRings(rings){const {exactIntegers}=require('./contour-core.cjs'),all=exactIntegers(rings.flat());let at=0;return rings.map(r=>{const q=all.slice(at,at+r.length);at+=r.length;return q;});}
const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),sign=q=>q<0n?-1:q>0n?1:0,same=(a,b)=>a[0]===b[0]&&a[1]===b[1],on=(p,a,b)=>!orient(a,b,p)&&(p[0]-a[0])*(p[0]-b[0])+(p[1]-a[1])*(p[1]-b[1])<=0n;
function touch(a,b,c,d){const s=[sign(orient(a,b,c)),sign(orient(a,b,d)),sign(orient(c,d,a)),sign(orient(c,d,b))];return s[0]*s[1]<0&&s[2]*s[3]<0||on(a,c,d)||on(b,c,d)||on(c,a,b)||on(d,a,b);}
module.exports={integersForRings,orient,sign,same,on,touch};
