#!/usr/bin/env python3
"""色盲友善 check: simulates protanopia / deuteranopia / tritanopia (Machado et al. 2009, severity 1.0, linear RGB) on
 (1) the state-carrying colour pairs of each palette (read from client/index.html and client/src/a11y.ts) and reports the
     smallest CIE76 ΔE between the two colours of a pair as each kind of colour-blind viewer sees them;
 (2) optional screenshots: python3 scripts/cvd-check.py shot.png ... writes shot-protan.png / -deutan.png / -tritan.png next to them.
Exit code 1 if a palette made for a deficiency leaves a pair under MIN_DE for that deficiency.
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIN_DE = 20.0  # ΔE76 ≈ 20: clearly different at a glance on a small HUD bar / minimap dot

M = {
    'protan': [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    'deutan': [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    'tritan': [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}
TARGET = {'rg': ['protan', 'deutan'], 'by': ['tritan']}

def lin(c): c /= 255; return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def enc(c): c = max(0.0, min(1.0, c)); return 255 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055)
def hexrgb(h): h = h.lstrip('#'); return [int(h[i:i + 2], 16) for i in (0, 2, 4)]
def sim(rgb, d):
    l = [lin(float(v)) for v in rgb]
    return [enc(sum(M[d][r][k] * l[k] for k in range(3))) for r in range(3)]
def lab(rgb):
    r, g, b = (lin(float(v)) for v in rgb)
    x, y, z = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
def de(a, b): return sum((p - q) ** 2 for p, q in zip(lab(a), lab(b))) ** 0.5

def palettes():
    html = open(os.path.join(ROOT, 'client', 'index.html'), encoding='utf-8').read()
    ts = open(os.path.join(ROOT, 'client', 'src', 'a11y.ts'), encoding='utf-8').read()
    css = {}
    for sel, mode in ((r':root \{ --ui-scale', 'off'), (r'body\[data-cb="rg"\] \{', 'rg'), (r'body\[data-cb="by"\] \{', 'by')):
        m = re.search(sel + r'(.*?)\}', html, re.S)
        css[mode] = dict(re.findall(r'--([\w-]+):\s*(#[0-9a-fA-F]{6})', m.group(1)))
    canvas = {}
    for mode in ('off', 'rg', 'by'):
        m = re.search(r'\b' + mode + r': \{([^}]*)\}', ts)
        canvas[mode] = dict(re.findall(r"(\w+): '(#[0-9a-fA-F]{6})'", m.group(1)))
    return css, canvas

PAIRS_CSS = [('hud-ok', 'hud-low', 'stock bar fine / low'), ('hud-good', 'hud-bad', 'toast good / bad'), ('hud-stam', 'hud-stam-low', 'stamina fine / low'),
             ('hud-ok', 'hud-good', 'money bar / goal reached'), ('ping-good', 'ping-bad', 'ping good / bad')]
PAIRS_CANVAS = [('ok', 'low', 'label bar fine / danger'), ('mid', 'low', 'label bar rising / danger'), ('karen', 'wait', 'minimap karen / waiting'),
                ('karen', 'normal', 'minimap karen / customer'), ('wait', 'normal', 'minimap waiting / customer')]

def report():
    css, canvas = palettes()
    bad = []
    print(f"{'pair':34} {'palette':7} " + ' '.join(f'{d:>7}' for d in ['normal', *M]))
    for pairs, src in ((PAIRS_CSS, css), (PAIRS_CANVAS, canvas)):
        for a, b, name in pairs:
            for mode in ('off', 'rg', 'by'):
                ca, cb = hexrgb(src[mode][a]), hexrgb(src[mode][b])
                vals = [de(ca, cb)] + [de(sim(ca, d), sim(cb, d)) for d in M]
                print(f'{name:34} {mode:7} ' + ' '.join(f'{v:7.1f}' for v in vals))
                for d in TARGET.get(mode, []):
                    v = de(sim(ca, d), sim(cb, d))
                    if v < MIN_DE: bad.append(f'{name} ({mode} palette, {d}): ΔE {v:.1f} < {MIN_DE}')
    for b in bad: print('FAIL', b)
    print('cvd-check:', 'FAILED' if bad else f'every pair ≥ ΔE {MIN_DE} for the deficiency its palette targets')
    return not bad

def shots(paths):
    from PIL import Image
    import numpy as np
    lut = np.array([lin(float(i)) for i in range(256)])
    for p in paths:
        im = np.asarray(Image.open(p).convert('RGB'))
        l = lut[im]
        for d, m in M.items():
            out = np.clip(l @ np.array(m).T, 0, 1)
            out = np.where(out <= 0.0031308, 12.92 * out, 1.055 * out ** (1 / 2.4) - 0.055)
            q = os.path.splitext(p)[0] + f'-{d}.png'
            Image.fromarray((out * 255 + 0.5).astype('uint8')).save(q)
            print('wrote', q)

if __name__ == '__main__':
    ok = report()
    if len(sys.argv) > 1: shots(sys.argv[1:])
    sys.exit(0 if ok else 1)
