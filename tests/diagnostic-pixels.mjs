// Test-only adapter. Keep the shipped diagnostics.pixels API limit unchanged.
export const DIAGNOSTIC_PIXEL_LIMIT=64;
export async function readDiagnosticPixels(call,points,options={}){
 const colors=[];
 for(let offset=0;offset<points.length;offset+=DIAGNOSTIC_PIXEL_LIMIT){
  const batch=points.slice(offset,offset+DIAGNOSTIC_PIXEL_LIMIT),result=await call('diagnostics.pixels',{...options,points:batch});
  if(!Array.isArray(result?.colors)||result.colors.length!==batch.length)throw Error('diagnostics.pixels returned an incomplete batch at '+offset);
  colors.push(...result.colors);
 }
 return {colors};
}
