// Diagnostic only: neutral, fixed lighting makes false color-to-height edges visible.
export function shade({width,height,pixels},color=null,light=[-.6,.32,.73]) {
  const out=new Uint8ClampedArray(pixels.length),ll=Math.hypot(...light),l=light.map(v=>v/ll),h=[l[0],l[1],l[2]+1],hl=Math.hypot(...h);
  for(let i=0;i<pixels.length;i+=4) {
    const n=[pixels[i]/127.5-1,pixels[i+1]/127.5-1,pixels[i+2]/127.5-1],nl=Math.hypot(...n);
    const diffuse=Math.max(0,(n[0]*l[0]+n[1]*l[1]+n[2]*l[2])/nl);
    const spec=.12*Math.pow(Math.max(0,(n[0]*h[0]+n[1]*h[1]+n[2]*h[2])/(nl*hl)),36);
    for(let c=0;c<3;c++) {
      const albedo=color?Math.pow(color[i+c]/255,2.2):.33;
      out[i+c]=255*Math.pow(Math.min(1,albedo*(.23+.95*diffuse)+spec),1/2.2);
    }
    out[i+3]=255;
  }
  return {width,height,pixels:out};
}
export function metrics({pixels,width,height}) {
  let sum=0,sumSq=0,max=0,lengthError=0,clipped=0,seam=0,interior=0;
  const angles=new Float32Array(width*height);
  const diff=(a,b)=>Math.hypot(pixels[a]-pixels[b],pixels[a+1]-pixels[b+1],pixels[a+2]-pixels[b+2])/127.5;
  for(let i=0;i<pixels.length;i+=4) {
    const x=pixels[i]/127.5-1,y=pixels[i+1]/127.5-1,z=pixels[i+2]/127.5-1,len=Math.hypot(x,y,z),angle=Math.acos(Math.min(1,z/len))*180/Math.PI;
    angles[i/4]=angle;sum+=angle;sumSq+=angle*angle;max=Math.max(max,angle);lengthError=Math.max(lengthError,Math.abs(len-1));if(z<=0)clipped++;
  }
  angles.sort();
  for(let y=0;y<height;y++) {seam+=diff(y*width*4,(y*width+width-1)*4);for(let x=1;x<width;x++)interior+=diff((y*width+x)*4,(y*width+x-1)*4);}
  for(let x=0;x<width;x++) {seam+=diff(x*4,((height-1)*width+x)*4);for(let y=1;y<height;y++)interior+=diff((y*width+x)*4,((y-1)*width+x)*4);}
  const count=pixels.length/4;
  return {meanTiltDeg:sum/count,rmsTiltDeg:Math.sqrt(sumSq/count),p95TiltDeg:angles[Math.floor(.95*(count-1))],maxTiltDeg:max,maxUnitLengthError:lengthError,backFacingPixels:clipped,seamMeanDelta:seam/(width+height),interiorMeanDelta:interior/(2*count-width-height)};
}
