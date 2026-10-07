"""Mono Vorbis fallback for FFmpeg builds without libvorbis (requires libsndfile)."""
import ctypes
import ctypes.util
import sys

library = ctypes.util.find_library('sndfile')
if not library:
    raise RuntimeError('Use FFmpeg with libvorbis, or install libsndfile for Vorbis encoding')
sndfile = ctypes.CDLL(library)


class Info(ctypes.Structure):
    _fields_ = [('frames', ctypes.c_int64), ('samplerate', ctypes.c_int),
                ('channels', ctypes.c_int), ('format', ctypes.c_int),
                ('sections', ctypes.c_int), ('seekable', ctypes.c_int)]


sndfile.sf_open.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.POINTER(Info)]
sndfile.sf_open.restype = ctypes.c_void_p
sndfile.sf_command.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
sndfile.sf_write_float.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_float), ctypes.c_int64]
sndfile.sf_write_float.restype = ctypes.c_int64
sndfile.sf_close.argtypes = [ctypes.c_void_p]

raw = open(sys.argv[1], 'rb').read()
data = (ctypes.c_float * (len(raw) // 4)).from_buffer_copy(raw)
info = Info(0, int(sys.argv[3]), 1, 0x200000 | 0x0060, 0, 0)  # OGG | VORBIS
handle = sndfile.sf_open(sys.argv[2].encode(), 0x20, ctypes.byref(info))  # SFM_WRITE
if not handle:
    raise RuntimeError('libsndfile could not open the Vorbis output')
try:
    quality = ctypes.c_double(.5)
    sndfile.sf_command(handle, 0x1300, ctypes.byref(quality), ctypes.sizeof(quality))
    if sndfile.sf_write_float(handle, data, len(data)) != len(data):
        raise RuntimeError('Incomplete Vorbis write')
finally:
    if sndfile.sf_close(handle):
        raise RuntimeError('Vorbis finalization failed')
