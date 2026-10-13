import fs from 'node:fs';import {createRequire} from 'node:module';
import {fixture as originalFixture,install as originalInstall,THREE,vm,assert,sha,source} from './baseline-context.mjs';
const require=createRequire(import.meta.url),ts=require(process.env.FRAME_TYPESCRIPT||'typescript'),build=JSON.parse(fs.readFileSync(new URL('../../build-manifest.json',import.meta.url))),spec=JSON.parse(fs.readFileSync(new URL('../../'+build.r247Integration,import.meta.url))),text=fs.readFileSync(new URL('../../../'+build.productionEditor,import.meta.url),'utf8'),ast=ts.createSourceFile('current-runtime',text,99,true,1);
assert.equal(ts.version,build.typescript);assert.equal(sha(text),build.productionSHA256);assert.equal(sha(text),spec.afterSHA256);
const actual=name=>{const n=ast.statements.findLast(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(n,name);return n.getText(ast);};
export const manifest={changedFunctions:spec.functions,addedFunctions:spec.helpers,candidateEditorSHA256:spec.afterSHA256};
export function install(ctx,candidate=true){originalInstall(ctx,false);if(candidate){for(const row of spec.helpers){const code=actual(row.name);assert.equal(sha(code),row.sha256);assert.equal(code,row.code);vm.runInContext(code,ctx);}for(const row of spec.functions){assert.equal(sha(source(row.name)),row.beforeSHA256);const code=actual(row.name);assert.equal(sha(code),row.afterSHA256);assert.equal(code,row.code);vm.runInContext(code,ctx);}}}
export function fixture(options={}){const f=originalFixture({...options,candidate:false});f.ctx.frameDrainSelectionWork=f.drain;f.ctx.framePolySelectionMeasurements=function*(items){return f.measure(items);};install(f.ctx,options.candidate!==false);return f;}
export {THREE,vm,assert,sha,source};
