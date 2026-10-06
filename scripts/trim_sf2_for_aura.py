#!/usr/bin/env python3
import struct, sys
from pathlib import Path

PHDR=38; PBAG=4; PMOD=10; PGEN=4; INST=22; IBAG=4; IMOD=10; IGEN=4; SHDR=46

def riff_chunks(data,start,end):
    p=start
    while p+8<=end:
        cid=data[p:p+4]; size=struct.unpack_from('<I',data,p+4)[0]; body=p+8
        yield cid,body,size,p
        p=body+size+(size&1)

def top_lists(data):
    out={}
    for cid,b,s,p in riff_chunks(data,12,len(data)):
        if cid==b'LIST': out[data[b:b+4]]=(b+4,b+s,p,s)
    return out

def subchunks(data,start,end):
    return {cid:(b,s,p) for cid,b,s,p in riff_chunks(data,start,end)}

def pack_chunk(cid,payload):
    x=cid+struct.pack('<I',len(payload))+payload
    return x+(b'\0' if len(payload)&1 else b'')

def pack_list(kind,payload):
    return pack_chunk(b'LIST',kind+payload)

def zone_records(data, arr, ibags, igens, insts, keep_keys):
    # Return list of raw generator lists and raw mod-index values for kept zones.
    zones=[]
    for ii in range(len(insts)-1):
        bag0=struct.unpack_from('<H',insts[ii],20)[0]
        bag1=struct.unpack_from('<H',insts[ii+1],20)[0]
        for bi in range(bag0,bag1):
            g0,m0=struct.unpack('<HH',ibags[bi])
            g1=struct.unpack_from('<H',ibags[bi+1])[0]
            gens=[]; key=(0,127); sid=None
            for gi in range(g0,g1):
                op,amt=struct.unpack('<HH',igens[gi]); gens.append((op,amt))
                if op==43:key=(amt&255,(amt>>8)&255)
                elif op==53:sid=amt
            # global zone (no sample ID) always stays; local only if overlaps one selected key
            if sid is None or any(key[0]<=k<=key[1] for k in keep_keys):
                zones.append((ii,m0,gens,sid))
    return zones

def trim(src,dst,keys):
    data=Path(src).read_bytes()
    if data[:4]!=b'RIFF' or data[8:12]!=b'sfbk': raise ValueError('not SF2')
    lists=top_lists(data)
    info=lists[b'INFO']; sdta=lists[b'sdta']; pdta=lists[b'pdta']
    sd=subchunks(data,sdta[0],sdta[1]); pd=subchunks(data,pdta[0],pdta[1])
    smpl_b,smpl_s,_=sd[b'smpl']; smpl=data[smpl_b:smpl_b+smpl_s]
    # refuse sm24 for simplicity (none expected here)
    if b'sm24' in sd: raise ValueError('sm24 not supported')
    sizes={b'phdr':PHDR,b'pbag':PBAG,b'pmod':PMOD,b'pgen':PGEN,b'inst':INST,b'ibag':IBAG,b'imod':IMOD,b'igen':IGEN,b'shdr':SHDR}
    arr={}
    for cid,rs in sizes.items():
        b,s,_=pd[cid]; arr[cid]=[data[i:i+rs] for i in range(b,b+s,rs)]
    ibags=arr[b'ibag']; igens=arr[b'igen']; insts=arr[b'inst']; shdrs=arr[b'shdr']
    zones=zone_records(data,arr,ibags,igens,insts,keys)
    keep_sids={sid for *_,sid in zones if sid is not None}
    # include stereo links recursively
    changed=True
    while changed:
        changed=False
        for sid in list(keep_sids):
            if sid>=len(shdrs)-1: continue
            rec=shdrs[sid]
            link=struct.unpack_from('<H',rec,42)[0]; stype=struct.unpack_from('<H',rec,44)[0]
            if (stype & 0x0006) and link < len(shdrs)-1 and link not in keep_sids:
                keep_sids.add(link); changed=True
    old_to_new={sid:i for i,sid in enumerate(sorted(keep_sids))}

    # rebuild PCM and sample headers
    pcm=bytearray(); new_sh=[]
    for sid in sorted(keep_sids):
        rec=shdrs[sid]
        name=rec[:20]; start,end,ls,le,sr=struct.unpack_from('<5I',rec,20)
        op=rec[40]; pc=struct.unpack_from('<b',rec,41)[0]; link=struct.unpack_from('<H',rec,42)[0]; stype=struct.unpack_from('<H',rec,44)[0]
        new_start=len(pcm)//2
        sample_bytes=smpl[start*2:end*2]
        pcm.extend(sample_bytes)
        new_end=len(pcm)//2
        rel_ls=max(0,ls-start); rel_le=max(rel_ls,le-start)
        new_ls=min(new_end,new_start+rel_ls); new_le=min(new_end,new_start+rel_le)
        new_link=old_to_new.get(link,0)
        new_sh.append(name+struct.pack('<5IBbHH',new_start,new_end,new_ls,new_le,sr,op,pc,new_link,stype))
        pcm.extend(b'\0'*(46*2))
    eos_point=len(pcm)//2
    new_sh.append(b'EOS'+b'\0'*17+struct.pack('<5IBbHH',eos_point,eos_point,eos_point,eos_point,44100,0,0,0,1))

    # rebuild igen/ibag, preserving mod index values
    new_igens=[]; new_ibags=[]
    inst_zone_counts=[0]*(len(insts)-1)
    for ii,m0,gens,sid in zones:
        new_ibags.append(struct.pack('<HH',len(new_igens),m0))
        for op,amt in gens:
            if op==53 and sid is not None: amt=old_to_new[sid]
            new_igens.append(struct.pack('<HH',op,amt))
        inst_zone_counts[ii]+=1
    # terminal ibag must point to terminal igen and end mod list index
    imod_count=max(0,len(arr[b'imod'])-1)
    new_ibags.append(struct.pack('<HH',len(new_igens),imod_count))
    new_igens.append(struct.pack('<HH',0,0))  # terminal generator

    # rebuild inst records with cumulative bag indexes
    new_inst=[]; bag_cursor=0
    for ii,rec in enumerate(insts[:-1]):
        new_inst.append(rec[:20]+struct.pack('<H',bag_cursor))
        bag_cursor+=inst_zone_counts[ii]
    new_inst.append(b'EOI'+b'\0'*17+struct.pack('<H',bag_cursor))

    # info list exact payload
    info_payload=data[info[0]:info[1]]
    sd_payload=pack_chunk(b'smpl',bytes(pcm))
    pd_order=[b'phdr',b'pbag',b'pmod',b'pgen',b'inst',b'ibag',b'imod',b'igen',b'shdr']
    replacements={
        b'inst':b''.join(new_inst),b'ibag':b''.join(new_ibags),b'igen':b''.join(new_igens),b'shdr':b''.join(new_sh)
    }
    pd_payload=b''
    for cid in pd_order:
        payload=replacements.get(cid,b''.join(arr[cid]))
        pd_payload+=pack_chunk(cid,payload)
    body=b'sfbk'+pack_list(b'INFO',info_payload)+pack_list(b'sdta',sd_payload)+pack_list(b'pdta',pd_payload)
    out=b'RIFF'+struct.pack('<I',len(body))+body
    Path(dst).write_bytes(out)
    print(f'{src}: {len(data)/2**20:.1f} MiB -> {len(out)/2**20:.1f} MiB; samples {len(shdrs)-1}->{len(new_sh)-1}; zones {sum(inst_zone_counts)}')

if __name__=='__main__':
    src,dst,*ks=sys.argv[1:]
    trim(src,dst,{int(x) for x in ks})
