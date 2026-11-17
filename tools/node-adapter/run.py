#!/usr/bin/env python3
"""Verify a coherent Frame snapshot and qualify it in two fresh Node processes."""
import argparse
import ctypes
import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

ROOT = Path(__file__).resolve().parent
REPO = 'https://api.github.com/repos/mozg4D/frame'
RAW = 'https://raw.githubusercontent.com/mozg4D/frame'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    os.replace(temp, path)


def read_json(path):
    return json.loads(path.read_text())


def get(url, limit=16 * 1024 * 1024):
    # Standard TLS and configured proxies only. Fail without alternate routes.
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'Frame-Node-adapter'})
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read(limit + 1)
        if len(data) > limit:
            raise RuntimeError('Download exceeds size bound: ' + urllib.parse.urlsplit(url).hostname)
        return data
    except (urllib.error.URLError, TimeoutError) as exc:
        host = urllib.parse.urlsplit(url).hostname
        code = getattr(exc, 'code', None)
        raise RuntimeError(f'HTTPS download failed for {host} (HTTP {code or "n/a"}); check egress, proxy, CA trust or GitHub rate limits') from exc


def verify(data, expected, label):
    if len(data) != expected['bytes'] or digest(data) != expected['sha256']:
        raise RuntimeError('Content SHA256/size mismatch: ' + label)
    if expected.get('gitBlob'):
        blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if blob != expected['gitBlob']:
            raise RuntimeError('Git blob mismatch: ' + label)


def native_driver(state, offline, explicit):
    if explicit:
        icd = Path(explicit).resolve(strict=True)
        provider = 'explicit external ICD; not the pinned distribution'
    else:
        lock = read_json(ROOT / 'swiftshader-lock.json')
        directory = state / 'native' / lock['version']
        directory.mkdir(parents=True, exist_ok=True)
        absent = [name for name in lock['files'] if not (directory / name).exists()]
        if absent:
            if offline:
                raise RuntimeError('Pinned SwiftShader is not cached; one online setup is required')
            print('Downloading pinned Chrome for Testing archive; extracting SwiftShader only', flush=True)
            # No Chromium process is started. Archive bytes and selected members are pinned.
            data = get(lock['url'], limit=256 * 1024 * 1024)
            verify(data, {'bytes': lock['archiveBytes'], 'sha256': lock['archiveSha256']}, 'Chrome for Testing archive')
            with tempfile.TemporaryFile() as file:
                file.write(data)
                file.seek(0)
                with zipfile.ZipFile(file) as archive:
                    for name, identity in lock['files'].items():
                        payload = archive.read('chrome-linux64/' + name)
                        verify(payload, identity, name)
                        (directory / name).write_bytes(payload)
        for name, identity in lock['files'].items():
            verify((directory / name).read_bytes(), identity, name)
        icd = directory / 'vk_swiftshader_icd.json'
        provider = 'pinned Chrome for Testing ' + lock['version']
    descriptor = read_json(icd)
    library = (icd.parent / descriptor['ICD']['library_path']).resolve(strict=True)
    if not library.is_file():
        raise RuntimeError('Vulkan ICD library is not a file')
    ctypes.CDLL('libvulkan.so.1')
    ctypes.CDLL(str(library))
    return {'provider': provider, 'icd': str(icd), 'library': str(library),
            'icdSHA256': digest(icd.read_bytes()), 'librarySHA256': digest(library.read_bytes())}


def snapshot(state, offline, ref, explicit_commit):
    pinned = read_json(ROOT / 'verified-source.json')
    requested = explicit_commit or ref or pinned['commit']
    payloads = {}
    if explicit_commit and not re.fullmatch('[0-9a-f]{40}', explicit_commit):
        raise RuntimeError('--commit requires a complete lowercase 40-character SHA')
    if requested == pinned['commit'] and ref is None:
        metadata = dict(pinned)
        metadata['requestedRef'] = requested
    else:
        if offline:
            raise RuntimeError('Offline mode supports only the checked-in verified commit')
        commit = json.loads(get(REPO + '/commits/' + urllib.parse.quote(requested, safe='')))
        sha = commit['sha']
        if not re.fullmatch('[0-9a-f]{40}', sha) or explicit_commit and sha != explicit_commit:
            raise RuntimeError('GitHub commit identity mismatch')
        tree = json.loads(get(REPO + '/git/trees/' + sha + '?recursive=1'))
        if tree.get('truncated'):
            raise RuntimeError('Incomplete Git tree')
        entries = {e['path']: e for e in tree['tree'] if e['type'] == 'blob'}
        selected = ['index.html', 'AGENTS.md', 'LICENSE'] + [name for name in entries if name.startswith('.agents/')]
        metadata = {'repository': 'https://github.com/mozg4D/frame', 'commit': sha,
                    'commitDate': commit['commit']['committer']['date'], 'requestedRef': requested,
                    'gitBlobs': {name: e['sha'] for name, e in entries.items()}, 'files': {}}
        for name in selected:
            payload = get(RAW + '/' + sha + '/' + name)
            identity = {'bytes': len(payload), 'sha256': digest(payload), 'gitBlob': entries[name]['sha']}
            verify(payload, identity, name)
            metadata['files'][name] = identity
            payloads[name] = payload
    sha = metadata['commit']
    directory = state / 'snapshots' / sha
    for name, identity in metadata['files'].items():
        target = directory / name
        if not target.exists():
            if offline:
                raise RuntimeError('Source snapshot is not cached: ' + name)
            payload = payloads[name] if name in payloads else get(RAW + '/' + sha + '/' + name)
            verify(payload, identity, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
        verify(target.read_bytes(), identity, name)
    html = (directory / 'index.html').read_text()
    match = re.search(r'<meta\s+name="frame-version"\s+content="([^"]+)"', html)
    if not match:
        raise RuntimeError('Frame version metadata is absent')
    metadata['frameVersion'] = match.group(1)
    if sha == pinned['commit']:
        if metadata['files']['index.html']['sha256'] != pinned['files']['index.html']['sha256'] or metadata['frameVersion'] != pinned['frameVersion']:
            raise RuntimeError('Verified Frame version mismatch')
    metadata['resolvedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    write_json(directory / 'source-lock.json', metadata)
    return directory, metadata


def run_phase(directory, output, environment):
    output.mkdir(parents=True)
    env = dict(environment, FRAME_OUTPUT_DIR=str(output))
    with (output / 'runtime.log').open('w') as log:
        result = subprocess.run(['node', str(ROOT / 'adapter.mjs')], cwd=ROOT, env=env,
                                stdout=log, stderr=subprocess.STDOUT, timeout=180)
    if result.returncode:
        raise RuntimeError(f'Frame runtime failed ({result.returncode}); inspect {output / "runtime.log"}')
    report = read_json(output / 'results.json')
    if report.get('completed') is not True or report['errors']:
        raise RuntimeError('Frame runtime did not complete every qualification step')
    if report['source']['commit'] != environment['FRAME_EXPECT_COMMIT']:
        raise RuntimeError('Runtime used an unexpected source revision')
    for name in ['frame-node-viewport.png', 'node-swiftshader-test.hash']:
        if not (output / name).is_file() or not (output / name).stat().st_size:
            raise RuntimeError('Missing output: ' + name)
    if (output / 'frame-node-viewport.png').read_bytes()[:8] != b'\x89PNG\r\n\x1a\n':
        raise RuntimeError('Output is not a PNG')
    return report


def qualify(state, output, driver, source, metadata, offline):
    env = dict(os.environ)
    for name in list(env):
        if name.startswith('FRAME_') or name == 'NODE_PATH':
            env.pop(name)
    env.update(FRAME_SOURCE_DIR=str(source), FRAME_SOURCE_LOCK=str(source / 'source-lock.json'),
               FRAME_EXPECT_COMMIT=metadata['commit'], FRAME_EXPECT_INDEX_SHA256=metadata['files']['index.html']['sha256'],
               FRAME_EXPECT_DRIVER=driver['library'], VK_ICD_FILENAMES=driver['icd'],
               NODE_USE_ENV_PROXY='1', FRAME_OFFLINE='1' if offline else '0')
    preflight = subprocess.run(['node', str(ROOT / 'preflight.mjs')], cwd=ROOT, env=env, text=True,
                               capture_output=True, timeout=30)
    (output / 'preflight.log').write_text(preflight.stdout + preflight.stderr)
    if preflight.returncode:
        raise RuntimeError('Node/dependency preflight failed; inspect ' + str(output / 'preflight.log'))
    system = json.loads(preflight.stdout)
    first = run_phase(source, output / 'create', env)
    geometry = read_json(output / 'create/geometry-before.json')
    env.update(FRAME_INPUT_HASH=str(output / 'create/node-swiftshader-test.hash'),
               FRAME_EXPECT_POSITION_SHA256=geometry['positionsSHA256'],
               FRAME_EXPECT_INDEX_GEOMETRY_SHA256=geometry['indicesSHA256'])
    second = run_phase(source, output / 'fresh-reopen', env)
    fresh = read_json(output / 'fresh-reopen/scene-before.json')
    created = read_json(output / 'create/scene-before.json')
    key = lambda scene: sorted((o['hash'], o['type'], o['parent']) for o in scene['objects'])
    if key(fresh) != key(created):
        raise RuntimeError('Fresh-process reopen changed owner identity or parent membership')
    return {'system': system, 'createRuntimeMs': first['totalMs'], 'freshRuntimeMs': second['totalMs'],
            'sourceCommit': metadata['commit'], 'sourceSHA256': metadata['files']['index.html']['sha256'],
            'frameVersion': metadata['frameVersion'], 'driver': driver,
            'geometry': geometry, 'objectsPreserved': True,
            'scope': '4-control nonplanar open Spline Patch, DPR1 512x384; not browser/UI or large-scene qualification'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument('--ref', help='Resolve a candidate ref such as main; qualify before recording compatibility')
    source.add_argument('--commit', help='A complete immutable SHA; default is verified-source.json')
    parser.add_argument('--state-dir', type=Path, default=ROOT / '.state')
    parser.add_argument('--offline', action='store_true', help='Require cached pinned source and native driver')
    parser.add_argument('--icd', help='Explicit external Vulkan ICD; default downloads pinned SwiftShader')
    args = parser.parse_args(argv)
    state = args.state_dir.resolve()
    output = state / 'runs' / (datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8])
    output.mkdir(parents=True)
    receipt = {'status': 'failed', 'requested': args.commit or args.ref or 'verified-source.json', 'output': str(output)}
    try:
        if platform.system() != 'Linux' or platform.machine() not in ['x86_64', 'AMD64']:
            raise RuntimeError('Only Linux x86_64 is qualified; other platforms are unsupported')
        if sys.version_info < (3, 11):
            raise RuntimeError('Python 3.11 or newer required')
        if not shutil.which('node'):
            raise RuntimeError('Node 24 is required')
        driver = native_driver(state, args.offline, args.icd)
        directory, metadata = snapshot(state, args.offline, args.ref, args.commit)
        print('Qualifying Frame', metadata['commit'], metadata['frameVersion'], flush=True)
        receipt.update(qualify(state, output, driver, directory, metadata, args.offline))
        receipt.update(status='passed', adapterSHA256=digest((ROOT / 'adapter.mjs').read_bytes()),
                       packageLockSHA256=digest((ROOT / 'package-lock.json').read_bytes()))
        write_json(output / 'compatibility.json', receipt)
        # A failed candidate never replaces the last successful local receipt or the checked-in pin.
        write_json(state / 'latest-compatible.json', receipt)
        print(json.dumps(receipt, indent=2))
        return 0
    except Exception as exc:
        receipt['error'] = str(exc)
        write_json(output / 'compatibility.json', receipt)
        print('FAILED:', str(exc), '\nReceipt:', output / 'compatibility.json', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
