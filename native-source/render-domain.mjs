/** Explicit raster resource domain; captured matrices and coordinates stay canonical. */
export function assertRenderDomain(domain='canonical'){
 if(!['canonical','gl-window'].includes(domain))throw Error('Explicit canonical or gl-window render domain required');return domain;
}
const fullHeight=height=>{if(!Number.isInteger(height)||height<1||height>=2**24)throw Error('Full integer render target height required');return height;};
export function renderDomainRect(rect,height,domain='canonical'){
 assertRenderDomain(domain);fullHeight(height);
 if(rect?.length!==4||Array.from(rect).some(v=>!Number.isInteger(v))||rect.some(v=>v<0)||rect[1]+rect[3]>height)throw Error('Canonical integer render rectangle required');
 const [x,y,w,h]=rect;return [x,domain==='gl-window'?height-y-h:y,w,h];
}
export function renderDomainPixel(point,height,domain='canonical'){
 assertRenderDomain(domain);fullHeight(height);
 if(point?.length!==2||Array.from(point).some(v=>!Number.isFinite(v))||point[0]<0||point[1]<0||point[1]>=height)throw Error('Canonical point inside render target required');
 const [x,y]=Array.from(point,Math.floor);return [x,domain==='gl-window'?height-1-y:y];
}
export function renderDomainPoint(point,height,domain='canonical'){
 assertRenderDomain(domain);fullHeight(height);
 if(point?.length!==2||Array.from(point).some(v=>!Number.isFinite(v)))throw Error('Finite fragment coordinate required');
 return [point[0],domain==='gl-window'?height-point[1]:point[1]];
}
export function renderDomainFrontFace(frontFace,domain='canonical'){
 assertRenderDomain(domain);if(!['ccw','cw'].includes(frontFace))throw Error('Explicit source frontFace required');
 return domain==='gl-window'?(frontFace==='ccw'?'cw':'ccw'):frontFace;
}
export function renderDomainClip(clip,domain='canonical'){
 assertRenderDomain(domain);if(clip?.length!==4||Array.from(clip).some(v=>!Number.isFinite(v)))throw Error('Finite final clip position required');
 return [clip[0],domain==='gl-window'?-clip[1]:clip[1],clip[2],clip[3]];
}
export function assertAdapterRenderDomain(adapter,domain='canonical'){
 assertRenderDomain(domain);const supplied=adapter?.renderDomain??(domain==='canonical'?'canonical':null);
 if(supplied!==domain)throw Error('Native adapter render domain mismatch');return adapter;
}
export function renderDomainWGSL(domain='canonical'){
 const reflected=assertRenderDomain(domain)==='gl-window';
 return /*wgsl*/`
fn frameRenderPosition(clip:vec4f)->vec4f {return ${reflected?'vec4f(clip.x,-clip.y,clip.zw)':'clip'};}
fn frameCanonicalFragmentPoint(point:vec2f,height:f32)->vec2f {return ${reflected?'vec2f(point.x,height-point.y)':'point'};}
fn frameRenderDepthPixel(pixel:vec2i,height:i32)->vec2i {return ${reflected?'vec2i(pixel.x,height-1-pixel.y)':'pixel'};}
`;
}
