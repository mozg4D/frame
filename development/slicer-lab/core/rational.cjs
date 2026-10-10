'use strict';
const gcd=(a,b)=>{a=a<0n?-a:a;b=b<0n?-b:b;while(b)[a,b]=[b,a%b];return a;};
function rat(n,d=1n){if(d===0n)throw Error('zero denominator');if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return{n:n/g,d:d/g};}
const add=(a,b)=>rat(a.n*b.d+b.n*a.d,a.d*b.d),sub=(a,b)=>rat(a.n*b.d-b.n*a.d,a.d*b.d),mul=(a,b)=>rat(a.n*b.n,a.d*b.d),div=(a,b)=>rat(a.n*b.d,a.d*b.n),cmp=(a,b)=>a.n*b.d<b.n*a.d?-1:a.n*b.d>b.n*a.d?1:0;
const str=a=>a.n+'/'+a.d,parse=s=>{if(typeof s!=='string'||!/^[-]?\d+\/\d+$/.test(s))throw Error('invalid exact parameter');const[n,d]=s.split('/').map(BigInt);return rat(n,d);};
function exact(x){if(!Number.isFinite(x))throw Error('nonfinite');if(!x)return rat(0n);const v=new DataView(new ArrayBuffer(8));v.setFloat64(0,x);const b=v.getBigUint64(0),E=Number((b>>52n)&2047n);let n=b&4503599627370495n;if(E)n|=4503599627370496n;if(b>>63n)n=-n;const e=E?E-1075:-1074;return e<0?rat(n,1n<<BigInt(-e)):rat(n<<BigInt(e));}
const number=a=>{if(!a.n)return 0;const sign=a.n<0n?-1:1,n=a.n<0n?-a.n:a.n,sn=Math.max(0,n.toString(2).length-53),sd=Math.max(0,a.d.toString(2).length-53);return sign*(Number(n>>BigInt(sn))/Number(a.d>>BigInt(sd)))*2**(sn-sd);},zero=rat(0n),one=rat(1n),dot=(a,b)=>add(mul(a[0],b[0]),mul(a[1],b[1])),vec=(a,b)=>a.map((v,k)=>sub(v,b[k])),cross=(a,b)=>sub(mul(a[0],b[1]),mul(a[1],b[0]));
module.exports={rat,add,sub,mul,div,cmp,str,parse,exact,number,zero,one,dot,vec,cross};

