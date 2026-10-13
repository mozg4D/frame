// A reservation outlives temporary canonical stamp changes. Only its owner may
// replace the display adapter; automatic preparation must wait for release.
const reservations=new WeakMap();
export function reserveDisplayOverride(object,owner){
 if(!object||!owner||typeof owner!=='object')throw new TypeError('Display object and opaque owner required');
 const prior=reservations.get(object);if(prior?.live)throw new DOMException('Display override is reserved','AbortError');
 const row={object,owner,live:true,current(){return this.live&&reservations.get(object)===this;},dispose(){if(!this.live)return;this.live=false;if(reservations.get(object)===this)reservations.delete(object);}};
 reservations.set(object,row);return row;
}
export function displayOverrideReserved(object){return reservations.get(object)?.live===true;}
export function assertDisplayOverrideOwner(object,owner=null){const row=reservations.get(object);if(row?.live&&row.owner!==owner)throw new DOMException('Display override belongs to another owner','AbortError');}
// Only private mutable numeric-display packets opt into this async lifetime
// guard. Ordinary numeric scene snapshots retain existing restoration rules.
export function assertPrivateDisplayPacketCurrent(packet){const guard=packet?.privateLeaseCurrent;if(guard!==undefined&&typeof guard!=='function')throw new TypeError('Explicit private packet guard required');if(guard&&!guard())throw new DOMException('Private numeric display pose retired','AbortError');}
