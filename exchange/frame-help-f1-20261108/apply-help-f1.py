"""Exact technical source delta. Never launches a browser or runs tests.
python apply-help-f1.py help-f1-delta.json TARGET [--apply]
python apply-help-f1.py help-f1-delta.json TARGET --base-from EXISTING_MAIN_COPY
--base-from creates TARGET from verified local sources, retrieving only missing or
mismatched public files from the pinned base commit. It never changes the source copy.
"""
from pathlib import Path,PurePosixPath
import json,hashlib,base64,sys,urllib.request
if len(sys.argv) not in (3,4,5):raise SystemExit(__doc__)
d=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'));target=Path(sys.argv[2]).resolve();sha=lambda b:hashlib.sha256(b).hexdigest()
assert d['format']=='frame-help-f1-delta-v1' and d['sourceOnly'] and len(d['beforeFiles'])==554 and len(d['afterFiles'])==557
assert d['baseCommit']=='69320eabf91b1cdd838a09082c34a843f21aec21'
def safe(root,p):
 q=PurePosixPath(p);assert not q.is_absolute() and '..' not in q.parts and '\\' not in p
 t=root.joinpath(*q.parts);assert t.resolve().is_relative_to(root) and not t.is_symlink();return t
if len(sys.argv)==5:
 assert sys.argv[3]=='--base-from' and not target.exists();source=Path(sys.argv[4]).resolve(strict=True);downloads={}
 for p,h in d['beforeFiles'].items():
  f=safe(source,p)
  if f.is_file() and sha(f.read_bytes())==h:continue
  url='https://raw.githubusercontent.com/mozg4D/frame/'+d['baseCommit']+'/'+p
  with urllib.request.urlopen(url,timeout=30) as response:content=response.read()
  assert sha(content)==h,p;downloads[p]=content
 target.mkdir(parents=True)
 for p,h in d['beforeFiles'].items():
  content=downloads[p] if p in downloads else safe(source,p).read_bytes();assert sha(content)==h,p
  f=safe(target,p);f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(content)
 print(json.dumps({'baseFilesVerified':554,'downloadedFromPinnedMain':list(downloads)}));raise SystemExit(0)
assert target.is_dir()
def matches(files):return all(safe(target,p).is_file() and sha(safe(target,p).read_bytes())==h for p,h in files.items())
if matches(d['afterFiles']):print(json.dumps({'status':'already-applied-verified','files':557,'runtime':d['runtimeSHA256']}));raise SystemExit(0)
assert matches(d['beforeFiles']),'Base inventory mismatch; nothing written'
plan={}
for patch in d['patches']:
 p=patch['path'];assert p not in plan;file=safe(target,p)
 if patch['beforeSHA256'] is None:assert p not in d['beforeFiles'] and not file.exists();old=b''
 else:old=file.read_bytes();assert sha(old)==patch['beforeSHA256']==d['beforeFiles'][p]
 if 'replacements' in patch:
  value=old.decode('utf-8')
  for edit in patch['replacements']:assert value.count(edit['before'])==edit['count'];value=value.replace(edit['before'],edit['after'])
  result=value.encode('utf-8')
 else:
  start=patch['offset'];a=base64.b64decode(patch['beforeBase64'],validate=True);b=base64.b64decode(patch['afterBase64'],validate=True)
  assert 0<=start<=len(old) and old[start:start+len(a)]==a;result=old[:start]+b+old[start+len(a):]
 assert sha(result)==patch['afterSHA256']==d['afterFiles'][p];plan[p]=result
assert all(sha(plan[p] if p in plan else safe(target,p).read_bytes())==h for p,h in d['afterFiles'].items())
if len(sys.argv)==4:
 assert sys.argv[3]=='--apply'
 for p,b in plan.items():safe(target,p).write_bytes(b)
 assert matches(d['afterFiles'])
print(json.dumps({'status':'applied-verified' if len(sys.argv)==4 else 'plan-verified','changedFiles':len(plan),'files':557,'runtime':d['runtimeSHA256']}))
