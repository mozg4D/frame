"""Reconstruct the exact unpublished GPU v10 development snapshot.
Reads a pinned main checkout; writes only to a new destination. Does not serve or deploy.
Requires Python 3.10+, Node, and TypeScript (installed separately or FRAME_TYPESCRIPT).
"""
from pathlib import Path
import argparse,hashlib,json,shutil,subprocess
HERE=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
def read_checked(path,digest,size=None):
 b=path.read_bytes()
 if sha(b)!=digest or size is not None and len(b)!=size:raise ValueError('Input hash/size mismatch: '+str(path))
 return b
def apply_delta(path,patch):
 d=json.loads(patch.read_bytes());b=read_checked(path,d['beforeSHA256'],d['beforeBytes']);lines=b.decode('utf-8').splitlines(keepends=True)
 for e in reversed(d['operations']):lines[e['startLine']:e['startLine']+e['deleteLines']]=e['insert']
 result=''.join(lines).encode('utf-8')
 if sha(result)!=d['afterSHA256'] or len(result)!=d['afterBytes']:raise ValueError('Delta result mismatch')
 return result
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--repository',required=True,type=Path);ap.add_argument('--destination',required=True,type=Path);a=ap.parse_args()
 repo=a.repository.resolve();dest=a.destination.resolve();m=json.loads((HERE/'build-manifest.json').read_bytes())
 if dest.exists() or dest==repo or repo in dest.parents or dest in repo.parents:raise ValueError('Use a NEW destination outside the source checkout')
 # Resolve all inputs before creating output. The current branch name is not trusted.
 files={}
 for row in m['runtime']:
  if row.get('fromRepository'):files['frame/'+row['path']]=read_checked(repo/row['path'],row['sha256'],row['bytes'])
 for name in m.get('currentDocumentation',[]):files['frame/'+name]=(repo/name).read_bytes()
 for row in m['nativeSources']:
  files[row['output']]=read_checked((repo if row['fromRepository'] else HERE)/row['input'],row['sha256'],row['bytes'])
 files['frame/'+m['editor']]=apply_delta(repo/m['baseEditor'],HERE/'patches/editor-from-r226.json')
 files['frame/index.html']=apply_delta(repo/'index.html',HERE/'patches/shell-from-r226.json')
 dest.mkdir(parents=True,exist_ok=False)
 for name,data in files.items():
  p=dest/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
 result=subprocess.run(['node',str(dest/'migration/bundle-native.mjs'),str(dest/'frame'/m['native'])],check=True,capture_output=True,text=True)
 for row in m['runtime']:read_checked(dest/'frame'/row['path'],row['sha256'],row['bytes'])
 actual={p.relative_to(dest/'frame').as_posix() for p in (dest/'frame').rglob('*') if p.is_file()}
 if actual!=({r['path'] for r in m['runtime']}|set(m.get('currentDocumentation',[]))):raise ValueError('Runtime file closure mismatch')
 print(json.dumps({'pass':True,'releaseAccepted':False,'baseCommit':m['baseCommit'],'runtimeFiles':len(m['runtime']),'nativeSourceFiles':len(m['nativeSources']),'allPinnedBytesVerified':True,'currentDocumentationCopied':m.get('currentDocumentation',[]),'nativeBuild':json.loads(result.stdout)},indent=2))
if __name__=='__main__':main()
