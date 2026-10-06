#!/usr/bin/env python3
import re,struct,sys,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SF=ROOT/'public'/'soundfonts'
MAX=25*1024*1024

def chunks(d,s,e):
 p=s
 while p+8<=e:
  c=d[p:p+4]; n=struct.unpack_from('<I',d,p+4)[0]; b=p+8; yield c,b,n,p; p=b+n+(n&1)

def check(p):
 d=p.read_bytes(); errs=[]
 if len(d)>MAX: errs.append(f'over 25 MiB: {len(d)/1048576:.2f}')
 if d[:4]!=b'RIFF' or d[8:12]!=b'sfbk': return ['not RIFF sfbk']
 lists={}
 for c,b,n,o in chunks(d,12,len(d)):
  if c==b'LIST': lists[d[b:b+4]]=(b+4,b+n)
 try:
  info,sdta,pdta=lists[b'INFO'],lists[b'sdta'],lists[b'pdta']
 except KeyError as e:return [f'missing {e}']
 im={c:(b,n) for c,b,n,o in chunks(d,*info)}; sm={c:(b,n) for c,b,n,o in chunks(d,*sdta)}; pm={c:(b,n) for c,b,n,o in chunks(d,*pdta)}
 if b'ifil' not in im: errs.append('missing ifil')
 else:
  b,n=im[b'ifil']; maj,minr=struct.unpack_from('<HH',d,b)
  if maj!=3: errs.append(f'ifil major={maj}')
 if b'smpl' not in sm or b'shdr' not in pm:return errs+['missing smpl/shdr']
 sb,ss=sm[b'smpl']; smpl=d[sb:sb+ss]; hb,hs=pm[b'shdr']
 if hs%46: errs.append('bad shdr size'); return errs
 recs=[d[i:i+46] for i in range(hb,hb+hs,46)]
 for i,r in enumerate(recs[:-1]):
  start,end,ls,le,sr=struct.unpack_from('<5I',r,20); stype=struct.unpack_from('<H',r,44)[0]
  if not(stype&0x10): errs.append(f'sample {i} not compressed'); continue
  if start>=end or end>len(smpl): errs.append(f'sample {i} bounds {start}:{end}/{len(smpl)}'); continue
  if smpl[start:start+4]!=b'OggS': errs.append(f'sample {i} missing OggS')
 # decode first nonterminal sample with ffmpeg to catch malformed streams
 if recs[:-1]:
  r=recs[0]; start,end=struct.unpack_from('<2I',r,20); ogg=smpl[start:end]
  cp=subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i','pipe:0','-f','null','-'],input=ogg,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  if cp.returncode: errs.append('first Ogg decode failed: '+cp.stderr.decode('utf8','replace')[:120])
 return errs

studio=(ROOT/'src/audio/soundfontStudio.ts').read_text()
urls=re.findall(r"'/soundfonts/([^']+\.sf3)'",studio)
missing=[]
for u in urls:
 if not (SF/u).exists(): missing.append(u)
if missing:
 print('Missing referenced banks:',*missing,sep='\n  ');sys.exit(2)
failed=False
for p in sorted(SF.rglob('*.sf3')):
 e=check(p); print(f'{p.relative_to(ROOT)} {p.stat().st_size/1048576:6.2f} MiB', 'OK' if not e else 'FAIL '+ '; '.join(e))
 failed|=bool(e)
if failed:sys.exit(1)
print(f'All {len(list(SF.rglob("*.sf3")))} SF3 banks valid and <=25 MiB.')
