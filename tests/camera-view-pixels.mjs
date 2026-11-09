import test from 'node:test';import assert from 'node:assert/strict';
import {standardCameraFilmValid} from './camera-view.mjs';
const film=(foreground=[1.5,1.5,1.5,128],background=[.13,.13,.13,128])=>({width:744,height:760,colors:[foreground,background]});
test('default studio and unit emissive foreground have resolved physical contrast',()=>assert.equal(standardCameraFilmValid(film()),true));
test('black background cannot substitute for the enabled default environment',()=>assert.equal(standardCameraFilmValid(film(undefined,[0,0,0,128])),false));
test('an environment-only image cannot substitute for the emissive fixture',()=>assert.equal(standardCameraFilmValid(film([.13,.13,.13,128])),false));
test('a partially accumulated image cannot substitute for 128 completed samples',()=>assert.equal(standardCameraFilmValid(film([1.5,1.5,1.5,127])),false));
test('nonfinite, colored or malformed background is rejected',()=>{for(const p of [film(undefined,[NaN,.13,.13,128]),film(undefined,[.13,.14,.13,128]),{width:1,height:1,colors:[[1,1,1,128]]}])assert.equal(standardCameraFilmValid(p),false)});
