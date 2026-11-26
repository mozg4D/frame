import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {serve} from '../tools/browser.mjs';
import {cavityData} from './camera-transport-replay.mjs';

// Localize any integration discrepancy to tensor upload, multiplication,
// per-receiver reflectance, accumulation, or the lowering of a chained graph.
async function validate(){
  const {n,rows,W,X,R}=window.cavityData(8,8,16),results=[];
  for(const dataType of ['float16','float32']){
    const cast=dataType==='float16'?Float16Array:Float32Array;
    const inputDesc={dataType,shape:[rows,n]},weightDesc={dataType,shape:[n,n]};
    const expected=[Float64Array.from(X)],totals=[Float64Array.from(X)],products=[];
    for(let k=0;k<4;k++){
      const product=new Float64Array(rows*n),next=new Float64Array(rows*n);
      for(let i=0;i<rows;i++)for(let j=0;j<n;j++){
        const at=i*n+j;for(let s=0;s<n;s++)product[at]+=expected[k][i*n+s]*W[s*n+j];next[at]=product[at]*R[at];
      }
      products.push(product);expected.push(next);totals.push(totals[k].map((x,i)=>x+next[i]));
    }
    const ctx=await navigator.ml.createContext({deviceType:'gpu'});
    try{for(const shape of ['copy','multiply','scale','reflect','reflect-runtime','reflect-reverse','reflect-flat','one','four','four-runtime','four-flat']){
      const row={dataType,shape};results.push(row);let g,x,y,reflectance;
      try{
        const b=new MLGraphBuilder(ctx),a=b.input('x',inputDesc),w=b.constant(weightDesc,new cast(W)),dynamic=shape.endsWith('-runtime');
        const r=dynamic?b.input('rho',inputDesc):b.constant(inputDesc,new cast(R));
        const scale=p=>shape.endsWith('-flat')?b.reshape(b.mul(b.reshape(p,[rows*n]),b.reshape(r,[rows*n])),[rows,n]):shape.endsWith('-reverse')?b.mul(r,p):b.mul(p,r);
        let out=a,wanted=expected[0];
        if(shape==='copy'){out=b.identity(a);}
        else if(shape==='multiply'){out=b.matmul(a,w);wanted=products[0];}
        else if(shape==='scale'){out=scale(a);wanted=expected[0].map((v,i)=>v*R[i]);}
        else if(shape.startsWith('reflect')){out=scale(b.matmul(a,w));wanted=expected[1];}
        else{let bounce=a;const count=shape==='one'?1:4;for(let i=0;i<count;i++){bounce=scale(b.matmul(bounce,w));out=b.add(out,bounce);}wanted=totals[count];}
        g=await b.build({y:out});row.graphDevices=Array.from(g.devices||[]);
        x=await ctx.createTensor({...inputDesc,writable:true});y=await ctx.createTensor({...inputDesc,readable:true});
        const inputs={x};if(dynamic){reflectance=await ctx.createTensor({...inputDesc,writable:true});ctx.writeTensor(reflectance,new cast(R));inputs.rho=reflectance;}
        ctx.writeTensor(x,new cast(X));ctx.dispatch(g,inputs,{y});const actual=new cast(await ctx.readTensor(y));let err=0,norm=0,maxAbs=0;
        for(let i=0;i<actual.length;i++){err+=(actual[i]-wanted[i])**2;norm+=wanted[i]**2;maxAbs=Math.max(maxAbs,Math.abs(actual[i]-wanted[i]));}
        row.nrmse=Math.sqrt(err/norm);row.maxAbs=maxAbs;row.probe=[actual[0],wanted[0],actual[n/2],wanted[n/2]];
      }catch(e){row.failure=String(e);}
      finally{reflectance?.destroy();x?.destroy();y?.destroy();g?.destroy();}
    }}finally{ctx.destroy();}
  }
  return results;
}
const args=process.argv.slice(2),channel=args.find(a=>a.startsWith('--channel='))?.slice(10)||'chromium';
const server=await serve();let browser;
try{
  browser=await chromium.launch({channel,headless:true,args:['--enable-unsafe-webgpu','--enable-features=WebMachineLearningNeuralNetwork']});
  const page=await browser.newPage();await page.goto(server.url+'/frame-icon.svg');await page.evaluate('window.cavityData='+cavityData.toString());
  const results=await page.evaluate(validate),report={browser:browser.version(),results};console.log(JSON.stringify(report));
  const path=args.find(a=>a.startsWith('--report='))?.slice(9);if(path)await writeFile(path,JSON.stringify(report,null,2));
}finally{await browser?.close();await server.close();}
