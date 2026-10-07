/** Analytic finite-difference profiles used to classify measured startup pixels.
 * Prediction alone never grants a native capability. */
export const DERIVATIVE_FIELDS={affine:p=>p[0]+2*p[1],cross:p=>p[0]*p[1]};
export function derivativePredictions(field,width=8,height=8){
 if(!DERIVATIVE_FIELDS[field]||width%2||height%2)throw Error('Reviewed field and even dimensions required');
 const sample=(x,y)=>DERIVATIVE_FIELDS[field]([2*(x+.5)/width-1,1-2*(y+.5)/height]);
 const rows=[];for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const left=x&~1,right=left+1,top=y&~1,bottom=top+1,h=sample(x,y),rgba=(dx,dy)=>[dx,dy,h,1];
  const fine=rgba(sample(right,y)-sample(left,y),sample(x,top)-sample(x,bottom)),profiles={fine};
  for(const row of ['top','bottom'])for(const column of ['left','right']){
   const r=row==='top'?top:bottom,c=column==='left'?left:right;
   profiles['coarse-'+row+'-'+column]=rgba(sample(right,r)-sample(left,r),sample(c,top)-sample(c,bottom));
  }
  rows.push({x,y,local:[2*(x+.5)/width-1,1-2*(y+.5)/height],profiles});
 }return rows;
}
export function classifyDerivativePixels(pixels,field,width=8,height=8){
 const predictions=derivativePredictions(field,width,height),names=Object.keys(predictions[0].profiles),scores=Object.fromEntries(names.map(n=>[n,0]));
 for(let i=0;i<predictions.length;i++)for(const name of names)for(let c=0;c<4;c++)scores[name]=Math.max(scores[name],Math.abs(pixels[i*4+c]-predictions[i].profiles[name][c]));
 return Object.entries(scores).map(([profile,maxAbsolute])=>({profile,maxAbsolute})).sort((a,b)=>a.maxAbsolute-b.maxAbsolute);
}
