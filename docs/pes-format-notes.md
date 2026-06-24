# PES v1 + PEC byte-accurate notes (for export/pes.js)

Source: pyembroidery (EmbroidePy/pyembroidery). Units: 1 unit = 0.1mm. Y is DOWN.
Max delta per move: ±2047 (split larger).

## PES v1 truncated header (simplest machine-valid)
"#PES0001" then: 16 00 00 00 00 00 00 00 00 00 00 00 00 00  (14 bytes)
=> first 4 bytes after magic = 0x16 = 22 = PEC pointer (offset where PEC starts).

## PEC block: header -> stitch block -> graphics
### Header
"LA:" + name[:8] left-justified padded to 16 + 0x0D            (20 bytes)
0x20 x12, 0xFF, 0x00                                            (14 bytes)
0x06  (stride = icon width/8 = 48/8)
0x26  (icon height = 38)
if colors>=1: 0x20 x12, then (count-1), then palette indices...
else: 20 20 20 20 64 20 00 20 00 20 20 20 FF
pad 0x20 from current_thread_count up to 463.

### Stitch block
00 00
int24le placeholder (block length, backfilled at start+2)
31 FF F0
int16le round(width); int16le round(height)
int16le 0x01E0; int16le 0x01B0
<pec_encode stitch stream>
backfill int24le = (pos-start) at start+2.

### pec_encode per stitch (dx,dy = round(x-xx), round(y-yy); accumulate)
write_value(value, long, flag):
  if not long and -64 < value < 63: emit 1 byte value & 0x7F   # short
  else: value &= 0x0FFF; value |= 0x8000; value |= (flag<<8);
        emit 2 bytes BIG-ENDIAN (hi, lo)
flags: JUMP=0x10, TRIM=0x20 (OR'd into high byte). Stitches carry no flag.
- STITCH: if jumping & dx,dy!=0 -> write_stitch(0,0); jumping=false; then write_stitch(dx,dy)
- JUMP: jumping=true; if init -> write_jump(flag=0x10) else write_trimjump(flag=0x20)
- COLOR_CHANGE: if jumping -> write_stitch(0,0), jumping=false; then FE B0, then 02 if color_two else 01; toggle
- END: FF; break
init=false after each.

### Graphics: 48x38 1bpp, stride 6, 228 bytes/image. 1 composite + 1 per color block.
Minimal valid: write 1+numColors copies of bordered blank (or plot scaled points).
bit: graphic[y*6 + (x>>3)] |= 1<<(x&7). scale=min((48-buf)/w,(38-buf)/h),
px=floor(x*scale - cx*scale + 24), py=floor(y*scale - cy*scale + 19).

## Nearest Brother color (compuphase):
rmean=(r1+r2)/2; dist=(((512+rmean)*dr*dr)>>8)+4*dg*dg+(((767-rmean)*db*db)>>8)
