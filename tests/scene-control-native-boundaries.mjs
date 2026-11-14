// Additional native-only gates. Import into scene-control-data-browser.mjs.
// No launcher, mock scene, plugin module, or standalone execution is provided.
// Call only in the harness's isolated owned context, after its existing cases.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const files = ['index.html', 'core/documentation-window.mjs',
  'documentation.html', 'frame-sw.js', 'tests/scene-control-data-browser.mjs',
  'tests/scene-control-native-boundaries.mjs'];
const sources = async () => Object.fromEntries(await Promise.all(files.map(async name =>
  [name, createHash('sha256').update(await readFile(new URL('../' + name, import.meta.url))).digest('hex')])));
const expected = state => ({epoch:state.epoch, revision:state.data.revision});
const sourceRecord = (id, text) => ({id, revision:0, name:'Native boundary record',
  kind:'source', refs:[], payload:{language:'text', text}});

// The supplied helpers MUST be the native Save/Open and reporting helpers from
// scene-control-data-browser.mjs, not fixture substitutes. They retain the OS
// picker boundary stub while executing the real native streaming HASH codec.
export async function sceneControlNativeBoundaries(page, {run, check, equal, timed, nativeSave, nativeOpen}) {
  for (const helper of [run, check, equal, timed, nativeSave, nativeOpen]) assert.equal(typeof helper, 'function');
  const report = {pass:false, sourceBefore:await sources(), completed:[],
    excluded:['OS clipboard permissions (native cross-tab clipboard does not require them)', 'PWA']};
  const call = (name, args = {}) => timed('Boundary ' + name, 6000,
    () => page.evaluate(([name,args]) => frameAI.call(name,args), [name,args]));
  const get = (owner = 'scene') => call('authorData.get', {owner});
  const replace = async (owner, records) => call('authorData.replace', {owner, expected:expected(await get(owner)), records});
  const history = action => call('edit.history', {action});
  const rejectReuse = async (owner, id) => {
    const before = await get(owner);
    const error = await timed('Reject reserved identity after owner restoration', 3000,
      () => page.evaluate(async args => {
        try {await frameAI.call('authorData.replace', args); return null;}
        catch (e) {return {code:e.code, message:e.message};}
      }, {owner, expected:expected(before), records:[...before.data.records, sourceRecord(id,'Unrelated replacement')]}));
    check('Restored owner rejects fresh-CAS reuse of its prior record identity',
      error?.code === 'CONFLICT' && /retired|reserv|fresh|reus/i.test(error.message), error);
    equal('Rejected reuse leaves the exact envelope and epoch intact', await get(owner), before);
  };
  let editor;
  try {
    await run('Native owner disappearance preserves record allocation reservations', async () => {
      for (const mode of ['create', 'duplicate']) {
        await call('scene.new');
        const id = (mode === 'create' ? 'a' : 'b').repeat(32);
        let owner;
        if (mode === 'create') owner = await call('scene.create', {type:'group', name:'Boundary created owner'});
        else {
          const original = await call('scene.create', {type:'cube', name:'Boundary original cube'});
          const copied = await call('scene.duplicate', {ids:[original.hash]});
          equal('Duplicate returns one actual native owner', copied.objects.length, 1);
          owner = copied.objects[0];
        }
        const originalData = await get(owner.hash);
        await replace(owner.hash, [...originalData.data.records, sourceRecord(id,'Original allocated identity Ω')]);
        await history('undo');
        check(mode + ': record creation Undo reserves its ID', (await get(owner.hash)).data.retired?.includes(id));
        await history('undo');
        check(mode + ': owner creation Undo actually removes the owner',
          !(await call('scene.inspect')).objects.some(o => o.hash === owner.hash));
        await history('redo');
        const restored = await get(owner.hash);
        check(mode + ': owner restoration retains absent-owner reservation', restored.data.retired?.includes(id), restored.data);
        equal(mode + ': restoring owner does not resurrect the undone record', restored.data.records, originalData.data.records);
        await rejectReuse(owner.hash, id);
        const saved = await nativeSave();
        await nativeOpen(saved);
        check(mode + ': native HASH roundtrip retains restored-owner reservation', (await get(owner.hash)).data.retired?.includes(id));
        await rejectReuse(owner.hash, id);
      }
    });
    report.completed.push('Owner create/duplicate → record Undo → owner Undo/Redo → native HASH roundtrip');

    await run('Actual Docs popup seals unsent text for Save and rejects dirty replacement', async () => {
      await call('scene.new');
      const opening = page.waitForEvent('popup', {timeout:6000});
      await page.locator('#btnDocs').click(); editor = await opening;
      const childErrors = [];
      editor.on('pageerror', error => childErrors.push(error.message));
      await editor.locator('textarea').waitFor({state:'visible', timeout:6000});
      await editor.waitForFunction(() => {
        const area = document.querySelector('textarea'); return area && !area.disabled && !area.readOnly;
      }, {}, {timeout:6000});
      // Intentionally leave DOM text unsent. This exercises the real editor's
      // capture-on-seal path, rather than relying on a race with autosave.
      const text = 'Dirty actual Docs boundary Ω 😀\n';
      await editor.locator('textarea').evaluate((area,value) => {area.value = value;}, text);
      equal('Unsent Doc edit has not yet reached native scene metadata', (await call('docs.get')).text, '');
      const saved = await nativeSave();
      const savedDoc = await page.evaluate(async base64 => {
        const file = new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))]);
        const records = await FrameHash.index(file), record = records.get(FrameHash.K.parameters);
        return JSON.parse(await FrameHash.read(file, record)).documentation;
      }, saved.base64);
      equal('Native streaming HASH includes text drained from actual Docs port', savedDoc, text);
      equal('Actual Doc seal publishes the exact unsent text', (await call('docs.get')).text, text);
      await editor.waitForFunction(() => !document.querySelector('textarea').readOnly, {}, {timeout:6000});
      const before = await get(), beforeDocs = await call('docs.get');
      const dirty = text + 'Retained replacement-blocking draft';
      await editor.locator('textarea').evaluate((area,value) => {area.value = value;}, dirty);
      const error = await timed('Native New rejects actual dirty Docs draft', 6000,
        () => page.evaluate(async () => {
          try {await frameAI.call('scene.new'); return null;}
          catch (e) {return {code:e.code, message:e.message};}
        }));
      check('Dirty actual editor blocks replacement with DOCS_PENDING', error?.code === 'DOCS_PENDING', error);
      equal('Cancelled replacement retains authoring epoch and exact data', await get(), before);
      equal('Cancelled replacement retains native Docs version and text', await call('docs.get'), beforeDocs);
      equal('Cancelled replacement leaves unsent draft in actual popup', await editor.locator('textarea').inputValue(), dirty);
      await editor.locator('textarea').fill(dirty);
      await page.waitForFunction(value => frameDocumentation.get().text === value, dirty, {timeout:6000});
      await editor.waitForFunction(() => !sessionStorage.getItem('frame-docs-draft-v1'), {}, {timeout:6000});
      const stale = await get();
      const results = await timed('Actual Doc replacement fences queued author mutation', 6000,
        () => page.evaluate(async state => {
          const next = frameAI.call('scene.new');
          const write = frameAI.call('authorData.replace', {owner:'scene', expected:{epoch:state.epoch, revision:state.data.revision},
            records:[{id:'c'.repeat(32), revision:0, name:'Stale write', kind:'source', refs:[], payload:{language:'text',text:'Must not commit'}}]});
          return Promise.all([next,write].map(p => p.then(() => ({ok:true}), e => ({ok:false,code:e.code,message:e.message}))));
        }, stale));
      check('Clean actual Doc window allows New', results[0].ok, results);
      check('Queued pre-replacement write cannot enter the new scene', !results[1].ok && results[1].code === 'CONFLICT', results);
      equal('Replacement scene contains no stale source record', (await get()).data.records, []);
      equal('Actual Docs popup had no uncaught errors', childErrors, []);
      await editor.close(); editor = null;
    });
    report.completed.push('Actual popup dirty Save/rejected New and post-replacement queued CAS');

    await run('Native committed author edits expose direct and RPC post-settle receipts', async () => {
      await call('scene.new');
      for (const transport of ['direct', 'rpc']) {
        const id = (transport === 'direct' ? 'd' : 'e').repeat(32);
        const before = await get(), record = sourceRecord(id, 'Receipt boundary ' + transport);
        const result = await timed('Committed edit plus one post-settle fault: ' + transport, 6000,
          () => page.evaluate(async ({transport,before,record}) => {
            const original = FramePlugins.flush;
            let injected = 0;
            // Only inject after this exact new record is visible in the real
            // native root. Pre-settlement and all actual commit code are intact.
            FramePlugins.flush = async function(...args) {
              if (!injected && FrameAuthorData.get('scene').data.records.some(r => r.id === record.id)) {
                injected++; throw new Error('SCENE_DATA_EXPECTED_POST_SETTLE_FAULT');
              }
              return original.apply(this,args);
            };
            const undoBefore = undoStack.length;
            try {
              const args = {owner:'scene', expected:{epoch:before.epoch,revision:before.data.revision}, records:[...before.data.records,record]};
              let outcome;
              if (transport === 'rpc') outcome = await frameAI.rpc({jsonrpc:'2.0',id:771,method:'tools/call',params:{name:'authorData.replace',arguments:args}});
              else try {outcome = {unexpectedSuccess:await frameAI.call('authorData.replace',args)};}
              catch (e) {outcome = {code:e.code,completed:e.completed,receipt:e.receipt,message:e.message};}
              return {outcome,injected,undoBefore,undoAfter:undoStack.length};
            } finally {FramePlugins.flush = original;}
          }, {transport,before,record}));
        equal(transport + ': fault is injected exactly once after real mutation', result.injected, 1);
        equal(transport + ': committed edit creates exactly one native Undo entry', result.undoAfter, result.undoBefore + 1);
        const outcome = result.outcome;
        const receipt = transport === 'rpc' ? outcome.result?.structuredContent?.receipt : outcome.receipt;
        check(transport + ': failure reports committed completion', transport === 'rpc'
          ? outcome.result?.isError === true && outcome.result.structuredContent?.completed === true && outcome.result.content.some(c => c.text?.startsWith('AUTHORING_POST_SETTLE_FAILED:'))
          : outcome.code === 'AUTHORING_POST_SETTLE_FAILED' && outcome.completed === true, outcome);
        const current = await get();
        equal(transport + ': receipt matches reread epoch and native committed data', receipt, current);
        equal(transport + ': exact record appears once, without retry', current.data.records.filter(r => r.id === id), [record]);
        equal(transport + ': envelope revision advanced once', current.data.revision, before.data.revision + 1);
      }
    });
    report.completed.push('Real commit + narrowly injected post-settlement failure, direct/RPC receipts');
    await run('Native cross-tab clipboard and failed-install readiness boundaries', async () => {
      await call('scene.new');
      const source = await call('scene.create', {type:'cube', name:'Cross-tab clipboard owner'});
      const dependencyID = '6'.repeat(32), sourceID = '7'.repeat(32), unusedID = '8'.repeat(32);
      const dependency = sourceRecord(dependencyID, 'Captured cross-tab dependency Ω');
      const ownerRecord = {...sourceRecord(sourceID, 'Owner data stays inert'),
        refs:[{kind:'record',owner:'scene',id:dependencyID}]};
      await replace('scene', [dependency, sourceRecord(unusedID, 'Unrelated source record')]);
      await replace(source.hash, [ownerRecord]);
      await call('scene.select', {ids:[source.hash]});
      await call('edit.copy');
      const sourceBefore = {root:await get(), owner:await get(source.hash)};
      const peer = await page.context().newPage(), peerErrors = [], peerConsole = [];
      let gpuScoped = false;
      peer.on('pageerror', error => peerErrors.push(error.message));
      peer.on('console', message => {if (message.type() === 'error') peerConsole.push(message.text());});
      const peerCall = (name,args = {}) => timed('Cross-tab ' + name,6000,
        () => peer.evaluate(([name,args]) => frameAI.call(name,args),[name,args]));
      try {
        await timed('Start second isolated native Frame instance',60000,async () => {
          await peer.goto(page.url());
          await peer.waitForFunction(() => window.frameAI && ['true','error'].includes(document.querySelector('#frame-engine-canvas')?.dataset.ready), {}, {timeout:60000});
          check('Second native instance has a real ready WebGPU scene', await peer.evaluate(() => document.querySelector('#frame-engine-canvas').dataset.ready === 'true'));
        });
        await peer.evaluate(() => {
          const device = frameEngine.renderer.device;
          const state = window.__boundaryGPU = {device,errors:[],lost:null};
          state.listener = e => state.errors.push(e.error.message);
          device.addEventListener('uncapturederror',state.listener);
          device.lost.then(info => state.lost = {reason:info.reason,message:info.message});
          device.pushErrorScope('validation');
          window.__sceneDataExecutionSentinel = 0;
        });
        gpuScoped = true;
        const empty = await peerCall('authorData.get',{owner:'scene'});
        const collision = sourceRecord(dependencyID, 'Destination same ID is unrelated');
        await peerCall('authorData.replace',{owner:'scene',expected:expected(empty),records:[collision]});
        const copied = await peerCall('edit.paste');
        equal('Native BroadcastChannel HASH clipboard imports one owner', copied.objects.length, 1);
        const importedOwner = copied.objects[0].hash;
        check('Cross-tab paste allocates a fresh native owner identity', importedOwner !== source.hash);
        const imported = await peerCall('authorData.get',{owner:importedOwner});
        const root = await peerCall('authorData.get',{owner:'scene'});
        const importedDependency = root.data.records.find(r => r.payload?.text === dependency.payload.text);
        check('Cross-tab import keeps dependency separate from colliding destination ID',
          importedDependency && importedDependency.id !== dependencyID, root.data);
        equal('Cross-tab import preserves unrelated destination record', root.data.records.find(r => r.id === dependencyID),collision);
        equal('Cross-tab import captures only referenced root closure', root.data.records.length,2);
        equal('Cross-tab import does not import unrelated source record',root.data.records.some(r => r.id === unusedID),false);
        equal('Cross-tab imported record retains content and exact typed remapping', imported.data.records,
          [{...ownerRecord,refs:[{kind:'record',owner:'scene',id:importedDependency.id}]}]);
        const inspected = await peerCall('authorData.inspect',{owner:importedOwner});
        equal('Cross-tab imported dependency resolves through native author data',inspected.references[0].status,'available');
        equal('Cross-tab import preserves both source envelopes and epochs',{root:await get(),owner:await get(source.hash)},sourceBefore);
        equal('Cross-tab inert source did not execute',await peer.evaluate(() => __sceneDataExecutionSentinel),0);
        const saved = await peerCall('scene.export',{format:'hash',includeData:true});
        const beforeInvalid = await peerCall('authorData.get',{owner:'scene'});
        const invalid = await peer.evaluate(async () => {
          try {await frameAI.call('scene.open',{name:'invalid-boundary.hash',base64:'AA=='});return {ok:true};}
          catch(e){return {ok:false,code:e.code,message:e.message};}
        });
        check('Malformed native HASH is rejected before replacement',!invalid.ok,invalid);
        equal('Pre-disposal validation failure preserves readable author data and epoch',await peerCall('authorData.get',{owner:'scene'}),beforeInvalid);
        const fault = await timed('Actual installation-listener failure after native disposal',6000,
          () => peer.evaluate(async () => {
            const marker = 'SCENE_DATA_EXPECTED_INSTALL_FAULT', original = FrameMorph.closePose, priorScene = frameEngine.scene;
            let injected = 0, observed = 0;
            const listener = e => {if (e.error?.message === marker || e.message === marker) observed++;};
            window.addEventListener('error',listener);
            FrameMorph.closePose = function(...args) {
              if (!injected && args[0] === false && !FrameAuthorData.ready) {injected++;throw Error(marker);}
              return original.apply(this,args);
            };
            try {
              let outcome;
              try {await frameAI.call('scene.new');outcome={ok:true};}
              catch(e){outcome={ok:false,code:e.code,message:e.message};}
              const rejected = {};
              for (const name of ['authorData.get','fields.list','scene.export']) {
                try {await frameAI.call(name,name === 'authorData.get' ? {owner:'scene'} : name === 'fields.list' ? {owner:'0'.repeat(32)} : {format:'hash'});rejected[name]={ok:true};}
                catch(e){rejected[name]={ok:false,code:e.code,message:e.message};}
              }
              return {injected,observed,outcome,rejected,ready:FrameAuthorData.ready,sceneReplaced:frameEngine.scene !== priorScene};
            } finally {FrameMorph.closePose = original;window.removeEventListener('error',listener);}
          }));
        equal('Listener fault occurs exactly once after document invalidation',fault.injected,1);
        equal('Real browser error event reports the injected listener failure',fault.observed,1);
        check('Native replacement reports incomplete authoring installation',!fault.outcome.ok && /installation failed/i.test(fault.outcome.message),fault);
        check('Failed installation already replaced the actual native scene',fault.sceneReplaced,fault);
        equal('Failed installation leaves author data unavailable',fault.ready,false);
        for(const [name,outcome] of Object.entries(fault.rejected))check(name+' rejects incomplete native document',!outcome.ok && outcome.code==='NOT_READY',outcome);
        await peerCall('scene.new');
        const recovered = await peerCall('authorData.get',{owner:'scene'});
        equal('Explicit New recovers complete authoring readiness',await peer.evaluate(() => FrameAuthorData.ready),true);
        equal('Recovered New is an empty authoring document',recovered.data.records,[]);
        check('Recovered New has a fresh document epoch',recovered.epoch !== beforeInvalid.epoch);
        await peerCall('scene.open',{name:'boundary-recovery.hash',base64:saved.base64});
        equal('Explicit Open restores saved author data after recovery',(await peerCall('authorData.get',{owner:'scene'})).data,beforeInvalid.data);
        report.peerErrors = {expected:peerErrors.filter(e => e.includes('SCENE_DATA_EXPECTED_INSTALL_FAULT')),
          unexpected:peerErrors.filter(e => !e.includes('SCENE_DATA_EXPECTED_INSTALL_FAULT')),console:peerConsole};
        equal('Second native instance has no unexplained page errors',report.peerErrors.unexpected,[]);
        equal('Second native instance has no browser console errors',peerConsole,[]);
      } finally {
        try {
          if(gpuScoped) {
            report.peerGPU = await peer.evaluate(async () => {
              const s = __boundaryGPU;await s.device.queue.onSubmittedWorkDone();
              const validation = (await s.device.popErrorScope())?.message || null;
              s.device.removeEventListener('uncapturederror',s.listener);
              return {validation,uncaptured:s.errors,lost:s.lost,replaced:s.device !== frameEngine.renderer.device};
            });
            check('Second native instance has no GPU error, device loss or replacement',
              !report.peerGPU.validation && !report.peerGPU.uncaptured.length && !report.peerGPU.lost && !report.peerGPU.replaced,report.peerGPU);
          }
        } finally {await peer.close();}
      }
    });
    report.completed.push('Cross-tab native HASH clipboard, failed native installation fencing, explicit New/Open recovery');
    report.pass = true;
  } finally {
    if (editor && !editor.isClosed()) await editor.close();
    report.sourceAfter = await sources();
    equal('Native boundary runtime, Docs modules and test bytes remain frozen', report.sourceAfter, report.sourceBefore);
  }
  return report;
}
