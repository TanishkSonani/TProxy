"""Code-generated power/status icons; no fonts, downloads or image dependencies."""
import math, struct, sys, zlib
from pathlib import Path
def chunk(kind,data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
def png(size,on):
    pixels=bytearray()
    color=(52,211,153) if on else (148,163,184)
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            channels=[0,0,0,0]
            for sy in (.25,.75):
                for sx in (.25,.75):
                    dx=(x+sx-size/2)/size;dy=(y+sy-size/2)/size;r=math.hypot(dx,dy)
                    rgb=(15,23,42);alpha=255 if r<.48 else 0
                    ring=abs(r-.275)<.037 and abs(math.atan2(dx,-dy))>.60
                    line=abs(dx)<.037 and -.36<dy<-.075
                    if ring or line:rgb=color
                    for i,v in enumerate((*rgb,alpha)):channels[i]+=v
            pixels.extend(v//4 for v in channels)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(pixels,9))+chunk(b'IEND',b'')
def icon(path,on):
    sizes=[16,32,48,64,128,256];images=[png(s,on) for s in sizes];offset=6+16*len(images);entries=[]
    for size,data in zip(sizes,images):
        entries.append(struct.pack('<BBBBHHII',size%256,size%256,0,0,1,32,len(data),offset));offset+=len(data)
    path.write_bytes(struct.pack('<HHH',0,1,len(images))+b''.join(entries)+b''.join(images))
root=Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
for on in [False,True]:icon(root/('tproxy-on.ico' if on else 'tproxy-off.ico'),on)
