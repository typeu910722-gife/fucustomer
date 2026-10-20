#!/usr/bin/env python3
"""Builds client/public/fonts/huninn.woff2: the justfont 粉圓 (Open Huninn, SIL OFL 1.1) font cut down to the
characters the game actually uses, so the download stays small. Re-run after adding new text:
    pip install fonttools brotli && python3 scripts/font-subset.py
The full font is downloaded once into .cache/ (not committed)."""
import glob, os, urllib.request
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '.cache', 'jf-openhuninn-2.1.ttf')
URL = 'https://github.com/justfont/open-huninn-font/releases/download/v2.1/jf-openhuninn-2.1.ttf'
OUT = os.path.join(ROOT, 'client', 'public', 'fonts', 'huninn.woff2')
LIST = os.path.join(ROOT, 'scripts', 'font-chars.txt')  # checked by tests/font.test.ts

def used_chars():
    files = glob.glob(os.path.join(ROOT, 'client', 'src', '**', '*.ts'), recursive=True) + \
        glob.glob(os.path.join(ROOT, 'shared', '**', '*.ts'), recursive=True) + [os.path.join(ROOT, 'client', 'index.html')]
    chars = set(chr(c) for c in range(0x20, 0x7f))
    chars |= set('，。、；：？！「」『』（）《》〈〉…—～・．％＋－×÷＝／＄★☆→←↑↓　')
    for f in files:
        with open(f, encoding='utf-8') as fh:
            for ch in fh.read():
                if ord(ch) > 0x7f and not (0x1F000 <= ord(ch) <= 0x1FFFF) and not (0x2600 <= ord(ch) <= 0x27BF) and ch not in '️‍':
                    chars.add(ch)
    return chars

if __name__ == '__main__':
    if not os.path.exists(SRC):
        os.makedirs(os.path.dirname(SRC), exist_ok=True)
        urllib.request.urlretrieve(URL, SRC)
    chars = used_chars()
    opts = subset.Options(); opts.flavor = 'woff2'; opts.layout_features = ['*']; opts.name_IDs = ['*']; opts.notdef_outline = True
    font = subset.load_font(SRC, opts)
    s = subset.Subsetter(opts); s.populate(text=''.join(sorted(chars))); s.subset(font)
    subset.save_font(font, OUT, opts)
    with open(LIST, 'w', encoding='utf-8') as fh: fh.write(''.join(sorted(c for c in chars if ord(c) > 0x7f)))
    print(f'{len(chars)} characters -> {OUT} ({os.path.getsize(OUT) // 1024} KB)')
