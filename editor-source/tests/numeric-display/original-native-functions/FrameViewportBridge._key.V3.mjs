import {packDraw} from "../../../../native-source/gpu-display.mjs";
import {textureState} from "../../../../native-source/texture-policy.mjs";
export function v3Key(packet,ratio){
  if(packet.kind.startsWith('printer-'))return null; // printer uniforms can be camera dependent; retained per in-flight frame only
  const m=packet.material,t=m.texture;
  return [this.renderDomain,this._id(packet.geometry),this._id(packet.instances),this._id(packet.indices),packet.kind,packet.start,packet.count,packet.renderOrder,
   m.cullMode,m.transparent,m.depthWrite,m.depthTest,m.colorWrite,m.depthBias,m.slopeBias,this._id(t),t?.version,t?.source?.version,
   ...textureState(t).map(v=>this._id(v)),
   ...new Uint32Array(packDraw(packet,ratio).buffer)].join('|');
 }
