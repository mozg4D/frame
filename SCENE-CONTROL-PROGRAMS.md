# Scene Control managed execution milestone

This core milestone adds actual JavaScript execution to native Scene author records. It is not the complete Scene Control feature. There is no Control panel/window, custom Attributes UI, field subscription API, timeline/export lifecycle or isolated test-copy runner yet. `programs.describe` reports these limits explicitly. The existing Doc button remains available for empty documentation and F1 still opens Help.

## Persisted opt-in descriptor

Source records are unchanged and inert by themselves: `kind: "source"`, `payload: {language: "javascript", text: "..."}`. Inspect them with `authorData.get` without executing them. Only an opaque record with `payload.format: "frame.scene-control"`, version 1 and valid typed references opts into execution. This record uses the existing native HASH, authoring CAS, Undo and copy/remap paths.

```js
{
  id: "00000000000000000000000000000002", revision: 0,
  name: "Cube control", kind: "opaque",
  refs: [
    {kind: "record", owner: "scene", id: "00000000000000000000000000000001"},
    {kind: "field", owner: "<native object hash>", field: "param:size x"}
  ],
  payload: {format: "frame.scene-control", version: 1, data: {
    source: 0, context: "main", start: "manual", bindings: {size: 1}, params: {}
  }}
}
```

`source` and `imports` aliases index typed source-record references. `bindings` aliases index a typed field reference or a binding record whose target is a typed field. `context` is `main` or `worker:<name>`; omitted context defaults to main, malformed explicit values are unavailable. Worker names contain 1–64 letters, digits, underscores, dots or hyphens. `start` is `manual` by default or explicit `ready`. `params` is an ordinary JSON object. Unknown formats remain inert; unsupported versions and missing sources stay inspectable and unavailable. Missing field targets retain their exact address rather than retargeting by display name or fabricating a value.

A ready descriptor runs when its native document and owner are installed. Source/dependency/descriptor/binding-target changes restart a desired running program, including native Undo/Redo of those edits. Unrelated edits and Undo preserve the activation. An owner's disabled state suspends execution; visibility alone does not. Explicit Stop survives unrelated edits. Copy duplicates owner identity and remaps only typed references, not strings embedded in source code. Save/HASH retains descriptors and sources, not mutable runtime state, timers, jobs or Worker heaps.

Scene files with ready descriptors contain executable, arbitrary JavaScript. Main programs can access DOM and core; external imports follow browser/network policy. This is not a security sandbox. Do not load executable scene code from an untrusted author.

## API and lifecycle

`programs.describe`, `programs.status`, `programs.start`, `programs.stop`, `programs.restart`, `programs.invoke`, `programs.job` and `programs.terminateContext` use the existing discoverable Frame API. The target is `{owner, id}` with a native owner hash or `scene`, and the descriptor record ID. Source text remains available through authorData.

Start/restart/invoke return a queued job receipt immediately. Poll programs.job for completed, error or cancelled state. User activation and methods run outside the Frame API FIFO, so `await ctx.call(...)` does not deadlock that queue. A queued receipt is not success. Stop invalidates later managed API admission and cooperatively releases registered resources; already admitted native operations may finish, and no prior effects are rolled back. Ordinary native scene replacement uses the same FIFO and cannot overtake an admitted operation. Direct main-context access is intentionally not revocable, and synchronous infinite main JavaScript cannot be forcibly interrupted by this runtime.

The native SDK `window.framePrograms.invokeDirect` and `postMessage` separately support structured clone and transfer lists. The structured Frame/MCP API is JSON-only and rejects typed/non-JSON results rather than silently converting them. `window.frameCore` exposes live native engine/nodes/frame/playing getters, resolveOwner, transaction, refresh, authorData, fields, parameters and plugins. This is the actual core, not a second scene model. Authors are responsible for native invariants when using direct access.

Document replacement retires old managed instances and named Workers. A retained pagehide/pageshow transition retires and restores ready programs with a new host identity. Temporary native authoring, Undo and file-I/O readiness fences API calls without unnecessarily recreating unchanged activations. An accepted activation deferred by readiness or queue capacity retries after readiness/capacity returns.

## Source module and execution contract

## Native structured-clone SDK

Expose these separately from the JSON Frame registry, for example through `window.framePrograms`:

```js
await runtime.invokeDirect({owner,id,method:'calculate',args:[input],transfer:[input.buffer]});
await runtime.postMessage({owner,id,data:{samples},transfer:[samples.buffer]});
```

Both return promises of structured-cloned results. Transfers detach supplied buffers synchronously when accepted. MessagePorts and other host-supported transferables use the platform's native semantics. Results can contain typed arrays, ArrayBuffers and BigInts. Native `postMessage` delivers to the activation's `onMessage(data)` hook and returns its result. Return `ctx.transfer(value,[transferable,...])` to transfer reply resources explicitly. JSON jobs reject typed/non-JSON/cyclic/accessor results honestly rather than silently converting them.

## Exact module/activation interface

Sources are ordinary, arbitrary JavaScript ESM, retained unchanged. Absolute external ESM URLs work normally under browser/network/CSP rules. Internal referenced sources are imported with `await ctx.import(alias)`; source text and static import specifiers are never rewritten. A referenced library can export normal functions which accept `ctx` if they need access to the caller's internal aliases.

```js
export async function activate(ctx) {
  const math = await ctx.import('math');
  let count = ctx.params.initial || 0; // Per-activation state.
  ctx.cleanup(() => console.log('Stopping',ctx.id));
  return {
    exports: {
      increment: amount => count += amount,
      calculate: data => math.calculate(data)
    },
    onMessage(data) {
      data.samples[0] += 1;
      return ctx.transfer(data,[data.samples.buffer]);
    },
    dispose() { /* Release activation-owned resources. */ }
  };
}
export const version = () => 1; // Also callable through invoke.
```

`activate(ctx)` is optional. It may return an object, a promise of an object, or nothing. An activation's `exports` functions override same-named callable module exports. `activate` itself is not callable through `invoke`. Module-level state is naturally shared among instances importing the same source revision in one realm. Put independent state in `activate` closures. `dispose` and `onMessage` are activation-object hooks, not inferred module exports. Additional activation object properties can hold user state but are not serialized by the runtime.

Context members:

- `owner,id,name,context`, separately cloned `params` and typed `bindings`, and `signal` (AbortSignal).
- `call(name,args)` / `frame.call(name,args)` and `listTools()` / `frame.listTools()`, using the common managed API.
- `import(alias)` returns the actual native ESM namespace of the referenced source revision.
- `cleanup(fn)` registers an idempotence-aware caller cleanup callback and returns a function that unregisters it. Each registered callback is invoked at most once by normal retirement. Registering after stop runs the callback immediately.
- `resources.listen(target,type,listener,options)`, `.timeout(fn,ms,...args)`, `.interval(fn,ms,...args)`, `.animationFrame(fn)`, `.dom(node)`, and `.objectURL(blob)` register cleanup for the created/listed resources. One-shot timers/rAF remove their registration when fired. Async callback/cleanup errors become diagnostics.
- Main only: the live `core` getter. Main sources may also directly use the normal `window` and `document` globals. Workers have ordinary Worker globals and no DOM/core getter.
- `transfer(value,transferables)` marks a reply for explicit native transfer.

For an actual main DOM button:

```js
export function activate(ctx) {
  const button=ctx.resources.dom(document.createElement('button'));
  button.textContent='Increase cube size';
  document.body.append(button);
  ctx.resources.listen(button,'click',async()=>{
    const {owner,field:fieldKey}=ctx.bindings.size;
    const target={owner,field:fieldKey};
    const field=await ctx.call('fields.read',target);
    await ctx.call('fields.write',{writes:[{...target,value:field.value+1,epoch:field.epoch,revision:field.revision}]});
  });
  return {exports:{click:()=>button.click()}};
}
```

The native field adapter owns units, availability and CAS validation. The runtime does not implement a second field model or automatic subscriptions.

## Lifecycle, limits and honest boundaries

- Invalidation precedes cleanup and rejects late managed commands even before a scheduled reconciliation runs. Temporary not-ready state rejects managed commands with `NOT_READY`, but pure pending initialization/computation may settle without losing an unchanged activation.
- Cleanup invocation and AbortSignal delivery run outside the structured API FIFO. Async cleanup promises are observed for failures but not awaited by stop; the stop receipt does not promise arbitrary async cleanup completion. Pending initialization does not delay stop, and later resource registration cleans up immediately.
- Main JavaScript is not a sandbox and cannot be forcibly killed. Raw DOM/global/core access does not acquire the managed API's generation guards. An infinite main-thread loop blocks the editor. A Worker can be force-terminated, at the cost of every instance sharing it.
- Native ESM module namespaces cannot be unloaded from the main realm. Revoking a Blob URL releases the URL, **not** the imported namespace. The factory intentionally reuses the namespace per exact owner/source-ID/revision/text within a realm. Restarting an activation does not reset module globals. Terminating a Worker creates a fresh realm on its next use.
- Each realm allows at most 512 imported revisions and 16 MiB of retained source bytes. Reaching the cap reports `MODULE_CACHE_LIMIT`; restart the Worker context or reload the page for main modules. Module cache remains across document changes. User-controlled memory and browser-native compiled-module memory are not measured by this source-byte counter.
- At most 512 instances, 32 Worker contexts, 128 registered in-flight requests/user hooks per realm, and 1,024 registered resources per activation. Unsettled main hooks still count after stop: cancellation does not pretend their promises or closures have been reclaimed. User-managed unregistered resources remain the source's responsibility.
- Job history retains at most 128 snapshots, with at most 64 ordinary unfinished jobs. Stop/force-termination remain available under ordinary-job saturation. Old history may expire, including overflowed control receipts. Expiring history is not cancellation of arbitrary JS. JSON results are limited to 64 KiB, 8,192 values and depth 24, with a small separate polling-envelope allowance.
- No Workers, polling loops or resource timers are created by merely inspecting source records or an empty runtime. Only explicit descriptor start/ready-autostart invokes code. Core capabilities and plugins are not eagerly loaded.
- Still deferred: Control window/UI, custom Attributes, field subscriptions, frame/export/simulation barriers, and any promise of completed simulation snapshots.

## CPU verification artifact

Run `npm run test:scene-programs:cpu` from the repository. It extracts the exact factory bytes, imports real native ESM, and runs actual Node Worker threads through a WebWorker-shaped transport adapter. It verifies shared/independent realms, measured CPU overlap of two Workers and main/Worker, typed buffer transfer/detachment, ordinary API FIFO reentrancy/guards, resource cleanup, errors, temporary Undo-readiness, source lifecycle, force termination and bounded history/work.

The DOM test is an EventTarget fixture, not actual browser UI. These tests do **not** qualify browser Blob import/CSP/offline behavior, Frame integration, real DOM button clicks, Atomic native changes, HASH persistence, rendering or WebGPU. Parent integration and browser qualification remain required. No Git writes, publication, browser/GPU checks, Unite or full npm run were performed by this worker.

Ordinary Worker requests are limited to 128 per context. Cooperative stop controls have reserved admission, bounded by the 512 managed-instance limit; temporary pendingRequests can therefore exceed 128 during cleanup.
