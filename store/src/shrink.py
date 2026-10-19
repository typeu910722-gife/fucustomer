# Losslessly-looking size reduction for flat-colour art: 256-colour palette PNG with dithering.
# Usage: python3 store/src/shrink.py <files...>
import sys, os
from PIL import Image
before = after = 0
for f in sys.argv[1:]:
    b = os.path.getsize(f); before += b
    im = Image.open(f)
    has_alpha = im.mode in ('RGBA', 'LA') or 'transparency' in im.info
    q = im.convert('RGBA').quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG) if has_alpha else im.convert('RGB').quantize(256, dither=Image.Dither.FLOYDSTEINBERG)
    tmp = f + '.tmp.png'; q.save(tmp, optimize=True)
    if os.path.getsize(tmp) < b: os.replace(tmp, f)
    else: os.remove(tmp)
    after += os.path.getsize(f)
print(f'{len(sys.argv)-1} files: {before//1024} KB -> {after//1024} KB')
