#!/usr/bin/env python3
"""Embed IPTC/XMP "trainedAlgorithmicMedia" (AI-generated) metadata into every
docs/assets/photo/*.webp without re-encoding. Idempotent.
Usage: python3 -I scripts/tag-ai-images.py [dir]"""
import struct, sys, pathlib
from PIL import Image

XMP = ('<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
 '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
 '<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-12/" '
 'Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/>'
 '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>').encode('utf-8')

def chunk(tag, data):
    return tag + struct.pack('<I', len(data)) + data + (b'\0' if len(data) % 2 else b'')

def tag(path):
    raw = path.read_bytes()
    if b'trainedAlgorithmicMedia' in raw: return False
    assert raw[:4] == b'RIFF' and raw[8:12] == b'WEBP'
    w, h = Image.open(path).size
    body = raw[12:]
    if body[:4] == b'VP8X':
        flags = body[8] | 0x04
        size = struct.unpack('<I', body[4:8])[0]
        head = chunk(b'VP8X', bytes([flags]) + body[9:8 + size])
        rest = body[8 + size + (size % 2):]
    else:  # simple lossy/lossless file: add an extended header
        head = chunk(b'VP8X', bytes([0x04, 0, 0, 0]) + (w - 1).to_bytes(3, 'little') + (h - 1).to_bytes(3, 'little'))
        rest = body
    new = b'WEBP' + head + rest + chunk(b'XMP ', XMP)
    path.write_bytes(b'RIFF' + struct.pack('<I', len(new)) + new)
    return True

d = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'docs/assets/photo')
n = sum(tag(p) for p in sorted(d.glob('*.webp')))
print('tagged', n, 'of', len(list(d.glob('*.webp'))))
