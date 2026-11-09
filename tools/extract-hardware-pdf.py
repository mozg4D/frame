# Extract documented candidates, never a diameter/length cross-product.
# Usage: python tools/extract-hardware-pdf.py Wuerth-fasteners.pdf output.json
# Requires PyMuPDF. Input SHA-256 must match hardware-length-reference.json.
import sys,re,json,hashlib
from pathlib import Path
from collections import defaultdict
import pymupdf
if len(sys.argv)!=3: raise SystemExit('Expected input PDF and output JSON paths')
src=Path(sys.argv[1])
expected='8f4f9abf375ab7c8e140d93976020054ed24e78c7e0e62687e369b39dcc6c3d3'
if hashlib.sha256(src.read_bytes()).hexdigest()!=expected: raise SystemExit('Unexpected catalogue bytes: page/column rules require review')
p=pymupdf.open(src)
configs={
'DIN912':(100,106,{'0082','0084','0080','0083','0094','0097'},(60,82)),
'DIN7985':(92,94,{'0046','0283','0293'},(65,85)),
'DIN965':(95,97,{'0048','0281','0298'},(65,85)),
'DIN7991':(115,119,{'0087','0089','0100','0299'},(100,123)),
'DIN933':(147,152,{'0055','0056','0057','0096','0091'},(65,87)),
'ISO7380':(120,121,{'0060','0098','0099'},(100,125)),
'DIN7982':(52,53,{'0116','0123','0127'},(55,80)),
'DIN6921':(163,163,{'0273'},(110,145)),
}
result={};rejected=[]
for fam,(a,b,codes,(xmin,xmax)) in configs.items():
 rows={}
 for n in range(a,b+1):
  words=p[n-1].get_text('words')
  for word in words:
   if word[4] not in codes:continue
   row=sorted([w for w in words if abs(w[1]-word[1])<1.5],key=lambda w:w[0])
   j=next(j for j,w in enumerate(row) if w is word)
   if j+2>=len(row):continue
   dd,ll=row[j+1][4],row[j+2][4]
   if not dd.isdigit() or not ll.isdigit():continue
   d,l=int(dd),int(ll)
   if fam=='ISO7380':
    if not dd.startswith(('01','02')):continue
    d=int(dd[2:])
   elif fam=='DIN7982':
    if word[4]=='0127':d-=200
    d=d/10;l=l/10 if l in [65,95] else l
   elif fam=='DIN6921':
    if d==926:d=6
    elif d==928:d=8
    elif d==921:d,l=(12,l-200) if l>=200 else (10,l)
    else:continue
   # These A2/A4 article families use a packed diameter-length code.
   elif fam=='DIN965' and word[4]!='0048':continue
   # Independent length cell must agree with the article, never infer the range.
   cells=[w[4] for w in row if xmin<=w[0]<=xmax and re.fullmatch(r'\d+(?:\.\d+)?',w[4])]
   if len(cells)!=1 or float(cells[0])!=l:
    rejected.append((fam,n,word[4],dd,ll,cells));continue
   key=('ST' if fam=='DIN7982' else 'M')+str(d)
   rows.setdefault(key,{})[str(l)]={'page':n,'article':' '.join([word[4],dd,ll])}
 result[fam]={k:{'lengths':sorted(float(x) if '.' in x else int(x) for x in v),'evidence':v} for k,v in rows.items()}
out={'source':'https://www.wurth.ae/downloads/pdf/Totalrange/fasteners%5B1%5D.pdf','sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'pages':515,'families':result}
Path(sys.argv[2]).write_text(json.dumps(out,indent=2)+'\n',encoding='utf-8')
print('Extracted',sum(len(v['lengths']) for rows in result.values() for v in rows.values()),'source candidates; restricted Frame choices and supplementary suppliers are reviewed separately.')
