import {sceneControlNativeBoundaries} from './scene-control-native-boundaries.mjs';
// Focused DATA-ONLY integration gate. Uses only the actual Frame scene/API,
// native UI transactions and HASH codec. Stored source is never executed.
// No dependency install, alternate browser, software GPU, CDP/user scene,
// large fixture, publication or upload is part of this test.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = resolve(root, 'tests/results/scene-control-data-browser');
const digest = data => createHash('sha256').update(data).digest('hex');
const indexHash = async () => digest(await readFile(new URL('../index.html', import.meta.url)));
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
const clone = value => structuredClone(value);
const id = digit => digit.repeat(32);
const R = {source:id('1'), schema:id('2'), unused:id('3'), binding:id('4')};
const O = {source:id('1'), binding:id('2'), schema:id('3'), opaque:id('4')};
const missing = id('0');
const missingRoot = id('e');
const expected = snapshot => ({epoch:snapshot.epoch, revision:snapshot.data.revision});
const byName = (data, name) => data.records.find(r => r.name === name);
const record = (key, name, kind, payload, refs = []) => ({id:key, revision:0, name, kind, refs, payload});
const sourceText = (owner, label) => `// ${label}: Ω 😀 e\u0301\r\n\t exact trailing spaces  \n` +
  `globalThis.__sceneDataExecutionSentinel += 1;\nthrow new Error("STORED SOURCE EXECUTED");\n` +
  `// import "./never-load-scene-control-module.js";\nconst literal = "${owner}";\n`;

async function decodeHash(base64) {
  const file = new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))]);
  const records = await FrameHash.index(file);
  const value = async key => { const r = records.get(key); return r ? FrameHash.read(file, r) : undefined; };
  const parameters = JSON.parse(await value(FrameHash.K.parameters) || '{}');
  const hashes = Array.from(await value(FrameHash.K.all) || []), objects = [];
  for (const hash of hashes) {
    const authoring = JSON.parse(await value(FrameHash.address(hash, 'parameters')) || '{}');
    objects.push({hash, authorData:authoring.authorData ?? null});
  }
  return {root:parameters.authorData ?? null, objects};
}

function openComplete({bytes, previous}) {
  const canvas = document.querySelector('#frame-engine-canvas');
  if (!canvas || document.querySelector('#app').inert || !frameEngine.idle || canvas.dataset.ready !== 'true' || canvas.dataset.operationError || !canvas.dataset.hashLoad || canvas.dataset.hashLoad === previous) return false;
  const done = JSON.parse(canvas.dataset.hashLoad);
  return done.fileBytes === bytes && Number.isFinite(done.elapsedMs);
}

export async function sceneControlDataBrowserChecks(page) {
  const report = {pass:false, status:'running', startedAt:new Date().toISOString(), sourceBefore:await indexHash(), browserAssertions:0,
    checks:[], cases:[], timings:[], pageErrors:[], consoleErrors:[], pluginModuleRequests:[], authorModuleRequests:[], diagnostics:{}, cleanup:{}};
  const {checks, cases, timings, diagnostics} = report;
  const check = (name, pass, detail) => {
    checks.push({name, pass:!!pass, ...(detail === undefined ? {} : {detail})});
    report.browserAssertions++;
    assert.ok(pass, name + (detail === undefined ? '' : ': ' + canonical(detail)));
  };
  const equal = (name, actual, wanted) => check(name, canonical(actual) === canonical(wanted), canonical(actual) === canonical(wanted) ? undefined : {actual, expected:wanted});
  const restored = (label,actual,previous,additionallyReserved = []) => {
    equal(label+' restores exact live records and content revision',{version:actual.version,revision:actual.revision,records:actual.records},{version:previous.version,revision:previous.revision,records:previous.records});
    const live = new Set(actual.records.map(r => r.id));
    const wanted = [...new Set([...(previous.retired || []),...additionallyReserved])].filter(key => !live.has(key)).sort();
    equal(label+' retains the exact inactive ID reservation union',[...(actual.retired || [])].sort(),wanted);
    check(label+' reservations are bounded, unique and disjoint from live IDs',(actual.retired || []).length <= 4096 && new Set(actual.retired || []).size === (actual.retired || []).length && !(actual.retired || []).some(key => live.has(key)));
  };
  const timed = async (name, budgetMs, operation) => {
    const start = performance.now();
    let completed = false;
    try { const result = await operation(); completed = true; return result; }
    finally { const ms = performance.now() - start; timings.push({name, ms, budgetMs, completed}); if (completed) check(name + ' completed-operation latency', ms < budgetMs, {ms,budgetMs}); }
  };
  const call = (name, args = {}) => timed(name, /^(scene\.(open|merge|export|duplicate)|edit\.(copy|paste|history))$/.test(name) ? 6000 : 3000,
    () => page.evaluate(([n,a]) => frameAI.call(n,a), [name,args]));
  const get = (owner = 'scene') => call('authorData.get', {owner});
  const inspect = (owner = 'scene') => call('authorData.inspect', {owner});
  const read = (owner, field) => call('fields.read', {owner,field});
  const replace = async (owner, records, version) => call('authorData.replace', {owner, records, expected:version || expected(await get(owner))});
  const state = () => call('scene.inspect');
  const history = () => page.evaluate(async () => {
    const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),v => v.toString(16).padStart(2,'0')).join('');
    return {undo:undoStack.length,redo:redoStack.length,undoSHA256:await hash(undoStack),redoSHA256:await hash(redoStack),undoSequence:[...frameUIUndoSequence],redoSequence:[...frameUIRedoSequence]};
  });
  const allData = async () => { const objects = (await state()).objects; return {scene:await get(), objects:await Promise.all(objects.map(async o => ({hash:o.hash,name:o.name,visible:o.visible,authorData:await get(o.hash)}))),history:await history()}; };
  const reject = async (label, command, args, errorPattern) => {
    assert.ok(errorPattern instanceof RegExp, 'Each rejection must name its actual expected error');
    const before = await allData();
    // Catch in the actual page. A Playwright transport failure is never a
    // successful application-level rejection.
    const error = await timed(label, 3000, () => page.evaluate(async ([n,a]) => {
      try { await frameAI.call(n,a); return null; } catch (e) { return {message:e.message,code:e.code}; }
    }, [command,args]));
    check(label + ' rejects for the specified reason', !!error && typeof error.code === 'string' && errorPattern.test(error.message), {error,expected:String(errorPattern)});
    equal(label + ' preserves all native metadata, author data, epochs and Undo/Redo', await allData(), before);
  };
  const run = async (name, operation) => { const entry = {name, pass:false}; cases.push(entry); await operation(); entry.pass = true; };
  const nativeOpen = data => timed('Native file-input Open', 6000, async () => {
    const previous = await page.locator('#frame-engine-canvas').getAttribute('data-hash-load');
    await page.locator('#frameSceneFile').setInputFiles({name:'scene-control-data-fixture.hash',mimeType:'application/x-frame-hash',buffer:Buffer.from(data.base64,'base64')});
    await page.waitForFunction(openComplete, {bytes:data.bytes,previous}, {timeout:6000}); await state();
  });
  const nativeSave = () => timed('Native Save As HASH', 6000, async () => {
    // Stub only the OS file-picker/writable boundary. The native menu, command,
    // streaming HASH serializer and completion all run unchanged.
    await page.evaluate(() => {
      window.__sceneDataSave = {parts:[], closed:false, original:window.showSaveFilePicker};
      window.showSaveFilePicker = async options => ({name:options.suggestedName,createWritable:async () => ({write:async part => __sceneDataSave.parts.push(new Blob([part])),close:async () => {__sceneDataSave.closed = true;},abort:async () => {throw Error('Unexpected native HASH save abort');}})});
    });
    try {
      await page.mouse.move(400,500); await page.locator('#btnSave').hover();
      await page.getByRole('menuitem',{name:'Frame scene (.hash)',exact:true}).click();
      await page.waitForFunction(() => __sceneDataSave.closed && !document.querySelector('#app').inert, {}, {timeout:6000});
      const bytes = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await new Blob(__sceneDataSave.parts).arrayBuffer()))));
      check('Native Save produced bounded nonempty HASH', bytes.length > 0 && bytes.length < 2 * 1048576, {bytes:bytes.length});
      return {base64:bytes.toString('base64'),bytes:bytes.length,sha256:digest(bytes)};
    } finally { await page.evaluate(() => {window.showSaveFilePicker = __sceneDataSave.original; delete window.__sceneDataSave;}); }
  });
  let scoped = false, fixture, ownerA, ownerB, external, baseline;
  const onError = e => report.pageErrors.push(e.stack || e.message);
  const onConsole = message => {if (message.type() === 'error') report.consoleErrors.push(message.text());};
  const onRequest = request => {if (/\/plugins\/.*\.m?js(?:\?|$)/.test(request.url())) report.pluginModuleRequests.push(request.url());if(request.url().includes('never-load-scene-control-module')) report.authorModuleRequests.push(request.url());};
  page.on('pageerror',onError); page.on('console',onConsole); page.on('request',onRequest);
  try {
    diagnostics.hardware = await page.evaluate(() => {
      window.__sceneDataExecutionSentinel = 0;
      const device = frameEngine.renderer.device;
      const observed = window.__sceneDataGPU = {device,uncaptured:[],lost:null};
      observed.listener = event => observed.uncaptured.push(event.error.message);
      device.addEventListener('uncapturederror',observed.listener);
      device.lost.then(info => {observed.lost = {reason:info.reason,message:info.message};});
      device.pushErrorScope('validation');
      return device.adapterInfo ? Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k => [k,device.adapterInfo[k]])) : null;
    }); scoped = true;
    check('Identifiable hardware WebGPU without software fallback', diagnostics.hardware && Object.values(diagnostics.hardware).some(v => typeof v === 'string' && v) && !diagnostics.hardware.isFallbackAdapter && !/swiftshader|llvmpipe|lavapipe|software/i.test(canonical(diagnostics.hardware)), diagnostics.hardware);

    await run('Blank native scene is inert and shared API is discoverable', async () => {
      await call('scene.new'); const blank = await get();
      equal('Blank scene has no author records', blank.data.records, []);
      equal('Managed runtime is available but sources require explicit descriptors', blank.runtime, 'managed');
      check('Control button is always available', await page.locator('#btnControl').count() === 1);
      const tools = await page.evaluate(() => frameAI.listTools());
      for (const name of ['authorData.get','authorData.inspect','authorData.replace','fields.list','fields.read','fields.write']) {
        const tool = tools.find(t => t.name === name); check(name + ' has one shared discoverable input schema', !!tool && tool.inputSchema?.type === 'object' && tools.filter(t => t.name === name).length === 1);
      }
      const encoded = await call('scene.export',{includeData:true});
      equal('Blank native HASH omits optional root authorData', (await page.evaluate(decodeHash,encoded.base64)).root, null);
      equal('Blank scene never evaluates stored source', await page.evaluate(() => __sceneDataExecutionSentinel), 0);
    });

    await run('Independent root/object records preserve exact source, schema and CAS', async () => {
      ownerA = await call('scene.create',{type:'group',name:'Equal label'});
      ownerB = await call('scene.create',{type:'group',name:'Equal label'});
      external = await call('scene.create',{type:'group',name:'External owner'});
      const rootRecords = [
        record(R.source,'Shared dependency','source',{language:'javascript',text:sourceText(ownerA.hash,'root')},[{kind:'record',owner:'scene',id:R.schema}]),
        record(R.schema,'Shared schema','schema',{format:'json-schema',definition:{type:'object',properties:{label:{type:'string',description:'Ω 😀 e\u0301'}},additionalProperties:false}}),
        record(R.unused,'Unrelated source','source',{language:'html',text:'<script>globalThis.__sceneDataExecutionSentinel += 100;</script>\n'}),
        record(R.binding,'Persistent owner binding','binding',{target:0},[{kind:'field',owner:ownerA.hash,field:'name'}])
      ];
      const objectRecords = [
        record(O.source,'Object source','source',{language:'javascript',text:sourceText(ownerB.hash,'object')},[{kind:'record',owner:'scene',id:R.source},{kind:'object',owner:ownerB.hash},{kind:'field',owner:ownerB.hash,field:'name'},{kind:'object',owner:external.hash}]),
        record(O.binding,'Object binding','binding',{target:0},[{kind:'field',owner:ownerB.hash,field:'visible'}]),
        record(O.schema,'Object schema','schema',{format:'json-schema',definition:{type:'boolean',description:'visible'}},[{kind:'record',owner:'scene',id:R.schema}]),
        record(O.opaque,'Retained future data','opaque',{format:'scene-control-future-fixture',version:7,data:{literal:ownerB.hash,nested:['Ω 😀',17,true,null]}},[{kind:'field',owner:ownerB.hash,field:'position'},{kind:'record',owner:'scene',id:R.unused,unresolved:true},{kind:'record',owner:'scene',id:missingRoot}])
      ];
      const rootBefore = await get();
      await replace('scene',rootRecords); await replace(ownerA.hash,objectRecords);
      await replace(ownerB.hash,[record(O.source,'Independent source','source',{language:'text',text:'Independent B Ω\n'},[{kind:'record',owner:'scene',id:R.source}])]);
      equal('Scene and object may use the same owner-scoped record ID', (await get()).data.records[0].id,(await get(ownerA.hash)).data.records[0].id);
      equal('Source text and Unicode survive creation exactly', (await get(ownerA.hash)).data.records[0].payload.text,sourceText(ownerB.hash,'object'));
      equal('Schema is declarative exact data', (await get()).data.records[1].payload,rootRecords[1].payload);
      equal('Independent B source is not aliased to A or root', (await get(ownerB.hash)).data.records[0].payload.text,'Independent B Ω\n');
      await reject('Old envelope CAS','authorData.replace',{owner:'scene',expected:expected(rootBefore),records:rootRecords},/changed|stale|revision|epoch/i);
      const current = await get(ownerA.hash), revised = clone(current.data.records); revised[0].payload.text += '// edit Ω\n'; revised[0].revision++;
      const contenders = await timed('Two queued source CAS writers',3000,() => page.evaluate(async args => Promise.all(args.map(a => frameAI.call('authorData.replace',a).then(value => ({ok:true,value}),e => ({ok:false,message:e.message,code:e.code})))),[
        {owner:ownerA.hash,expected:expected(current),records:revised},
        {owner:ownerA.hash,expected:expected(current),records:revised}
      ]));
      equal('Exactly one same-version writer wins',contenders.map(r => r.ok),[true,false]);
      check('CAS loser reports the actual version conflict',/changed|stale|revision|epoch/i.test(contenders[1].message),contenders[1]);
      equal('Winning source is retained exactly',(await get(ownerA.hash)).data.records,revised);
      await call('edit.history',{action:'undo'});
      equal('Source edit Undo restores exact records',(await get(ownerA.hash)).data.records,objectRecords);
      check('Undo creates a fresh runtime epoch',(await get(ownerA.hash)).epoch !== current.epoch);
      await reject('Pre-Undo CAS cannot write restored identical authoring','authorData.replace',{owner:ownerA.hash,expected:expected(current),records:revised},/changed|stale|revision|epoch/i);
      await reject('Malformed source payload','authorData.replace',{owner:ownerA.hash,expected:expected(await get(ownerA.hash)),records:[{...objectRecords[0],payload:{language:'javascript',text:12}}]},/text|string|source/i);
      await reject('Name-based binding owner is not canonical','authorData.replace',{owner:ownerA.hash,expected:expected(await get(ownerA.hash)),records:[record(id('5'),'Invalid field','binding',{target:0},[{kind:'field',owner:'Equal label',field:'name'}])]},/reference owner|owner/i);
      await reject('Duplicate record ID cannot partially replace envelope','authorData.replace',{owner:ownerA.hash,expected:expected(await get(ownerA.hash)),records:[objectRecords[0],objectRecords[0]]},/Duplicate author record ID/i);
      await reject('Binding must select an actual typed field target','authorData.replace',{owner:ownerA.hash,expected:expected(await get(ownerA.hash)),records:[record(id('5'),'Invalid binding','binding',{target:9},[{kind:'object',owner:ownerB.hash}])]},/typed field target/i);
      const unavailable = (await inspect(ownerA.hash)).references.find(r => r.record === O.opaque);
      equal('Unsupported future field remains explicitly unsupported',unavailable.status,'unsupported-field');
      equal('Declared opaque payload remains exact and inactive',(await get(ownerA.hash)).data.records.find(r => r.id === O.opaque).payload,objectRecords.find(r => r.id === O.opaque).payload);
      check('Stored scripts and HTML do not alter Control availability',await page.locator('#btnControl').count() === 1);
    });

    await run('DATA-ONLY read instrumentation',async () => {
      diagnostics.readObservation = await timed('Bounded source/schema/binding/field reads',3000,() => page.evaluate(async owner => {
        const observation = {pluginsBefore:framePlugins.list(),pluginsAfter:null,loadUsedCalls:0,flushCalls:0,gpuReadMaps:0,spies:[],limitations:[]};
        const restores = [];
        const wrap = (object,key,hit) => {
          try {
            const original = object?.[key]; if (typeof original !== 'function') throw Error('method not exposed');
            const replacement = function(...args){hit(args);return Reflect.apply(original,this,args);};
            object[key] = replacement; if(object[key] !== replacement) throw Error('method not replaceable');
            restores.push(() => {object[key] = original;}); observation.spies.push(key);
          } catch(error) {observation.limitations.push(key+': '+error.message);}
        };
        wrap(FramePlugins,'loadUsed',() => observation.loadUsedCalls++);
        wrap(FramePlugins,'flush',() => observation.flushCalls++);
        wrap(globalThis.GPUBuffer?.prototype,'mapAsync',args => {if(args[0] & GPUMapMode.READ) observation.gpuReadMaps++;});
        try {
          await frameAI.call('authorData.get',{owner:'scene'});
          await frameAI.call('authorData.inspect',{owner});
          await frameAI.call('fields.list',{owner});
          await frameAI.call('fields.read',{owner,field:'name'});
          observation.pluginsAfter = framePlugins.list();
          observation.sentinel = __sceneDataExecutionSentinel;
        } finally {for(const restore of restores.reverse()) restore();observation.spiesRestored = true;}
        return observation;
      },ownerA.hash));
      const observed = diagnostics.readObservation;
      equal('Data-only reads preserve loaded plugin inventory',observed.pluginsAfter,observed.pluginsBefore);
      equal('No stored source execution during reads',observed.sentinel,0);
      if(observed.spies.includes('loadUsed')) equal('Observed data-only reads do not enter plugin activation settlement',observed.loadUsedCalls,0);
      if(observed.spies.includes('flush')) equal('Observed data-only reads do not enter plugin flush',observed.flushCalls,0);
      if(observed.spies.includes('mapAsync')) equal('Observed data-only reads perform no GPU read mapping',observed.gpuReadMaps,0);
      // Missing/unreplaceable spies are reported as limits, never claimed proof.
      check('All installed observational wrappers restored',observed.spiesRestored === true);
    });

    await run('Shared fields use canonical identity, native API/UI revisions and atomic validation',async () => {
      const discovered = await call('fields.list',{owner:ownerA.hash});
      const fields = {fields:discovered.fields.filter(f => !f.field.startsWith('param:'))};
      check('Discovered parameters are read-only current observations',discovered.fields.filter(f => f.field.startsWith('param:')).every(f => f.access === 'read-only' && f.phase === 'current' && f.revision === null));
      equal('Initial shared coverage is exactly name and visible',fields.fields.map(f => f.field).sort(),['name','visible']);
      equal('Name is a string field',fields.fields.find(f => f.field === 'name').type,'string');
      equal('Visibility is a boolean field',fields.fields.find(f => f.field === 'visible').type,'boolean');
      check('Every discovered field has authoring metadata and current version',fields.fields.every(f => f.owner === ownerA.hash && f.phase === 'authoring' && f.access === 'read-write' && f.availability === 'available' && typeof f.epoch === 'string' && Number.isSafeInteger(f.revision)));
      await call('scene.select',{ids:[ownerB.hash]}); const selectionBefore = (await state()).selection;
      const a = await read(ownerA.hash,'name'), b = await read(ownerB.hash,'visible');
      const written = await call('fields.write',{writes:[{owner:ownerA.hash,field:'name',value:'Shared API name',epoch:a.epoch,revision:a.revision},{owner:ownerB.hash,field:'visible',value:false,epoch:b.epoch,revision:b.revision}]});
      equal('One native field batch returns both committed values',written.map(f => f.value),['Shared API name',false]);
      equal('Explicit field edit never changes current selection',(await state()).selection,selectionBefore);
      equal('Same-name B was not renamed',(await read(ownerB.hash,'name')).value,'Equal label');
      equal('Binding still points to exact owner after rename',(await get()).data.records.find(r => r.id === R.binding).refs[0],{kind:'field',owner:ownerA.hash,field:'name'});
      await call('edit.history',{action:'undo'});
      equal('One Undo restores the complete field batch',[(await read(ownerA.hash,'name')).value,(await read(ownerB.hash,'visible')).value],['Equal label',true]);
      const ar = await read(ownerA.hash,'name'), br = await read(ownerB.hash,'visible');
      await reject('Invalid second batch write is atomic','fields.write',{writes:[{owner:ownerA.hash,field:'name',value:'MUST NOT COMMIT',epoch:ar.epoch,revision:ar.revision},{owner:ownerB.hash,field:'visible',value:'false',epoch:br.epoch,revision:br.revision}]},/visible|boolean|type/i);
      await reject('Old field version after Undo is fenced','fields.write',{writes:[{owner:ownerA.hash,field:'name',value:'MUST NOT COMMIT',epoch:a.epoch,revision:a.revision}]},/changed|revision|epoch/i);
      await reject('Unsupported transform is truthful','fields.read',{owner:ownerA.hash,field:'position'},/Unsupported native field/i);
      await reject('Name is not an owner identity','fields.read',{owner:'Equal label',field:'name'},/canonical|owner|hash/i);
      await reject('Missing owner is truthful','fields.read',{owner:missing,field:'visible'},/owner is missing/i);
      await reject('Native scene.update uses shared name validation','scene.update',{id:ownerA.hash,name:'invalid\0name'},/native name|name/i);
      const beforeUpdate = await read(ownerA.hash,'name');
      await call('scene.update',{id:ownerA.hash,name:'Updated through scene.update',visible:false});
      const afterUpdate = await read(ownerA.hash,'name');
      equal('scene.update reaches the same native field',afterUpdate.value,'Updated through scene.update');
      check('scene.update advances the shared revision',afterUpdate.revision > beforeUpdate.revision);
      const object = (await state()).objects.find(o => o.hash === ownerA.hash);
      const beforeInvalidUIHistory = await history(),beforeInvalidUIErrors = report.pageErrors.length;
      await timed('Rejected native inline rename Enter and blur',3000,async () => {
        await page.locator('#row-'+object.id+' .ob-name').dblclick();
        const input = page.getByRole('textbox',{name:'Object name',exact:true});
        await input.fill('x'.repeat(4097));await input.press('Enter');
        check('Invalid rename draft remains visible for correction',await input.isVisible());
        check('Invalid rename reports actual browser-native custom validity',await input.evaluate(element => element.validity.customError && /Invalid native name/.test(element.validationMessage)));
        equal('Invalid rename has the expected native error diagnostic',await page.locator('#frame-engine-canvas').getAttribute('data-operation-error'),'Invalid native name');
        equal('Invalid Enter leaves the native name unchanged',(await read(ownerA.hash,'name')).value,afterUpdate.value);
        equal('Invalid Enter does not alter Undo/Redo',await history(),beforeInvalidUIHistory);
        await page.locator('#tabAttributes').click();
        check('Invalid blur keeps the draft available',await input.isVisible());
        equal('Invalid blur leaves the native name unchanged',(await read(ownerA.hash,'name')).value,afterUpdate.value);
        equal('Invalid blur does not alter Undo/Redo',await history(),beforeInvalidUIHistory);
        equal('Native validation events produce no uncaught page error',report.pageErrors.length,beforeInvalidUIErrors);
      });
      await timed('Native tree inline name edit',3000,async () => {
        await page.getByRole('textbox',{name:'Object name',exact:true}).fill('Native UI Ω');
        await page.getByRole('textbox',{name:'Object name',exact:true}).press('Enter');
        await page.locator('.ob-rename').waitFor({state:'detached'}); await state();
      });
      const afterUI = await read(ownerA.hash,'name');
      equal('Native inline edit reaches the same field',afterUI.value,'Native UI Ω');
      check('Native inline edit advances the same shared revision',afterUI.revision > afterUpdate.revision);
      equal('Correcting a rejected draft creates exactly one Undo entry',(await history()).undo,beforeInvalidUIHistory.undo + 1);
      diagnostics.expectedRenameRejection = await page.locator('#frame-engine-canvas').getAttribute('data-operation-error');
      // Dismiss only this already asserted expected diagnostic, as other native
      // UI regression gates do. Never clear an unrecognized operation failure.
      await page.evaluate(() => {const canvas=document.querySelector('#frame-engine-canvas');if(canvas.dataset.operationError!=='Invalid native name')throw Error('Unexpected rename diagnostic');delete canvas.dataset.operationError;delete canvas.dataset.operationStack;});
      const beforeEscapeHistory = await history();
      await timed('Native inline rename Escape and later blur',3000,async () => {
        await page.locator('#row-'+object.id+' .ob-name').dblclick();
        const input=page.getByRole('textbox',{name:'Object name',exact:true});await input.fill('Cancelled rename draft');await input.press('Escape');
        await page.locator('.ob-rename').waitFor({state:'detached'});await page.locator('#tabAttributes').click();await state();
      });
      equal('Escape preserves committed native name',(await read(ownerA.hash,'name')).value,'Native UI Ω');
      equal('Escape and subsequent blur create no Undo entry',await history(),beforeEscapeHistory);
      const visibility = await read(ownerA.hash,'visible');
      await timed('Native tree visibility edit',3000,async () => {await page.locator('#row-'+object.id+' .ob-show').click();await state();});
      const visibleAfter = await read(ownerA.hash,'visible');
      equal('Native visibility UI reaches the same field',visibleAfter.value,!visibility.value);
      check('Native visibility advances shared revision',visibleAfter.revision > visibility.revision);
      equal('Renaming never rewrites source hash literals',(await get(ownerA.hash)).data.records.find(r => r.id === O.source).payload.text,sourceText(ownerB.hash,'object'));
      await reject('Overlength UI/API field domain uses the same validator','fields.write',{writes:[{owner:ownerA.hash,field:'name',value:'x'.repeat(4097),epoch:visibleAfter.epoch,revision:visibleAfter.revision}]},/native name|long/i);
    });

    await run('Actual native Save/Open preserves all envelopes and fences identical reopen',async () => {
      baseline = {scene:(await get()).data,a:(await get(ownerA.hash)).data,b:(await get(ownerB.hash)).data};
      const oldAuthor = await get(ownerA.hash), oldField = await read(ownerA.hash,'name');
      fixture = await nativeSave(); diagnostics.fixture = {bytes:fixture.bytes,sha256:fixture.sha256};
      const decoded = await page.evaluate(decodeHash,fixture.base64);
      equal('Native HASH root stores exact source/schema/binding/revisions',decoded.root,baseline.scene);
      equal('Native HASH object stores exact source/schema/binding/opaque/revisions',decoded.objects.find(o => o.hash === ownerA.hash).authorData,baseline.a);
      equal('Native HASH independent owner stores separate data',decoded.objects.find(o => o.hash === ownerB.hash).authorData,baseline.b);
      await nativeOpen(fixture);
      equal('Reopening identical HASH preserves root data',(await get()).data,baseline.scene);
      equal('Reopening identical HASH preserves object data',(await get(ownerA.hash)).data,baseline.a);
      equal('Reopening identical HASH preserves independent object data',(await get(ownerB.hash)).data,baseline.b);
      check('Identical reopen changes document epoch',(await get(ownerA.hash)).epoch !== oldAuthor.epoch);
      await reject('Pre-Open author request cannot write identical reopened data','authorData.replace',{owner:ownerA.hash,expected:expected(oldAuthor),records:oldAuthor.data.records},/changed|revision|epoch/i);
      await reject('Pre-Open field request cannot write identical reopened data','fields.write',{writes:[{owner:ownerA.hash,field:'name',value:'STALE',epoch:oldField.epoch,revision:oldField.revision}]},/changed|revision|epoch/i);
      equal('Save/Open never executes stored source',await page.evaluate(() => __sceneDataExecutionSentinel),0);
    });

    const verifyCopy = async (label,result,rootBefore,mode,externalHash = external.hash) => {
      const candidates = await Promise.all(result.objects.map(async object => ({object,data:(await get(object.hash)).data})));
      const copiedA = candidates.find(x => byName(x.data,'Object source'));
      const copiedB = candidates.find(x => byName(x.data,'Independent source'));
      check(label+' copies both native owners',!!copiedA && !!copiedB && candidates.length === 2,candidates.map(x => x.object.hash));
      check(label+' has fresh owner namespaces',copiedA.object.hash !== ownerA.hash && copiedB.object.hash !== ownerB.hash && copiedA.object.hash !== copiedB.object.hash);
      const rootAfter = (await get()).data, priorIDs = new Set(rootBefore.records.map(r => r.id));
      const imported = rootAfter.records.filter(r => !priorIDs.has(r.id));
      const dependency = mode === 'share' ? rootAfter.records.find(r => r.id === R.source) : imported.find(r => r.name === 'Shared dependency');
      const schema = mode === 'share' ? rootAfter.records.find(r => r.id === R.schema) : imported.find(r => r.name === 'Shared schema');
      equal(label+' imports only the declared root dependency closure',imported.length,mode === 'share' ? 0 : 2);
      check(label+' resolves transitive root dependencies',!!dependency && !!schema && dependency.refs[0].id === schema.id);
      if(mode === 'import') {
        check(label+' creates fresh root resource IDs',dependency.id !== R.source && schema.id !== R.schema);
        equal(label+' imports Copy-time source exactly',dependency.payload.text,baseline.scene.records.find(r => r.id === R.source).payload.text);
      }
      const aSource = byName(copiedA.data,'Object source'), bSource = byName(copiedB.data,'Independent source');
      equal(label+' preserves owner-scoped record IDs',aSource.id,O.source);
      equal(label+' preserves exact source including old hash literal',aSource.payload.text,sourceText(ownerB.hash,'object'));
      equal(label+' maps the typed object and field references only',aSource.refs,[{kind:'record',owner:'scene',id:dependency.id},{kind:'object',owner:copiedB.object.hash},{kind:'field',owner:copiedB.object.hash,field:'name'},{kind:'object',owner:externalHash}]);
      equal(label+' keeps shared module identity shared across both copied owners',bSource.refs[0].id,dependency.id);
      equal(label+' remaps binding exact target',byName(copiedA.data,'Object binding').refs[0],{kind:'field',owner:copiedB.object.hash,field:'visible'});
      equal(label+' opaque text/hash remains unchanged',byName(copiedA.data,'Retained future data').payload,baseline.a.records.find(r => r.id === O.opaque).payload);
      const unresolved = byName(copiedA.data,'Retained future data').refs[1];
      check(label+' cannot resolve an explicitly unresolved coincident root ID',unresolved.unresolved === true && (await inspect(copiedA.object.hash)).references.find(r => r.record === O.opaque && r.index === 1).status === 'unresolved-reference');
      if(mode === 'import') {
        const formerlyMissing = byName(copiedA.data,'Retained future data').refs[2];
        check(label+' fences a formerly missing root ID from destination coincidence',formerlyMissing.id === missingRoot && formerlyMissing.unresolved === true && (await inspect(copiedA.object.hash)).references.find(r => r.record === O.opaque && r.index === 2).status === 'unresolved-reference');
      }
      return {a:copiedA.object.hash,b:copiedB.object.hash,root:rootAfter,dependency,schema};
    };

    await run('Native Duplicate shares roots; local Copy/Paste imports captured dependencies',async () => {
      const originalRoot = (await get()).data, originalA = (await get(ownerA.hash)).data, originalB = (await get(ownerB.hash)).data;
      const duplicated = await call('scene.duplicate',{ids:[ownerA.hash,ownerB.hash]});
      const copy = await verifyCopy('Duplicate',duplicated,originalRoot,'share');
      equal('Duplicate leaves root resources unchanged',(await get()).data,originalRoot);
      equal('Duplicate leaves source A unchanged',(await get(ownerA.hash)).data,originalA);
      equal('Duplicate leaves source B unchanged',(await get(ownerB.hash)).data,originalB);
      await call('edit.history',{action:'undo'});
      check('Duplicate Undo removes only new owners',!(await state()).objects.some(o => o.hash === copy.a || o.hash === copy.b));
      await call('edit.history',{action:'redo'});
      check('Duplicate Redo restores the same copied owner identity',(await state()).objects.some(o => o.hash === copy.a));
      await call('edit.history',{action:'undo'});
      await call('scene.select',{ids:[ownerA.hash,ownerB.hash]}); await call('edit.copy');
      const rootState = await get(), edited = clone(rootState.data.records); edited.find(r => r.id === R.source).payload.text += '// changed after Copy\n'; edited.find(r => r.id === R.source).revision++;
      await replace('scene',edited);
      const beforePaste = (await get()).data, local = await call('edit.paste');
      const pasted = await verifyCopy('Same-document Paste',local,beforePaste,'import');
      check('Same-document Paste uses Copy-time text rather than later live edits',pasted.dependency.payload.text !== edited.find(r => r.id === R.source).payload.text);
      equal('Same-document Paste imports only two shared root dependencies',(await get()).data.records.length,baseline.scene.records.length + 2);
    });

    await run('Copy-time dependency closure survives same-window New/Open/Paste',async () => {
      // Clipboard still owns its snapshot from before the root edit above.
      const preNew = await get(); await call('scene.new');
      check('New starts a new document epoch',(await get()).epoch !== preNew.epoch);
      equal('New clears author data',(await get()).data.records,[]);
      await reject('Pre-New request cannot mutate empty scene','authorData.replace',{owner:'scene',expected:expected(preNew),records:preNew.data.records},/changed|revision|epoch/i);
      const collision = record(R.unused,'Destination coincident resource','source',{language:'text',text:'Unrelated destination resource, never imported through unresolved refs'});
      const missingCollision = record(missingRoot,'Destination formerly-missing coincidence','source',{language:'text',text:'Different destination record with a formerly missing source ID'});
      await replace('scene',[collision,missingCollision]); const destinationRoot = (await get()).data;
      const pasted = await call('edit.paste'); const imported = await verifyCopy('Copy → New → Paste',pasted,destinationRoot,'import');
      equal('Unresolved coincident destination resource stays untouched',(await get()).data.records.find(r => r.id === R.unused),collision);
      equal('Formerly missing coincident destination resource stays untouched',(await get()).data.records.find(r => r.id === missingRoot),missingCollision);
      check('External owner absent after New stays unavailable',(await inspect(imported.a)).references.some(r => r.ref.kind === 'object' && r.ref.owner === external.hash && r.status === 'missing-owner'));
      equal('Unrelated source root resource was not imported',imported.root.records.filter(r => r.name === 'Unrelated source').length,0);
      await nativeOpen(fixture); const beforeOpenPaste = (await get()).data;
      const afterOpenPaste = await call('edit.paste');
      await verifyCopy('Copy → Open identical HASH → Paste',afterOpenPaste,beforeOpenPaste,'import');
      equal('Open/Paste retains original root source unchanged',(await get()).data.records.find(r => r.id === R.source),baseline.scene.records.find(r => r.id === R.source));
    });

    await run('Merge the same actual HASH twice creates distinct record namespaces',async () => {
      await call('scene.new');
      await page.context().route('**/scene-control-data-merge.hash',route => route.fulfill({contentType:'application/x-frame-hash',body:Buffer.from(fixture.base64,'base64')}));
      try {
        const namespaces = [];
        for(let iteration = 0;iteration < 2;iteration++) {
          const before = (await get()).data, beforeIDs = new Set(before.records.map(r => r.id));
          const result = await call('scene.merge',{url:'scene-control-data-merge.hash'});
          equal('Merge '+iteration+' imports all native roots',result.objects.length,3);
          const all = await Promise.all(result.objects.map(async object => ({object,data:(await get(object.hash)).data})));
          const a = all.find(x => byName(x.data,'Object source')), b = all.find(x => byName(x.data,'Independent source')), e = all.find(x => x.object.name === 'External owner');
          check('Merge '+iteration+' keeps independent native owners',!!a && !!b && !!e);
          const records = (await get()).data.records.filter(r => !beforeIDs.has(r.id));
          equal('Merge '+iteration+' imports every incoming root record exactly once',records.length,baseline.scene.records.length);
          const dependency = records.find(r => r.name === 'Shared dependency'), schema = records.find(r => r.name === 'Shared schema'), binding = records.find(r => r.name === 'Persistent owner binding');
          check('Merge '+iteration+' remaps root record dependency',dependency.refs[0].id === schema.id);
          equal('Merge '+iteration+' remaps root binding to its imported owner',binding.refs[0],{kind:'field',owner:a.object.hash,field:'name'});
          equal('Merge '+iteration+' remaps object targets while preserving source literal',byName(a.data,'Object source').refs,[{kind:'record',owner:'scene',id:dependency.id},{kind:'object',owner:b.object.hash},{kind:'field',owner:b.object.hash,field:'name'},{kind:'object',owner:e.object.hash}]);
          equal('Merge '+iteration+' exact object source remains untouched',byName(a.data,'Object source').payload.text,sourceText(ownerB.hash,'object'));
          equal('Merge '+iteration+' exact root source remains untouched',dependency.payload.text,baseline.scene.records.find(r => r.id === R.source).payload.text);
          namespaces.push({owners:all.map(x => x.object.hash),records:records.map(r => r.id)});
        }
        check('Repeated Merge creates disjoint object namespaces',namespaces[1].owners.every(h => !namespaces[0].owners.includes(h)));
        check('Repeated Merge creates disjoint root record namespaces',namespaces[1].records.every(h => !namespaces[0].records.includes(h)));
      } finally {await page.context().unroute('**/scene-control-data-merge.hash');report.cleanup.mergeRouteRemoved = true;}
    });

    await run('Owner and record deletion retain bindings; native Undo restores exact identity',async () => {
      await nativeOpen(fixture); const beforeDelete = await get(), fieldBefore = await read(ownerA.hash,'name');
      const shadow = await call('scene.create',{type:'group',name:fieldBefore.value});
      await call('scene.delete',{ids:[ownerA.hash]});
      equal('Owner deletion retains scene binding and all root records',(await get()).data,beforeDelete.data);
      equal('Deleted owner binding reports unavailable without name fallback',(await inspect()).references.find(r => r.record === R.binding).status,'missing-owner');
      equal('Same-name shadow remains independent',(await read(shadow.hash,'name')).value,fieldBefore.value);
      await reject('Deleted owner cannot be read as another same-name owner','fields.read',{owner:ownerA.hash,field:'name'},/owner is missing/i);
      await call('edit.history',{action:'undo'});
      equal('Owner Delete Undo restores exact native hash',(await read(ownerA.hash,'name')).owner,ownerA.hash);
      equal('Owner Delete Undo restores binding resolution',(await inspect()).references.find(r => r.record === R.binding).status,'available');
      restored('Owner Delete Undo',(await get(ownerA.hash)).data,baseline.a);
      await reject('Old pre-delete field request is fenced after Undo','fields.write',{writes:[{owner:ownerA.hash,field:'name',value:'STALE',epoch:fieldBefore.epoch,revision:fieldBefore.revision}]},/changed|revision|epoch/i);
      const beforeRecordDelete = await get(), objectBefore = (await get(ownerA.hash)).data;
      await replace('scene',beforeRecordDelete.data.records.filter(r => r.id !== R.source));
      equal('Record deletion leaves dependent object record untouched',(await get(ownerA.hash)).data,objectBefore);
      equal('Deleted root resource reports missing-record',(await inspect(ownerA.hash)).references.find(r => r.record === O.source && r.index === 0).status,'missing-record');
      await call('edit.history',{action:'undo'});
      restored('Record Delete Undo',(await get()).data,beforeRecordDelete.data,[R.source]);
      equal('Record Delete Undo restores dependent reference',(await inspect(ownerA.hash)).references.find(r => r.record === O.source && r.index === 0).status,'available');
      check('Record Delete Undo rotates runtime epoch',(await get()).epoch !== beforeRecordDelete.epoch);
      await reject('Pre-record-delete request is stale after identical Undo','authorData.replace',{owner:'scene',expected:expected(beforeRecordDelete),records:beforeRecordDelete.data.records},/changed|revision|epoch/i);
      equal('Native lifecycle never executed authored code',await page.evaluate(() => __sceneDataExecutionSentinel),0);
      equal('No author-program import request was made',report.authorModuleRequests,[]);
      check('Control remains available without source execution',await page.locator('#btnControl').count() === 1);
    });

    await run('Undo creation reserves root/object IDs across branch edits and native HASH',async () => {
      await nativeOpen(fixture);
      for(const [label,targetOwner,temporaryID,dependencyID] of [
        ['Scene root','scene',id('a'),id('c')],
        ['Object owner',ownerA.hash,id('b'),id('d')]
      ]) {
        const observer = await get(ownerB.hash);
        const dependency = record(dependencyID,label+' reservation observer','opaque',{format:'reservation-fixture',version:1,data:{text:'Retain this dependency when its source disappears'}},[{kind:'record',owner:targetOwner,id:temporaryID}]);
        await replace(ownerB.hash,[...observer.data.records,dependency]);
        equal(label+' observer is initially unavailable',(await inspect(ownerB.hash)).references.find(r => r.record === dependencyID).status,'missing-record');
        const beforeCreation = await get(targetOwner);
        const temporary = record(temporaryID,label+' original identity','source',{language:'text',text:'Original identity Ω 😀\n'});
        await replace(targetOwner,[...beforeCreation.data.records,temporary]);
        const created = await get(targetOwner);
        equal(label+' observer resolves the actual newly created record',(await inspect(ownerB.hash)).references.find(r => r.record === dependencyID).status,'available');
        await call('edit.history',{action:'undo'});
        const undone = await get(targetOwner);
        restored(label+' creation Undo',undone.data,beforeCreation.data,[temporaryID]);
        check(label+' creation Undo changes document epoch',undone.epoch !== created.epoch);
        equal(label+' observer remains retained and unavailable',(await inspect(ownerB.hash)).references.find(r => r.record === dependencyID).status,'missing-record');
        const impostor = {...temporary,name:'Unrelated attempted reuse',payload:{language:'text',text:'Must never capture the retained dependency'}};
        await reject(label+' branch cannot reuse retired identity','authorData.replace',{owner:targetOwner,expected:expected(undone),records:[...undone.data.records,impostor]},/retired|reserved|fresh ID|reus/i);
        await call('edit.history',{action:'redo'});
        const redone = await get(targetOwner);
        restored(label+' creation Redo',redone.data,created.data,[temporaryID]);
        equal(label+' Redo restores exact original record',redone.data.records.find(r => r.id === temporaryID),temporary);
        equal(label+' Redo restores retained dependency resolution',(await inspect(ownerB.hash)).references.find(r => r.record === dependencyID).status,'available');
        await call('edit.history',{action:'undo'});
        const saveState = await get(targetOwner), saved = await nativeSave(), decoded = await page.evaluate(decodeHash,saved.base64);
        equal(label+' post-Undo HASH persists exact live records and reservations',targetOwner === 'scene' ? decoded.root : decoded.objects.find(o => o.hash === targetOwner).authorData,saveState.data);
        await nativeOpen(saved);
        const reopened = await get(targetOwner);
        equal(label+' Open preserves the saved reservation envelope exactly',reopened.data,saveState.data);
        check(label+' Open gives saved reservations a fresh runtime epoch',reopened.epoch !== saveState.epoch);
        await reject(label+' saved retired identity cannot be reused after Open','authorData.replace',{owner:targetOwner,expected:expected(reopened),records:[...reopened.data.records,impostor]},/retired|reserved|fresh ID|reus/i);
        equal(label+' saved unresolved dependency remains unavailable',(await inspect(ownerB.hash)).references.find(r => r.record === dependencyID).status,'missing-record');
      }
      const prior = await get();await call('scene.new');
      check('New is a distinct document lifetime',(await get()).epoch !== prior.epoch);
      equal('New does not carry an old document reservation ledger',(await get()).data.retired || [],[]);
      const fresh = record(id('a'),'New document identity','source',{language:'text',text:'A new document can independently allocate this scene-local ID'});
      await replace('scene',[fresh]);
      equal('Fresh document allocates its independent owner-scoped identity',(await get()).data.records,[fresh]);
    });
    diagnostics.nativeBoundaries = await sceneControlNativeBoundaries(page,{run,check,equal,timed,nativeSave,nativeOpen});
    report.status = 'completed';
    report.qualification = 'Focused DATA-ONLY browser cases only. Docs source/API suites remain separately authoritative. No Atomic, transforms, execution runtime, PWA, stress, live deployment or universal field claim.';
  } catch(error) {
    report.error = {message:error.message,stack:error.stack}; report.status = 'failed';
  } finally {
    if(scoped) {
      try {
        diagnostics.gpu = await page.evaluate(async () => {
          const observed = __sceneDataGPU; await observed.device.queue.onSubmittedWorkDone();
          const validation = (await observed.device.popErrorScope())?.message || null;
          observed.device.removeEventListener('uncapturederror',observed.listener);
          return {validation,uncaptured:observed.uncaptured,lost:observed.lost,changed:observed.device !== frameEngine.renderer.device};
        });
        report.cleanup.gpuScopePopped = true;
      } catch(error) {report.cleanup.gpuFinalizationError = error.message;report.pass = false;}
    }
    try {
      diagnostics.sourceExecutionSentinel = await page.evaluate(() => window.__sceneDataExecutionSentinel);
      checks.push({name:'Stored source execution sentinel remains zero at teardown',pass:diagnostics.sourceExecutionSentinel === 0,detail:diagnostics.sourceExecutionSentinel});report.browserAssertions++;
    } catch(error) {report.cleanup.sentinelReadError = error.message;}
    if(scoped && diagnostics.gpu) {
      const gpuClean = !diagnostics.gpu.validation && !diagnostics.gpu.uncaptured.length && !diagnostics.gpu.lost && !diagnostics.gpu.changed;
      checks.push({name:'No GPU validation/uncaptured error, device loss or replacement',pass:gpuClean,detail:diagnostics.gpu});report.browserAssertions++;
    }
    checks.push({name:'No uncaught page errors',pass:report.pageErrors.length === 0,detail:report.pageErrors});report.browserAssertions++;
    checks.push({name:'No browser console errors',pass:report.consoleErrors.length === 0,detail:report.consoleErrors});report.browserAssertions++;
    report.sourceAfter = await indexHash();
    report.sourceUnchanged = report.sourceAfter === report.sourceBefore;
    if(!report.sourceUnchanged) {report.pass = false;report.status = 'failed';report.sourceError = 'Runtime source changed while this gate was running';}
    page.off('pageerror',onError);page.off('console',onConsole);page.off('request',onRequest);report.cleanup.pageObserversRemoved = true;
    report.finishedAt = new Date().toISOString();
    report.pass = report.status === 'completed' && report.sourceUnchanged && !report.cleanup.gpuFinalizationError && cases.every(c => c.pass) && checks.every(c => c.pass);
    if(!report.pass && report.status === 'completed') report.status = 'failed';
  }
  return report;
}

export async function sceneDataStartupDiagnostics(page) {
  if(!page)return null;
  try {return await page.evaluate(() => {const canvas=document.querySelector('#frame-engine-canvas');return {url:location.href,canvasPresent:!!canvas,dataset:canvas?{...canvas.dataset}:null};});}
  catch(error){return {readError:{name:error.name,message:error.message,stack:error.stack}};}
}
export function sceneDataStartupStatus({session,diagnostics,startupErrors}) {
  if(startupErrors.length)return 'failed';
  const dataset=diagnostics?.dataset;
  if(dataset?.ready==='error')return ['WebGPU is unavailable in this browser.','No WebGPU adapter found.'].includes(dataset.operationError)?'blocked':'failed';
  return session?'failed':'blocked';
}

if(process.argv[1] === fileURLToPath(import.meta.url)) {
  await mkdir(evidence,{recursive:true});
  let session, context, result, page;
  const startupErrors = [], observeStartup = error => startupErrors.push(error.stack || error.message);
  const before = await indexHash(), started = performance.now();
  try {
    // Dynamic import preserves a missing Playwright dependency as a failed gate
    // artifact. It is never converted to a pass, skip or alternate launcher.
    const {launch,ready} = await import('../tools/browser.mjs');
    session = await launch({headless:!process.argv.includes('--visible')});
    await session.context.close();
    context = await session.browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
    page = await context.newPage();
    page.on('pageerror',observeStartup);
    await page.goto(session.url + '/index.html'); await ready(page);
    page.off('pageerror',observeStartup);
    result = await sceneControlDataBrowserChecks(page,{ready});
    result.startupPageErrors = startupErrors;
    if(startupErrors.length){result.pass = false;result.status = 'failed';}
  } catch(error) {
    const startupDiagnostics=await sceneDataStartupDiagnostics(page);
    result = {pass:false,status:sceneDataStartupStatus({session,diagnostics:startupDiagnostics,startupErrors}),stage:session?'browser-startup':'browser-helper-import-or-launch',startupDiagnostics,startupPageErrors:[...startupErrors],sourceBefore:before,sourceAfter:await indexHash(),browserAssertions:0,checks:[],cases:[],timings:[],error:{name:error.name,code:error.code,message:error.message,stack:error.stack},cleanup:{}};
  } finally {
    const cleanup = result.cleanup ||= {};
    page?.off('pageerror',observeStartup);
    try {if(context){await context.close();cleanup.testContextClosed = true;cleanup.testContextPagesAfterClose = context.pages().length;}} catch(error) {cleanup.contextError = error.message;result.pass = false;}
    try {if(session){await session.close();cleanup.ownedBrowserAndServerClosed = true;cleanup.browserDisconnected = !session.browser.isConnected();}} catch(error) {cleanup.sessionError = error.message;result.pass = false;}
    cleanup.noSessionStarted = !session;
    result.elapsedMs = performance.now() - started;
    result.sourceAfterCleanup = await indexHash();
    if(result.sourceAfterCleanup !== before) {result.pass = false;result.status = 'failed';result.sourceError = 'Runtime source changed during the complete gate';}
    await writeFile(resolve(evidence,'browser-result.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));process.exitCode = result.pass ? 0 : 1;
  }
}
