#!/usr/bin/env python3
import argparse, struct, subprocess, tempfile, os, sys
from pathlib import Path

SHDR=46

def chunks(data,start,end):
    p=start
    while p+8<=end:
        cid=data[p:p+4]; size=struct.unpack_from('<I',data,p+4)[0]; body=p+8
        yield cid,body,size,p
        p=body+size+(size&1)

def pack_chunk(cid,payload,pad=True):
    out=cid+struct.pack('<I',len(payload))+payload
    if pad and (len(payload)&1): out+=b'\0'
    return out

def pack_list(kind,payload,pad=True): return pack_chunk(b'LIST',kind+payload,pad)

def top_lists(data):
    out=[]
    for cid,b,s,p in chunks(data,12,len(data)):
        if cid==b'LIST': out.append((data[b:b+4],b+4,b+s,p,s))
    return out

def subchunk_list(data,start,end): return list(chunks(data,start,end))

def vorbis_encode(pcm:bytes,sr:int,quality:float):
    cmd=['ffmpeg','-hide_banner','-loglevel','error','-f','s16le','-ar',str(sr),'-ac','1','-i','pipe:0','-c:a','libvorbis','-qscale:a',str(quality),'-f','ogg','pipe:1']
    cp=subprocess.run(cmd,input=pcm,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if cp.returncode!=0:
        raise RuntimeError(cp.stderr.decode('utf8','replace'))
    if not cp.stdout.startswith(b'OggS'): raise RuntimeError('ffmpeg did not return Ogg')
    return cp.stdout

def convert(src:Path,dst:Path,quality:float):
    data=src.read_bytes()
    if data[:4]!=b'RIFF' or data[8:12]!=b'sfbk': raise ValueError(f'{src}: not SF2')
    tops=top_lists(data)
    info=next(x for x in tops if x[0]==b'INFO')
    sdta=next(x for x in tops if x[0]==b'sdta')
    pdta=next(x for x in tops if x[0]==b'pdta')
    sd={cid:(b,s,p) for cid,b,s,p in subchunk_list(data,sdta[1],sdta[2])}
    pd={cid:(b,s,p) for cid,b,s,p in subchunk_list(data,pdta[1],pdta[2])}
    if b'smpl' not in sd or b'shdr' not in pd: raise ValueError('missing smpl/shdr')
    sb,ss,_=sd[b'smpl']; smpl=data[sb:sb+ss]
    hb,hs,_=pd[b'shdr']; raw_sh=data[hb:hb+hs]
    if hs%SHDR: raise ValueError('bad shdr size')
    sh=[raw_sh[i:i+SHDR] for i in range(0,hs,SHDR)]
    if len(sh)<2: raise ValueError('no sample headers')

    new_smpl=bytearray(); new_sh=[]
    count=len(sh)-1
    for i,rec in enumerate(sh[:-1]):
        name=rec[:20]
        start,end,ls,le,sr=struct.unpack_from('<5I',rec,20)
        op=rec[40]; pc=struct.unpack_from('<b',rec,41)[0]; link,stype=struct.unpack_from('<HH',rec,42)
        if end<=start or end*2>len(smpl):
            raise ValueError(f'{src.name} sample {i} invalid range {start}:{end}')
        pcm=smpl[start*2:end*2]
        ogg=vorbis_encode(pcm,sr,quality)
        new_start=len(new_smpl)
        new_smpl.extend(ogg)
        new_end=len(new_smpl) # exclusive; compatible with Spessa/TinySoundFont readers
        rel_ls=max(0,ls-start); rel_le=max(rel_ls,le-start)
        # compressed sample flag; preserve mono/stereo/link type bits
        new_type=stype|0x10
        new_sh.append(name+struct.pack('<5IBbHH',new_start,new_end,rel_ls,rel_le,sr,op,pc,link,new_type))
        if (i+1)%25==0 or i+1==count:
            print(f'  {src.name}: encoded {i+1}/{count}',file=sys.stderr)
    eos=sh[-1]
    eos_name=eos[:20]
    # terminal record points to end of compressed blob
    _,_,_,_,sr=struct.unpack_from('<5I',eos,20)
    op=eos[40]; pc=struct.unpack_from('<b',eos,41)[0]; link,stype=struct.unpack_from('<HH',eos,42)
    pos=len(new_smpl)
    new_sh.append(eos_name+struct.pack('<5IBbHH',pos,pos,0,0,sr or 44100,op,pc,link,stype))

    # rebuild INFO with ifil 3.0, preserving everything else
    info_payload=b''
    for cid,b,s,p in subchunk_list(data,info[1],info[2]):
        payload=data[b:b+s]
        if cid==b'ifil' and len(payload)>=4: payload=struct.pack('<HH',3,0)+payload[4:]
        info_payload+=pack_chunk(cid,payload)

    # SF3 uses unpadded LIST/smpl behavior in common implementations; keep ordinary RIFF padding for compatibility
    sd_payload=pack_chunk(b'smpl',bytes(new_smpl))
    pd_payload=b''
    for cid,b,s,p in subchunk_list(data,pdta[1],pdta[2]):
        payload=b''.join(new_sh) if cid==b'shdr' else data[b:b+s]
        pd_payload+=pack_chunk(cid,payload)
    body=b'sfbk'+pack_list(b'INFO',info_payload)+pack_list(b'sdta',sd_payload)+pack_list(b'pdta',pd_payload)
    out=b'RIFF'+struct.pack('<I',len(body))+body
    dst.parent.mkdir(parents=True,exist_ok=True); dst.write_bytes(out)
    print(f'{src.name}: {len(data)/1048576:.2f} MiB -> {len(out)/1048576:.2f} MiB',file=sys.stderr)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('dst'); ap.add_argument('--quality',type=float,default=4.0)
    a=ap.parse_args(); convert(Path(a.src),Path(a.dst),a.quality)
if __name__=='__main__': main()
