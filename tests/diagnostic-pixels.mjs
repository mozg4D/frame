// Test-only adapter. Keep the shipped diagnostics.pixels API limit unchanged.
export const DIAGNOSTIC_PIXEL_LIMIT=64;
export function isOrthoWirePixel([r,g,b]){
 const luma=.2126*r+.7152*g+.0722*b,spread=Math.max(r,g,b)-Math.min(r,g,b);
 return luma>68&&luma<76&&spread>=28&&spread<=40;
}
// diagnostics.pixels accepts CSS coordinates; visit adjacent physical pixels.
export function physicalPixelNeighborhoods(screens,rect,backing){
 const stepX=rect.width/backing.width,stepY=rect.height/backing.height;
 return screens.flatMap(([x,y])=>[-1,0,1].flatMap(dy=>[-1,0,1].map(dx=>[x+dx*stepX,y+dy*stepY])));
}
export async function readDiagnosticPixels(call,points,options={}){
 const colors=[];
 for(let offset=0;offset<points.length;offset+=DIAGNOSTIC_PIXEL_LIMIT){
  const batch=points.slice(offset,offset+DIAGNOSTIC_PIXEL_LIMIT),result=await call('diagnostics.pixels',{...options,points:batch});
  if(!Array.isArray(result?.colors)||result.colors.length!==batch.length)throw Error('diagnostics.pixels returned an incomplete batch at '+offset);
  colors.push(...result.colors);
 }
 return {colors};
}
