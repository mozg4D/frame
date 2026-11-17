# Frame Node adapter experiment

Run the original Frame HTML scripts in Node with a bounded browser API adapter,
Dawn WebGPU and CPU SwiftShader. This is an experimental recovery path for a
small spline workflow. It does not replace Frame's engine or rewrite its source.

## Requirements

The qualified platform is **Linux x86_64 with Node 24.x and Python 3.11+**.
The measured environment uses Debian 13, glibc 2.41, Node 24.22.1 and Python
3.12.14. `.nvmrc` records the tested Node version; the preflight rejects other
Node major versions. Other operating systems and architectures are unsupported.

System libraries must provide `libvulkan.so.1`, the C/C++ runtime and trusted
HTTPS certificates. For Debian, these normally come from `libvulkan1`, `libc6`,
`libstdc++6`, `libgcc-s1` and `ca-certificates`. Install Node 24 and Python through
your approved system tooling. This adapter neither installs OS packages nor
changes sandbox, certificate, browser or system security settings.

The setup downloads the **pinned Chrome for Testing 151.0.7922.34 Linux archive**
and extracts only `libvk_swiftshader.so` and its Vulkan ICD JSON. It does not
start Chrome. `swiftshader-lock.json` pins the archive and extracted file sizes
and SHA-256 digests. The source is Google's official HTTPS distribution:
https://github.com/GoogleChromeLabs/chrome-for-testing

The archive is about 193 MB. Allow several hundred MB of installation/cache
space, plus about 1 GB RAM for the small qualification scenario. These are
observations for this workflow, not maximum bounds for arbitrary scenes.

## Install and verify

From the repository checkout:

```sh
cd tools/node-adapter
npm ci --cache ./npm-cache --no-audit --no-fund
npm test
python3 run.py
```

`npm ci` uses the committed lockfile and exact direct package versions. Run it
inside this directory; the root application's npm installation is separate.
No browser automation package or global npm modules are required.

The default source is the immutable commit in `verified-source.json`, with a
checked-in SHA-256, Git blob ID, byte length and HTML release stamp. The runner
fetches the authentic HTML, instructions and license under that exact commit.
It validates them before execution and validates cached files on every run.
The HTML executable script bodies and embedded worker/kernel text stay intact.

Successful verification requires **both** phases:

1. Create a 4-control nonplanar spline and Spline Patch through the authentic
   Frame AI API. Build through the actual embedded worker; validate geometry,
   render/read back PNG, and verify that native Patch visibility changes pixels.
   Export native binary HASH, clear the scene and reopen it. Check geometry
   digests, stable object hashes and parent membership.
2. Start a fresh Node process, reopen that HASH through Frame's original decoder,
   rebuild the surface and check the same geometry and ownership identities.
   Repeat PNG/HASH checks without relying on the previous process's memory.

A run writes logs, PNG, HASH and JSON evidence under `.state/runs/<run>/`.
`compatibility.json` reports `passed` only after both phases finish. Failure exits
nonzero and leaves a failed receipt. `latest-compatible.json` is updated only
on success. Generated scenes, dependencies, native libraries, source snapshots
and logs are ignored by Git and must not be committed.

## Check an updated main

```sh
python3 run.py --ref main
```

The runner resolves `main` once to an immutable commit and checks that coherent
snapshot in both phases. It never falls back to another version or silently
promotes a failed candidate. A successful result qualifies only the recorded
source, dependencies, driver and bounded workflow. The checked-in verified pin
is not automatically changed. Update that pin explicitly after reviewing the
new source instructions and evidence. `.agents/` resources, when present, are
included in the candidate snapshot; the runner downloads them, it is not an
agent that interprets skill instructions.

For another exact commit:

```sh
python3 run.py --commit FULL_40_CHARACTER_COMMIT_SHA
```

Unqualified Frame AI API versions and external/module script entry points fail
explicitly rather than silently omitting code. Frame's current AI version is
1.3.0. Source updates can require changes to the environment adapter or tests;
future compatibility is not promised.

## Cached recovery and custom drivers

After an online successful default run:

```sh
python3 run.py --offline
```

Offline mode is restricted to the checked-in verified source and validated
cached driver/source bytes. It cannot resolve a moving `main`. Missing or
corrupt files fail; there is no hidden online fallback. npm dependencies must
already be installed or available in a separately retained npm cache.

An explicitly supplied ICD is supported for diagnostics:

```sh
python3 run.py --icd /absolute/path/to/vk_swiftshader_icd.json
```

The default never falls back to `/usr/lib/chromium` or an old experiment. The
runtime requires a CPU SwiftShader adapter and verifies the loaded library path
through `/proc/self/maps`. External ICD provider/path/digests are recorded; they
are not represented as the qualified pinned distribution.

## Network and failure diagnosis

Online installation needs `registry.npmjs.org` for npm tarballs and
`storage.googleapis.com` for the pinned native archive. Source loading needs
`raw.githubusercontent.com`. Candidate resolution additionally uses
`api.github.com`; unauthenticated GitHub rate limits apply. Node resource fetches
use the same pinned commit and validate Git blob identity.

Python, npm and Node must each trust your configured corporate CA/proxy when
applicable. Node uses its standard environment proxy support. Diagnostics record
whether a proxy/extra CA is configured without logging credentials. A TLS, proxy,
egress or HTTP/rate-limit failure is a setup failure, not evidence of Frame
incompatibility. There are no alternate network routes or TLS-disable options.

Inspect `compatibility.json`, `preflight.log` and each phase's `runtime.log`.
Missing Vulkan/C++ libraries are reported during preflight; native-addon load
errors can also indicate an unsupported glibc or Node ABI. A copied cache alone
does not reconstruct an OS image. Blank-machine/OS provisioning and other Linux
distributions are not qualified by a clean npm installation on the tested host.

## Scope and limits

The adapter supplies jsdom DOM, a fixed synthetic layout at DPR 1, real 2D Canvas,
a texture-backed WebGPU canvas, WebIDL numeric pipeline-constant conversion,
classic Blob workers using `worker_threads`, WebCrypto, Blob/File/streams and
compression. IndexedDB is in memory. DOM scroll requests are counted without
visible scrolling in the offscreen layout. The PNG contains Frame's actual
WebGPU viewport, without SVG interface overlays. Frame source remains the only
scene/evaluator/renderer implementation. The Node VM is an execution realm,
not a security sandbox for untrusted software.

Not qualified: browser interaction/layout or permission flows, filesystem host
grants, PWA/service workers, popups, module workers, ESM plugins, external HTML
image uploads, video/WebCodecs, animation/path tracing, large scenes or every AI
tool. Unsupported operations remain absent or reject. The tiny Patch is an open
surface; its volume statistic does not certify a closed solid. GPU timestamps
here measure software rendering on the CPU and do not imply physical GPU speed.
Browser reopening is a separate check; the existing cloud browser has no WebGPU
adapter and was not used to qualify this Node path. No sharing/publication API
is called by these scripts.
