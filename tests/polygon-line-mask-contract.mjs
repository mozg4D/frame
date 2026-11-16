import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {maskPixelCoordinates} from './polygon-line-mask.mjs';
import {physicalPixelNeighborhoods} from './diagnostic-pixels.mjs';

export function polygonLineMaskContractChecks(){
 const checks=[],test=(name,mask,rect,screens,expected)=>{const before=structuredClone(screens);assert.deepEqual(maskPixelCoordinates(mask,rect,screens),expected);assert.deepEqual(screens,before);checks.push({name,pass:true});};
 const rect={left:180,top:24,width:800,height:600},points=[[180,24],[280,174],[980,624]];
 test('DPR1 subtracts viewport origin',{width:800,height:600},rect,points,[[0,0],[100,150],[800,600]]);
 test('DPR2 maps CSS points into the physical mask',{width:1600,height:1200},rect,points,[[0,0],[200,300],[1600,1200]]);
 test('Fractional density follows actual backing dimensions',{width:1200,height:900},rect,points,[[0,0],[150,225],[1200,900]]);
 test('Independent horizontal and vertical backing scales',{width:1600,height:900},rect,points,[[0,0],[200,225],[1600,900]]);
 test('Negative viewport coordinates remain valid',{width:800,height:600},{left:-300,top:-200,width:400,height:300},[[-250,-125]],[[100,150]]);
 test('Outside probes remain outside instead of clamping onto a visible edge',{width:1600,height:1200},rect,[[179,23],[981,625]],[[-2,-2],[1602,1202]]);
 const correct=maskPixelCoordinates({width:1600,height:1200},rect,[[280,174]])[0];assert.notDeepEqual(correct,[280,174]);assert.notDeepEqual(correct,[560,348]);checks.push({name:'Negative controls reject CSS indexing and scaling without viewport translation',pass:true});
 assert.deepEqual(physicalPixelNeighborhoods([[280,174]],rect,{width:1600,height:1200}),[[279.5,173.5],[280,173.5],[280.5,173.5],[279.5,174],[280,174],[280.5,174],[279.5,174.5],[280,174.5],[280.5,174.5]]);checks.push({name:'DPR2 diagnostic neighborhoods visit adjacent physical pixels without gaps',pass:true});
 assert.deepEqual(physicalPixelNeighborhoods([[280,174]],rect,{width:800,height:600}),[[279,173],[280,173],[281,173],[279,174],[280,174],[281,174],[279,175],[280,175],[281,175]]);checks.push({name:'DPR1 diagnostic neighborhoods retain their original samples',pass:true});
 assert.notDeepEqual(physicalPixelNeighborhoods([[280,174]],rect,{width:1600,height:1200}),physicalPixelNeighborhoods([[280,174]],rect,{width:800,height:600}));checks.push({name:'Negative control rejects a CSS-pixel grid that skips DPR2 neighbours',pass:true});
 return {pass:true,checks,scope:'CPU physical-pixel coordinate contract; native pixels and visibility remain separate hardware gates'};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(polygonLineMaskContractChecks(),null,2));
