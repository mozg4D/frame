import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceFixtures,expectedLabels} from './hardware-fixtures.mjs';
const fixtures=surfaceFixtures();
for(const fixture of fixtures)test('independent clipping oracle: '+fixture.name,()=>{
 const labels=expectedLabels(fixture);assert.equal(labels.length,64);assert.ok(labels.every(x=>[0,2,3].includes(x)));
 if(fixture.surfaceCells!==undefined)assert.equal(labels.filter(v=>v===2).length,fixture.surfaceCells);
 if(fixture.uncertainCells!==undefined)assert.equal(labels.filter(v=>v===3).length,fixture.uncertainCells);
});
test('analytic slab is x=2; winding, duplication and storage layout cannot alter it',()=>{
 const a=expectedLabels(fixtures[0]);for(let i=0;i<64;i++)assert.equal(a[i],i%4===2?2:0);
 for(const name of ['reversed-winding','duplicate-600-triangles-three-batches','paged-position-and-index-layer-boundaries'])assert.deepEqual(expectedLabels(fixtures.find(f=>f.name===name)),a);
 assert.notDeepEqual(expectedLabels(fixtures.find(f=>f.name==='dyadic-shear-crossing')),a);
});
