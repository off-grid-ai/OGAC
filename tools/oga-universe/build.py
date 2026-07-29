#!/usr/bin/env python3
"""Rebuild 'OGA Universe' as a true vector SVG.

Geometry is transcribed from pixel measurements of the source PNG; colors are
sampled from it. Text is live <text> (Menlo mono for poster chrome, Inter for
UI-mockup content); icons are vector paths; the photographic avatars are
embedded as base64 crops so they render identically.
"""
import base64, os, subprocess, sys

W, H = 1535, 1024
HERE = os.path.dirname(os.path.abspath(__file__))
# Input art lives beside the generator (vendored into the repo) so a rebuild is reproducible on any
# machine. It used to read from ~/Downloads, which meant the poster could not be regenerated at all
# once those files moved — and the generator itself was living in a scratchpad.
SHOTS = os.path.join(HERE, "assets")
SRC = os.path.join(SHOTS, "OGA Universe.png")  # reference only; geometry is transcribed, not traced

# ---------------------------------------------------------------- theme
# Usage: build.py [out.svg] [--theme light|dark]
#
# The poster is drawn once and themed by palette, because the console it depicts is itself
# light/dark. A dark hero built by inverting the light SVG in CSS would wreck the embedded device
# screenshots and the emerald, so the colours are resolved HERE and each theme is a real asset.
# Dark values are the console's own dark tokens (globals.css [data-theme='dark']), so the poster and
# the product it shows agree: background #0a0a0a, surface #141414, emerald #34d399.
THEME = "light"
_args = [a for a in sys.argv[1:]]
if "--theme" in _args:
    i = _args.index("--theme")
    THEME = _args[i + 1]
    del _args[i:i + 2]
OUT = _args[0] if _args else f"OGA-Universe-{THEME}.svg"

PALETTES = {
    "light": dict(
        BG="#fefefe", CARD="#f8faf9", WHITE="#ffffff",
        BORDER="#e1e1e1", BORDER_SOFT="#ebedec",
        INK="#111213", INK2="#2a2e2b",
        GRAY="#5f6061", GRAY2="#8b8d8c", GRAY3="#a8aaa9",
        GREEN="#0d6914", GREEN_ICON="#159f35",
        TINT="#eef9f0", TINT_BORDER="#c9e7cd",
        CHROME="#d3d5d4",
        HALO="#f0f1f0", DEVICE_BASE="#eceeed", BROWSER_BAR="#f4f5f4",
        DOT_BG="#ececec", DIVIDER="#e4e6e5", KNOCKOUT="#ffffff",
    ),
    "dark": dict(
        BG="#0a0a0a", CARD="#141414", WHITE="#1a1a1a",
        BORDER="#262626", BORDER_SOFT="#202020",
        INK="#f5f5f5", INK2="#e8e8e8",
        GRAY="#a8a8a8", GRAY2="#8a8a8a", GRAY3="#6e6e6e",
        # The brighter emerald: #0d6914 is unreadable on near-black, and #34d399 is exactly what the
        # console switches to in dark mode.
        GREEN="#34d399", GREEN_ICON="#34d399",
        TINT="#0f241a", TINT_BORDER="#1f4d38",
        CHROME="#3a3a3a",
        HALO="#1f1f1f", DEVICE_BASE="#2a2a2a", BROWSER_BAR="#202020",
        DOT_BG="#242424", DIVIDER="#262626",
        # Stays white: it is a knockout punched THROUGH a filled emerald icon, not a surface.
        KNOCKOUT="#ffffff",
    ),
}
if THEME not in PALETTES:
    raise SystemExit(f"unknown theme {THEME!r} — expected one of {sorted(PALETTES)}")
_P = PALETTES[THEME]
BG, CARD, WHITE = _P["BG"], _P["CARD"], _P["WHITE"]
BORDER, BORDER_SOFT = _P["BORDER"], _P["BORDER_SOFT"]
INK, INK2 = _P["INK"], _P["INK2"]
GRAY, GRAY2, GRAY3 = _P["GRAY"], _P["GRAY2"], _P["GRAY3"]
GREEN, GREEN_ICON = _P["GREEN"], _P["GREEN_ICON"]
TINT, TINT_BORDER = _P["TINT"], _P["TINT_BORDER"]
CHROME = _P["CHROME"]
HALO, DEVICE_BASE, BROWSER_BAR = _P["HALO"], _P["DEVICE_BASE"], _P["BROWSER_BAR"]
DOT_BG, DIVIDER, KNOCKOUT = _P["DOT_BG"], _P["DIVIDER"], _P["KNOCKOUT"]

MONO = "Menlo, 'DejaVu Sans Mono', 'Courier New', monospace"
SANS = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif"

out = []
def add(s): out.append(s)

def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

def n(v):
    return f"{v:g}"

# ---------------------------------------------------------------- primitives
def rect(x, y, w, h, r=0, fill="none", stroke=None, sw=1, extra=""):
    a = f'<rect x="{n(x)}" y="{n(y)}" width="{n(w)}" height="{n(h)}"'
    if r: a += f' rx="{n(r)}"'
    a += f' fill="{fill}"'
    if stroke: a += f' stroke="{stroke}" stroke-width="{n(sw)}"'
    if extra: a += " " + extra
    add(a + "/>")

def circle(cx, cy, r, fill="none", stroke=None, sw=1, extra=""):
    a = f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r)}" fill="{fill}"'
    if stroke: a += f' stroke="{stroke}" stroke-width="{n(sw)}"'
    if extra: a += " " + extra
    add(a + "/>")

def line(x1, y1, x2, y2, stroke=GRAY, sw=1, extra=""):
    add(f'<line x1="{n(x1)}" y1="{n(y1)}" x2="{n(x2)}" y2="{n(y2)}" '
        f'stroke="{stroke}" stroke-width="{n(sw)}" {extra}/>')

def path(d, stroke="none", fill="none", sw=1, extra=""):
    add(f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{n(sw)}" {extra}/>')

def txt(x, y, s, size, font=MONO, weight=None, fill=INK, anchor="start", ls=None, raw=False):
    a = (f'<text x="{n(x)}" y="{n(y)}" font-family="{font}" font-size="{n(size)}" '
         f'fill="{fill}"')
    if weight: a += f' font-weight="{weight}"'
    if anchor != "start": a += f' text-anchor="{anchor}"'
    if ls: a += f' letter-spacing="{n(ls)}"'
    add(a + ">" + (s if raw else esc(s)) + "</text>")

def lines(x, y0, dy, items, **kw):
    for i, s in enumerate(items):
        txt(x, y0 + i * dy, s, **kw)

def group(extra=""):
    add(f"<g {extra}>")
def endgroup():
    add("</g>")

# ---------------------------------------------------------------- icon library
# Every icon is drawn in a 24x24 box centred on the origin (-12..12) and then
# translated/scaled into place. Stroke-based, Lucide-like.
def _shield_check():
    return ('<path d="M0 -10 L8.5 -6.6 V0.6 C8.5 6 4.6 9.4 0 10.6 '
            'C-4.6 9.4 -8.5 6 -8.5 0.6 V-6.6 Z" fill="none" stroke-linejoin="round"/>'
            '<path d="M-4 -0.4 L-1.1 2.6 L4.2 -3.2" fill="none" '
            'stroke-linecap="round" stroke-linejoin="round"/>')

def _cpu():
    p = ['<rect x="-7" y="-7" width="14" height="14" rx="3.2" fill="none"/>',
         '<rect x="-2.8" y="-2.8" width="5.6" height="5.6" rx="1.4" fill="none"/>']
    for t in (-3.6, 0, 3.6):
        p.append(f'<line x1="-10.4" y1="{t}" x2="-7" y2="{t}"/>')
        p.append(f'<line x1="7" y1="{t}" x2="10.4" y2="{t}"/>')
        p.append(f'<line x1="{t}" y1="-10.4" x2="{t}" y2="-7"/>')
        p.append(f'<line x1="{t}" y1="7" x2="{t}" y2="10.4"/>')
    return "".join(p)

def _cpu_solid():
    p = ['<rect x="-7.4" y="-7.4" width="14.8" height="14.8" rx="3.6" '
         'fill="CURRENT" stroke="none"/>',
         '<rect x="-3.1" y="-3.1" width="6.2" height="6.2" rx="1.5" '
         'fill="' + KNOCKOUT + '" stroke="none"/>']
    for t in (-4.0, 0, 4.0):
        p.append(f'<line x1="-10.6" y1="{t}" x2="-7.4" y2="{t}" stroke-linecap="round"/>')
        p.append(f'<line x1="7.4" y1="{t}" x2="10.6" y2="{t}" stroke-linecap="round"/>')
        p.append(f'<line x1="{t}" y1="-10.6" x2="{t}" y2="-7.4" stroke-linecap="round"/>')
        p.append(f'<line x1="{t}" y1="7.4" x2="{t}" y2="10.6" stroke-linecap="round"/>')
    return "".join(p)

def _search():
    return ('<circle cx="-1.6" cy="-1.6" r="6.6" fill="none"/>'
            '<line x1="3.2" y1="3.2" x2="9" y2="9" stroke-linecap="round"/>')

def _sun():
    p = ['<circle cx="0" cy="0" r="4.2" fill="none"/>']
    import math
    for i in range(8):
        a = i * math.pi / 4
        x1, y1 = 6.6 * math.cos(a), 6.6 * math.sin(a)
        x2, y2 = 9.6 * math.cos(a), 9.6 * math.sin(a)
        p.append(f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" '
                 f'stroke-linecap="round"/>')
    return "".join(p)

def _home():
    return ('<path d="M-8 -1 L0 -8.4 L8 -1 V8 H-8 Z" fill="none" '
            'stroke-linejoin="round"/>'
            '<path d="M-2.9 8 V1.4 H2.9 V8" fill="none" stroke-linejoin="round"/>')

def _gear():
    return ('<path d="M-2.2 -8.6 L2.2 -8.6 L2.9 -6.3 L5.2 -7 L7.8 -4.4 L6.8 -2.3 '
            'L8.6 -0.9 L8.6 2.6 L6.6 3.4 L7.3 5.7 L4.7 8.3 L2.6 7.3 L1.2 8.9 '
            'L-2.3 8.9 L-3.1 6.9 L-5.4 7.6 L-8 5 L-7 2.9 L-8.8 1.5 L-8.8 -2 '
            'L-6.8 -2.8 L-7.5 -5.1 L-4.9 -7.7 L-2.8 -6.7 Z" fill="none" '
            'stroke-linejoin="round"/>'
            '<circle cx="0" cy="0" r="3.1" fill="none"/>')

def _molecule():
    return ('<circle cx="0" cy="-6.4" r="2.7" fill="none"/>'
            '<circle cx="-6" cy="4.6" r="2.7" fill="none"/>'
            '<circle cx="6" cy="4.6" r="2.7" fill="none"/>'
            '<line x1="-1.6" y1="-4.2" x2="-4.6" y2="2.3"/>'
            '<line x1="1.6" y1="-4.2" x2="4.6" y2="2.3"/>'
            '<line x1="-3.3" y1="4.6" x2="3.3" y2="4.6"/>')

def _camera():
    return ('<path d="M-9 -3.4 H-5.4 L-3.6 -6.4 H3.6 L5.4 -3.4 H9 '
            'A1.6 1.6 0 0 1 10.6 -1.8 V6.6 A1.6 1.6 0 0 1 9 8.2 H-9 '
            'A1.6 1.6 0 0 1 -10.6 6.6 V-1.8 A1.6 1.6 0 0 1 -9 -3.4 Z" '
            'fill="none" stroke-linejoin="round"/>'
            '<circle cx="0" cy="2.4" r="3.5" fill="none"/>')

def _square_dot():
    return ('<rect x="-8.6" y="-8.6" width="17.2" height="17.2" rx="4" fill="none"/>'
            '<rect x="-3.4" y="-3.4" width="6.8" height="6.8" rx="2" fill="none"/>')

def _grid4():
    p = []
    for dx in (-4.2, 4.2):
        for dy in (-4.2, 4.2):
            p.append(f'<circle cx="{dx}" cy="{dy}" r="3.1" fill="none"/>')
    return "".join(p)

def _sparkle_pen():
    return ('<path d="M-8.4 8.4 L1.6 -1.6 L5.4 2.2 L-4.6 12.2 Z" fill="none" '
            'stroke-linejoin="round" transform="translate(0,-3)"/>'
            '<path d="M3 -8.6 L4.2 -5.8 L7 -4.6 L4.2 -3.4 L3 -0.6 L1.8 -3.4 '
            'L-1 -4.6 L1.8 -5.8 Z" fill="none" stroke-linejoin="round"/>')

def _ops():
    return ('<circle cx="0" cy="0" r="8.6" fill="none"/>'
            '<path d="M0 -8.6 A8.6 8.6 0 0 1 6.1 6.1" fill="none" '
            'stroke-linecap="round" stroke-width="2.6"/>'
            '<circle cx="0" cy="0" r="2.3" fill="none"/>')

def _lock():
    return ('<rect x="-7" y="-1.4" width="14" height="10.6" rx="2.4" fill="none"/>'
            '<path d="M-4.2 -1.4 V-4.8 A4.2 4.2 0 0 1 4.2 -4.8 V-1.4" fill="none"/>'
            '<line x1="0" y1="2.4" x2="0" y2="5.2" stroke-linecap="round"/>')

def _lock_solid():
    return ('<rect x="-7" y="-1.4" width="14" height="10.8" rx="2.6" '
            'fill="CURRENT" stroke="none"/>'
            '<path d="M-4.4 -1.4 V-5 A4.4 4.4 0 0 1 4.4 -5 V-1.4" fill="none" '
            'stroke="CURRENT" stroke-width="2.4"/>'
            '<line x1="0" y1="2" x2="0" y2="5.6" stroke="' + KNOCKOUT + '" '
            'stroke-width="1.8" stroke-linecap="round"/>')

def _target():
    return ('<circle cx="0" cy="0" r="8.6" fill="none"/>'
            '<circle cx="0" cy="0" r="4.2" fill="none"/>'
            '<circle cx="0" cy="0" r="1.5" fill="CURRENT" stroke="none"/>')

def _crosshair():
    return ('<circle cx="0" cy="0" r="6.4" fill="none"/>'
            '<circle cx="0" cy="0" r="2.4" fill="CURRENT" stroke="none"/>'
            '<line x1="0" y1="-11" x2="0" y2="-7.8" stroke-linecap="round"/>'
            '<line x1="0" y1="7.8" x2="0" y2="11" stroke-linecap="round"/>'
            '<line x1="-11" y1="0" x2="-7.8" y2="0" stroke-linecap="round"/>'
            '<line x1="7.8" y1="0" x2="11" y2="0" stroke-linecap="round"/>')

def _package():
    return ('<path d="M0 -9.4 L8.4 -4.7 V4.7 L0 9.4 L-8.4 4.7 V-4.7 Z" fill="none" '
            'stroke-linejoin="round"/>'
            '<path d="M-8.4 -4.7 L0 0 L8.4 -4.7" fill="none"/>'
            '<line x1="0" y1="0" x2="0" y2="9.4"/>')

def _eye():
    return ('<path d="M-9.6 0 C-6.4 -5.4 -2.8 -7 0 -7 C2.8 -7 6.4 -5.4 9.6 0 '
            'C6.4 5.4 2.8 7 0 7 C-2.8 7 -6.4 5.4 -9.6 0 Z" fill="none" '
            'stroke-linejoin="round"/>'
            '<circle cx="0" cy="0" r="2.9" fill="none"/>')

def _message():
    return ('<path d="M-8.4 -6.6 H8.4 A1.8 1.8 0 0 1 10.2 -4.8 V2.6 '
            'A1.8 1.8 0 0 1 8.4 4.4 H-2.4 L-7.6 8.6 V4.4 H-8.4 '
            'A1.8 1.8 0 0 1 -10.2 2.6 V-4.8 A1.8 1.8 0 0 1 -8.4 -6.6 Z" '
            'fill="none" stroke-linejoin="round"/>')

def _mic():
    return ('<path d="M0 -9 A3.4 3.4 0 0 1 3.4 -5.6 V0 A3.4 3.4 0 0 1 -3.4 0 '
            'V-5.6 A3.4 3.4 0 0 1 0 -9 Z" fill="none" stroke-linejoin="round"/>'
            '<path d="M-6.4 -1.4 A6.4 6.4 0 0 0 6.4 -1.4" fill="none" '
            'stroke-linecap="round"/>'
            '<line x1="0" y1="5.2" x2="0" y2="8.8" stroke-linecap="round"/>')

def _scissors():
    return ('<circle cx="-5.4" cy="6" r="2.9" fill="none"/>'
            '<circle cx="5.4" cy="6" r="2.9" fill="none"/>'
            '<line x1="-3.6" y1="3.8" x2="6" y2="-8.4" stroke-linecap="round"/>'
            '<line x1="3.6" y1="3.8" x2="-6" y2="-8.4" stroke-linecap="round"/>')

def _cylinder():
    return ('<ellipse cx="0" cy="-5.4" rx="7.4" ry="3" fill="none"/>'
            '<path d="M-7.4 -5.4 V5.4 A7.4 3 0 0 0 7.4 5.4 V-5.4" fill="none"/>')

def _database():
    p = ['<ellipse cx="0" cy="-6" rx="7.6" ry="2.8" fill="none"/>']
    for dy in (-6, -1.2, 3.6):
        p.append(f'<path d="M-7.6 {dy} A7.6 2.8 0 0 0 7.6 {dy}" fill="none"/>')
    p.append('<line x1="-7.6" y1="-6" x2="-7.6" y2="6.2"/>')
    p.append('<line x1="7.6" y1="-6" x2="7.6" y2="6.2"/>')
    p.append('<path d="M-7.6 6.2 A7.6 2.8 0 0 0 7.6 6.2" fill="none"/>')
    return "".join(p)

def _file():
    return ('<path d="M-6.4 -9 H2.4 L7.4 -4 V9 H-6.4 Z" fill="none" '
            'stroke-linejoin="round"/>'
            '<path d="M2.4 -9 V-4 H7.4" fill="none" stroke-linejoin="round"/>')

def _network():
    return ('<circle cx="0" cy="-6.6" r="2.6" fill="none"/>'
            '<circle cx="-6.6" cy="6" r="2.6" fill="none"/>'
            '<circle cx="6.6" cy="6" r="2.6" fill="none"/>'
            '<line x1="0" y1="-4" x2="0" y2="1.4"/>'
            '<line x1="-6.6" y1="3.4" x2="-6.6" y2="1.4"/>'
            '<line x1="6.6" y1="3.4" x2="6.6" y2="1.4"/>'
            '<line x1="-6.6" y1="1.4" x2="6.6" y2="1.4"/>')

def _apis():
    p = ['<circle cx="0" cy="0" r="2.9" fill="none"/>']
    for (x, y) in ((0, -7.4), (-7.4, 2.4), (7.4, 2.4), (0, 8.4)):
        p.append(f'<circle cx="{x}" cy="{y}" r="2.2" fill="none"/>')
        p.append(f'<line x1="{x*0.35:.2f}" y1="{y*0.35:.2f}" '
                 f'x2="{x*0.68:.2f}" y2="{y*0.68:.2f}"/>')
    return "".join(p)

def _scan_user():
    return ('<path d="M-8.6 -4.6 V-7.4 A1.4 1.4 0 0 1 -7.2 -8.8 H-4.4" fill="none" '
            'stroke-linecap="round"/>'
            '<path d="M8.6 -4.6 V-7.4 A1.4 1.4 0 0 0 7.2 -8.8 H4.4" fill="none" '
            'stroke-linecap="round"/>'
            '<path d="M-8.6 4.6 V7.4 A1.4 1.4 0 0 0 -7.2 8.8 H-4.4" fill="none" '
            'stroke-linecap="round"/>'
            '<path d="M8.6 4.6 V7.4 A1.4 1.4 0 0 1 7.2 8.8 H4.4" fill="none" '
            'stroke-linecap="round"/>'
            '<circle cx="0" cy="-1.8" r="2.7" fill="none"/>'
            '<path d="M-4.2 5.4 A4.4 4.4 0 0 1 4.2 5.4" fill="none" '
            'stroke-linecap="round"/>')

def _check_circle_solid():
    return ('<circle cx="0" cy="0" r="8.6" fill="CURRENT" stroke="none"/>'
            '<path d="M-4.2 0.2 L-1.2 3.2 L4.4 -3" fill="none" stroke="' + KNOCKOUT + '" '
            'stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>')

def _cloud():
    return ('<path d="M-9.4 3.4 A4.6 4.6 0 0 1 -5.4 -3.4 A6.4 6.4 0 0 1 6.2 -1.6 '
            'A4.2 4.2 0 0 1 9.4 3.4 Z" fill="none" stroke-linejoin="round"/>')

def _bar_chart():
    return ('<line x1="-8.6" y1="8.6" x2="-8.6" y2="-1.4" stroke-linecap="round"/>'
            '<line x1="-3.4" y1="8.6" x2="-3.4" y2="-6.4" stroke-linecap="round"/>'
            '<line x1="1.8" y1="8.6" x2="1.8" y2="1.6" stroke-linecap="round"/>'
            '<line x1="7" y1="8.6" x2="7" y2="-8.6" stroke-linecap="round"/>')

def _plus_circle():
    return ('<circle cx="0" cy="0" r="8.6" fill="none"/>'
            '<line x1="0" y1="-4.4" x2="0" y2="4.4" stroke-linecap="round"/>'
            '<line x1="-4.4" y1="0" x2="4.4" y2="0" stroke-linecap="round"/>')

def _line_chart():
    return ('<path d="M-9 -6.4 V8.4 H9" fill="none" stroke-linecap="round" '
            'stroke-linejoin="round"/>'
            '<path d="M-6 3.4 L-1.6 -2.4 L2 1.6 L7.4 -5.4" fill="none" '
            'stroke-linecap="round" stroke-linejoin="round"/>')

def _gauge():
    return ('<circle cx="0" cy="0" r="9.6" fill="none"/>'
            '<line x1="0" y1="0" x2="5" y2="-6" stroke-linecap="round"/>'
            '<circle cx="0" cy="0" r="1.3" fill="CURRENT" stroke="none"/>'
            '<line x1="-6.6" y1="-4.4" x2="-5.4" y2="-3.6" stroke-linecap="round"/>'
            '<line x1="-0.8" y1="-7.6" x2="-0.6" y2="-6.2" stroke-linecap="round"/>')

def _burst():
    p = []
    import math
    for i in range(8):
        a = i * math.pi / 4
        r1 = 3.6 if i % 2 == 0 else 3.2
        r2 = 10.4 if i % 2 == 0 else 8.2
        p.append(f'<line x1="{r1*math.cos(a):.2f}" y1="{r1*math.sin(a):.2f}" '
                 f'x2="{r2*math.cos(a):.2f}" y2="{r2*math.sin(a):.2f}" '
                 f'stroke-linecap="round"/>')
    p.append('<circle cx="0" cy="0" r="1.6" fill="CURRENT" stroke="none"/>')
    return "".join(p)

def _ring_dot():
    return ('<circle cx="0" cy="0" r="9.4" fill="none"/>'
            '<circle cx="0" cy="0" r="4.6" fill="none"/>'
            '<circle cx="0" cy="0" r="1.5" fill="CURRENT" stroke="none"/>')

def _file_pen():
    return ('<path d="M-7 -8.6 H1.2 L6.4 -3.4 V3" fill="none" stroke-linejoin="round"/>'
            '<path d="M-7 -8.6 V8.6 H-0.4" fill="none" stroke-linejoin="round"/>'
            '<path d="M1.2 -8.6 V-3.4 H6.4" fill="none" stroke-linejoin="round"/>'
            '<path d="M2.6 8.4 L8.8 2.2 L6.2 -0.4 L0 5.8 Z" fill="none" '
            'stroke-linejoin="round"/>')

def _file_search():
    return ('<rect x="-8.4" y="-8.6" width="14" height="17.2" rx="2.4" fill="none"/>'
            '<circle cx="0.4" cy="-2.4" r="3.4" fill="none"/>'
            '<line x1="3" y1="0.2" x2="6.4" y2="3.6" stroke-linecap="round"/>')

def _nodes():
    return ('<path d="M-8.6 -6 H-1.6 A1.6 1.6 0 0 1 0 -4.4 V4.4 '
            'A1.6 1.6 0 0 1 -1.6 6 H-8.6" fill="none" stroke-linejoin="round"/>'
            '<circle cx="5.4" cy="-4.6" r="2.4" fill="none"/>'
            '<circle cx="5.4" cy="4.6" r="2.4" fill="none"/>'
            '<line x1="0" y1="-4.6" x2="3" y2="-4.6"/>'
            '<line x1="0" y1="4.6" x2="3" y2="4.6"/>')

def _search_circle():
    return ('<circle cx="-0.6" cy="-0.6" r="7.6" fill="none"/>'
            '<circle cx="-0.6" cy="-0.6" r="3.2" fill="none"/>'
            '<line x1="4.8" y1="4.8" x2="8.8" y2="8.8" stroke-linecap="round"/>')

def _scan_face():
    return ('<path d="M-8.6 -4.4 V-8.6 H-4.4" fill="none" stroke-linecap="round" '
            'stroke-linejoin="round"/>'
            '<path d="M4.4 -8.6 H8.6 V-4.4" fill="none" stroke-linecap="round" '
            'stroke-linejoin="round"/>'
            '<path d="M8.6 4.4 V8.6 H4.4" fill="none" stroke-linecap="round" '
            'stroke-linejoin="round"/>'
            '<path d="M-4.4 8.6 H-8.6 V4.4" fill="none" stroke-linecap="round" '
            'stroke-linejoin="round"/>'
            '<path d="M-4.4 -1.6 L-1.6 1.2 L4.6 -4.2" fill="none" '
            'stroke-linecap="round" stroke-linejoin="round"/>')

def _clipboard_check():
    return ('<rect x="-7.4" y="-7.6" width="14.8" height="16.2" rx="2.4" fill="none"/>'
            '<path d="M-2.6 -7.6 V-9.6 H2.6 V-7.6" fill="none" stroke-linejoin="round"/>'
            '<path d="M-3.6 1 L-0.8 3.8 L4.4 -1.6" fill="none" stroke-linecap="round" '
            'stroke-linejoin="round"/>')

def _eye_target():
    return ('<path d="M0 -8.6 L8.6 0 L0 8.6 L-8.6 0 Z" fill="none" '
            'stroke-linejoin="round"/>'
            '<circle cx="0" cy="0" r="3.4" fill="none"/>'
            '<circle cx="0" cy="0" r="1" fill="CURRENT" stroke="none"/>')

def _ellipsis():
    return ('<circle cx="-6.4" cy="0" r="1.9" fill="CURRENT" stroke="none"/>'
            '<circle cx="0" cy="0" r="1.9" fill="CURRENT" stroke="none"/>'
            '<circle cx="6.4" cy="0" r="1.9" fill="CURRENT" stroke="none"/>')

ICONS = {
    "shield-check": _shield_check, "cpu": _cpu, "cpu-solid": _cpu_solid,
    "search": _search, "sun": _sun, "home": _home, "gear": _gear,
    "molecule": _molecule, "camera": _camera, "square-dot": _square_dot,
    "grid4": _grid4, "sparkle-pen": _sparkle_pen, "ops": _ops, "lock": _lock,
    "lock-solid": _lock_solid, "target": _target, "crosshair": _crosshair,
    "package": _package, "eye": _eye, "message": _message, "mic": _mic,
    "scissors": _scissors, "cylinder": _cylinder, "database": _database,
    "file": _file, "network": _network, "apis": _apis, "scan-user": _scan_user,
    "check": _check_circle_solid, "cloud": _cloud, "bar-chart": _bar_chart,
    "plus-circle": _plus_circle, "line-chart": _line_chart, "gauge": _gauge,
    "burst": _burst, "ring-dot": _ring_dot, "file-pen": _file_pen,
    "file-search": _file_search, "nodes": _nodes, "search-circle": _search_circle,
    "scan-face": _scan_face, "clipboard-check": _clipboard_check,
    "eye-target": _eye_target, "ellipsis": _ellipsis,
}

def icon(name, cx, cy, size, color=GREEN_ICON, sw=1.6):
    """Place an icon centred at (cx, cy) with the given box size."""
    s = size / 24.0
    body = ICONS[name]().replace("CURRENT", color)
    add(f'<g transform="translate({n(cx)},{n(cy)}) scale({s:.4f})" '
        f'stroke="{color}" stroke-width="{n(sw / s)}" fill="none">{body}</g>')

def arrow_right(x1, x2, y, color=INK, sw=1.5, head=4.6):
    line(x1, y, x2, y, color, sw, 'stroke-linecap="round"')
    path(f"M{n(x2 - head)} {n(y - head * 0.72)} L{n(x2)} {n(y)} "
         f"L{n(x2 - head)} {n(y + head * 0.72)}",
         stroke=color, sw=sw, extra='stroke-linecap="round" stroke-linejoin="round"')

def arrow_down(x, y1, y2, color=INK, sw=1.5, head=4.6):
    line(x, y1, x, y2, color, sw, 'stroke-linecap="round"')
    path(f"M{n(x - head * 0.72)} {n(y2 - head)} L{n(x)} {n(y2)} "
         f"L{n(x + head * 0.72)} {n(y2 - head)}",
         stroke=color, sw=sw, extra='stroke-linecap="round" stroke-linejoin="round"')

DASH = 'stroke-dasharray="2.4 2.6" stroke-linecap="round"'

# ---------------------------------------------------------------- avatars
def embed(path, width_px):
    """Downscale a screenshot and inline it as base64 (kept ~3x the display size)."""
    tmp = "/tmp/_oga_embed.png"
    subprocess.run(["magick", path, "-resize", f"{width_px}x", "-strip", tmp], check=True)
    with open(tmp, "rb") as f:
        b = base64.b64encode(f.read()).decode()
    os.remove(tmp)
    return b

# Raster embed widths. The SVG is 730 KB and ~95% of that is these nine base64 PNGs, which matters a
# lot when it is a hero. Each is sized at ~2x its LARGEST realistic display size: the laptop shot
# occupies 226px and the phone 200px of the 1535px canvas, so even shown at full canvas width on a 2x
# display they need ~452 and ~400 device pixels. They were embedded at 820 and 580 — roughly 3.5x more
# data than any screen can resolve.
OGAD_SHOT, OGAD_W, OGAD_H = embed(f"{SHOTS}/OGAD_In_Play.png", 480), 3024, 1670
OGAM_SHOT, OGAM_W, OGAM_H = embed(f"{SHOTS}/OGAM_In_Play.png", 420), 1320, 2868


def avatar_data():
    """Inline the supplied headshots, square-cropped, as base64 PNGs."""
    specs = {
        # Same reasoning: av_big renders at r=24.5 (49px), the cluster avatars smaller still.
        "av_big": ("300.jpeg", 128),
        "av_1": ("32.jpg", 80), "av_2": ("99.jpg", 80), "av_3": ("8.jpg", 80),
        "av_4": ("92.jpg", 80), "av_5": ("61.jpg", 80), "av_6": ("52.jpg", 80),
    }
    data = {}
    for k, (fn, px) in specs.items():
        tmp = f"/tmp/_oga_{k}.png"
        subprocess.run(["magick", f"{SHOTS}/{fn}", "-resize", f"{px}x{px}^",
                        "-gravity", "center", "-extent", f"{px}x{px}",
                        "-strip", tmp], check=True)
        with open(tmp, "rb") as f:
            data[k] = base64.b64encode(f.read()).decode()
        os.remove(tmp)
    return data


AV = avatar_data()

def avatar(key, cx, cy, r, halo=True):
    if halo:
        circle(cx, cy, r + 1.6, fill=HALO)
    cid = f"clip_{key}"
    add(f'<clipPath id="{cid}"><circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r)}"/></clipPath>')
    add(f'<image x="{n(cx - r)}" y="{n(cy - r)}" width="{n(2 * r)}" '
        f'height="{n(2 * r)}" clip-path="url(#{cid})" preserveAspectRatio="xMidYMid slice" '
        f'xlink:href="data:image/png;base64,{AV[key]}"/>')

# ================================================================ document
add(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
    f'width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-kerning="none">')
add('<title>Off Grid AI — The Enterprise AI Control Plane</title>')
rect(0, 0, W, H, fill=BG)

# ---------------------------------------------------------------- header
icon("cpu-solid", 665, 26.5, 27, GREEN_ICON, 2.0)
txt(693, 38, "Off Grid AI", 24.5, MONO, "bold", INK)
txt(758, 98, "The Enterprise AI Control Plane", 55.5, SANS, "800", INK,
    anchor="middle")
add(f'<text x="454" y="130" font-family="{MONO}" font-size="12.7" fill="{GRAY}">'
    f'Connect intelligence at the edge. Govern it in the enterprise. '
    f'<tspan fill="{GREEN}">Multiply  outcomes.</tspan></text>')

FEATS = [
    (372.0, 397, "gear",   "Private by design",  "Data stays on-device"),
    (545.5, 568, "package", "Enterprise grade",  "Governed. Auditable. Compliant."),
    (765.5, 792, "lock",   "Open & extensible",  "Build, integrate, extend"),
    (961.0, 990, "crosshair", "Built for results", "EFFICIENCY quality. New capabilities."),
]
for cx, tx, ic, head, sub in FEATS:
    circle(cx, 172, 15.5, fill=WHITE, stroke=GREEN_ICON, sw=1.2)
    icon(ic, cx, 172, 17, GREEN_ICON, 1.35)
    txt(tx, 169, head, 11, SANS, "700", INK)
    txt(tx, 186.5, sub, 9.5, MONO, None, GRAY)

# ---------------------------------------------------------------- left column
rect(21.5, 182.5, 275, 546, 14, CARD, BORDER)
txt(42, 206, "INTELLIGENCE AT THE EDGE", 12.5, MONO, "bold", GREEN, ls=0.05)
txt(41, 225.5, "Private. On-device. Always with you.", 9.5, MONO, None, GRAY)

# -- OGAM card
rect(30, 241.5, 258, 268, 10, WHITE, BORDER_SOFT)
txt(40, 268.5, "OGAM", 21.5, MONO, "bold", GREEN)
add(f'<text x="103" y="267" font-family="{MONO}" font-size="15" '
    f'font-weight="bold" fill="{INK}">'
    f'<tspan fill="{GRAY3}">|</tspan> Mobile AI</text>')
icon("shield-check", 252, 254, 25, GREEN, 1.7)
lines(41, 288, 14, ["On-device intelligence for", "work anywhere."],
      size=9.5, font=MONO, fill=GRAY)

# phone mockup (clipped to the OGAM card)
add('<clipPath id="clip_ogam"><rect x="30" y="241.5" width="258" height="268" rx="10"/></clipPath>')
group('clip-path="url(#clip_ogam)"')
rect(50, 313, 210, 220, 26, WHITE, CHROME, 2)
rect(55, 318, 200, 215, 22, WHITE)
add('<clipPath id="clip_screen_m">'
    '<rect x="55" y="318" width="200" height="215" rx="22"/></clipPath>')
add(f'<image x="55" y="318" width="200" height="{n(200 * OGAM_H / OGAM_W)}" '
    f'clip-path="url(#clip_screen_m)" '
    f'xlink:href="data:image/png;base64,{OGAM_SHOT}"/>')
rect(50, 313, 210, 220, 26, "none", CHROME, 2)
endgroup()

# -- OGAD card
rect(30, 523.5, 258, 198, 10, WHITE, BORDER_SOFT)
txt(40, 550.5, "OGAD", 21.5, MONO, "bold", GREEN)
add(f'<text x="103" y="549" font-family="{MONO}" font-size="15" '
    f'font-weight="bold" fill="{INK}">'
    f'<tspan fill="{GRAY3}">|</tspan> Desktop AI</text>')
icon("shield-check", 252, 536, 25, GREEN, 1.7)
lines(41, 570, 14, ["On-device power for deep", "focus and heavy lifting."],
      size=9.5, font=MONO, fill=GRAY)
# laptop mockup
rect(30, 712.5, 258, 7, 3.5, DEVICE_BASE, CHROME, 0.9)
path("M118 719 H200", stroke=CHROME, sw=1.2)
rect(42, 592, 233, 121, 5, WHITE, CHROME, 1.4)
rect(45.5, 595.5, 226, 114, 3.5, WHITE, BORDER_SOFT, 0.8)
rect(45.5, 595.5, 226, 11, 3.5, BROWSER_BAR)
rect(45.5, 601, 226, 5.5, 0, BROWSER_BAR)
for i, c in enumerate(("#f2685c", "#f5bd4f", "#61c554")):
    circle(51.5 + i * 6.4, 600.5, 2.2, fill=c)
line(45.5, 606.5, 271.5, 606.5, BORDER_SOFT, 0.8)
add('<clipPath id="clip_screen_d">'
    '<rect x="45.5" y="606.5" width="226" height="103"/></clipPath>')
add(f'<image x="45.5" y="606.5" width="226" height="{n(226 * OGAD_H / OGAD_W)}" '
    f'clip-path="url(#clip_screen_d)" '
    f'xlink:href="data:image/png;base64,{OGAD_SHOT}"/>')
rect(42, 592, 233, 121, 5, "none", CHROME, 1.4)

# -- other data sources
rect(21.5, 734.5, 275, 80, 14, CARD, BORDER)
txt(42, 751.5, "OTHER DATA SOURCES", 12, MONO, "bold", GREEN, ls=0.05)
txt(41, 768.5, "Enterprise data sources and systems.", 9, MONO, None, GRAY)
SOURCES = [(50, "network", "ERP"), (95, "scan-user", "CRM"),
           (140, "cylinder", "Data Lakes"), (187, "database", "Databases"),
           (233, "file", "File Stores"), (274, "apis", "APIs")]
for cx, ic, lab in SOURCES:
    icon(ic, cx, 786, 19, GREEN_ICON, 1.4)
    txt(cx, 807.5, lab, 7, MONO, None, INK, anchor="middle")

# ---------------------------------------------------------------- connectors (left)
lines(353, 372, 19, ["Secure, private", "connections from", "all sources"],
      size=9.5, font=MONO, fill=INK2)
# OGAM -> lock
circle(298, 300, 3.2, fill=INK)
path("M298 300 H332 A10 10 0 0 1 342.5 310 V445.5", stroke=INK2, sw=1.2, extra=DASH)
# data sources -> lock
circle(298, 464, 3.2, fill=INK)
line(302, 464, 323.5, 464, INK2, 1.2, DASH)
# lock -> centre
circle(342.5, 464, 18.5, fill=BG, stroke=INK2, sw=1.2, extra=DASH)
icon("lock-solid", 342.5, 464, 21, INK, 1.4)
line(361.5, 464, 434, 464, INK2, 1.2, DASH)
path("M436.5 459.6 L442.5 464 L436.5 468.4", stroke=INK, sw=1.6,
     extra='stroke-linecap="round" stroke-linejoin="round"')
# lock -> bullets
line(342.5, 482.5, 342.5, 505, INK2, 1.2, DASH)
circle(342.5, 508, 3.2, fill=INK)
SIGNALS = ["SOPs & Guidance", "Risk Signals", "Opportunities",
           "Lessons Learned", "Task Outcomes", "Usage Patterns"]
for i, s in enumerate(SIGNALS):
    y = 528 + i * 24.8
    circle(342.5, y - 3.4, 3.4, fill=GREEN_ICON)
    txt(355, y, s, 9.5, MONO, None, INK2)
# OGAD -> usage patterns
circle(298, 645, 3.2, fill=INK)
line(302, 645, 323, 645, INK2, 1.2, DASH)
circle(326.5, 645, 3.2, fill=INK)

# ---------------------------------------------------------------- centre console
rect(449, 206, 665.5, 592, 16, WHITE, BORDER)
add(f'<text x="609" y="243" font-family="{MONO}" font-size="19" font-weight="bold" '
    f'fill="{INK}"><tspan fill="{GREEN}">OGAC</tspan> '
    f'<tspan fill="{GRAY3}">|</tspan> Off Grid AI Console</text>')
txt(608, 263, "The control plane for your enterprise AI.", 9.5, MONO, None, GRAY)
# top-right controls
rect(955, 224, 78, 27, 8, WHITE, BORDER)
icon("search", 968, 237.5, 13, GRAY, 1.4)
txt(981, 241, "Search", 10, SANS, None, GRAY)
icon("sun", 1057, 238, 17, INK2, 1.3)
circle(1088, 238, 12, fill=DOT_BG)
txt(1088, 241.5, "MA", 9.5, SANS, "700", INK2, anchor="middle")

# sidebar
rect(456.5, 274.5, 113.5, 506, 10, WHITE, BORDER_SOFT)
rect(462, 277, 104, 31, 8, TINT)
NAV = [("home", "Home", 292), ("gear", "Learn", 325), ("molecule", "Remember", 358),
       ("camera", "Act", 391), ("square-dot", "Control", 423.5),
       ("gear", "Data Connectors", 514), ("grid4", "Apps & Agents", 547),
       ("sparkle-pen", "Insights", 579.5), ("ops", "Operations", 612)]
for i, (ic, lab, cy) in enumerate(NAV):
    col = GREEN if i == 0 else INK2
    icon(ic, 476, cy, 15, col, 1.4)
    txt(492, cy + 4.5, lab, 9.5, SANS, "600" if i == 0 else None, col)

CX0, CW = 587, 514.5          # content column
CCX = CX0 + CW / 2            # 844.25

# -- learn / remember / act / control
rect(CX0, 274.5, CW, 98, 10, WHITE, BORDER_SOFT)
PILLARS = [
    (607, "Learn", ["Continuously learns", "from every interaction", "and data source."]),
    (724, "Remember", ["Organizes and retains", "enterprise knowledge", "securely."]),
    (841, "Act", ["Turns knowledge into", "actions, apps and", "automations."]),
    (958, "Control", ["Governed, auditable", "and measurable", "at every step."]),
]
for i, (x, head, body) in enumerate(PILLARS):
    txt(x, 304, head, 14, SANS, "700", GREEN)
    lines(x, 326, 14, body, size=9.5, font=SANS, fill=INK2)
    if i < 3:
        ax = (695, 810, 906)[i]
        arrow_right(ax, ax + 19, 299, INK2, 1.3, 4.2)

# -- governance & access
rect(CX0, 382.5, CW, 211, 10, WHITE, BORDER_SOFT)
txt(CCX, 400, "Governance & Access", 14, SANS, "700", INK2, anchor="middle")
txt(CCX, 420, "Roles  •  Permissions  •  Policies  •  Guardrails  •  Approvals  •  Audit Trail",
    9.5, SANS, None, INK2, anchor="middle")
BANDS = [
    (432.5, "Gateways",
     "Secure Ingress  •  AuthN/Z  •  Routing  •  Throttling  •  Network Controls"),
    (483.5, "Pipelines",
     "Orchestration  •  Data Processing Safeguards  •  Observability"),
    (534.5, "Data Connectors",
     "ERP  •  CRM  •  Databases  •  File Stores  •  APIs  •  Ticketing  •  More"),
]
for y, head, sub in BANDS:
    rect(598, y, 492, 45, 8, TINT, TINT_BORDER)
    txt(CCX, y + 21, head, 13.5, SANS, "700", INK2, anchor="middle")
    txt(CCX, y + 38, sub, 9.5, SANS, None, INK2, anchor="middle")

# -- continuous assurance
rect(CX0, 607.5, CW, 102, 10, WHITE, BORDER_SOFT)
txt(CCX, 626, "Continuous Assurance & Improvement", 14, SANS, "700", INK2, anchor="middle")
ASSUR = [
    ("cloud", "AI QA & Evaluations", ["Quality that improves", "over time"]),
    ("target", "Golden Sets", ["Versioned sets for", "consistent quality"]),
    ("bar-chart", "Drift Detection", ["Data & model drift", "monitoring"]),
    ("plus-circle", "Prompt Health", ["Detects + fixes", "degradation"]),
    ("line-chart", "Observability", ["Traces, metrics", "& alerts"]),
]
for i, (ic, head, body) in enumerate(ASSUR):
    x = 594 + i * 101.6
    rect(x, 634, 93.6, 61, 7, WHITE, BORDER_SOFT)
    icon(ic, x + 14, 654, 17, GREEN_ICON, 1.35)
    txt(x + 27, 651, head, 6.4, SANS, "700", INK2)
    lines(x + 27, 665, 13.5, body, size=6.4, font=SANS, fill=GRAY)

# -- built-in band
rect(586.5, 720.5, 515, 52, 10, TINT, TINT_BORDER)
txt(CCX, 743, "Built-in Reliability, Security, Auditability & Observability",
    13.5, SANS, "700", GREEN, anchor="middle")
txt(CCX, 762.5, "Private  •  Compliant  •  Audit-ready  •  Always improving",
    9.5, SANS, None, GREEN, anchor="middle")

# ---------------------------------------------------------------- connectors (right)
path("M1160 321 V617", stroke=INK2, sw=1.2, extra=DASH)
for y in (321, 617):
    line(1160, y, 1202, y, INK2, 1.2, DASH)
    circle(1205.5, y, 3.2, fill=INK)
circle(1160, 464, 18.5, fill=BG, stroke=INK2, sw=1.2, extra=DASH)
icon("lock-solid", 1160, 464, 21, INK, 1.4)
line(1120, 464, 1141.5, 464, INK2, 1.2, DASH)
circle(1117, 464, 3.2, fill=INK)
line(1178.5, 464, 1196, 464, INK2, 1.2, DASH)
path("M1198 459.6 L1204 464 L1198 468.4", stroke=INK, sw=1.6,
     extra='stroke-linecap="round" stroke-linejoin="round"')

# ---------------------------------------------------------------- right column
rect(1208.5, 182.5, 305, 626, 14, CARD, BORDER)
add(f'<text x="1229" y="206" font-family="{MONO}" font-size="12" font-weight="bold" '
    f'letter-spacing="0.05" fill="{GREEN}">NO-CODE  •  BUILT BY YOUR TEAM</text>')
txt(1229, 223.5, "SMEs automate their work in natural language.", 9.5, MONO, None, GRAY)

# -- describe it
rect(1221, 242.5, 282, 139, 10, WHITE, BORDER_SOFT)
txt(1235, 262, "Describe it. We build it.", 13, MONO, "bold", INK)
rect(1236, 276.5, 180, 80, 8, TINT, TINT_BORDER, 1)
path("M1416 307.5 L1428.5 316.5 L1416 325.5 Z", fill=TINT, stroke=TINT_BORDER, sw=1)
line(1415.4, 308.6, 1415.4, 324.4, TINT, 1.8)
lines(1243, 297, 15, ['\u201cWhen a customer submits a credit',
                      'application, verify their details,',
                      'check bureau, assess risk, and',
                      'create the case in our system.\u201d'],
      size=8, font=MONO, fill=INK2)
avatar("av_big", 1461, 333.5, 24.5)
arrow_down(1348, 358, 374, INK2, 1.5, 5)

# -- instantly get
rect(1221, 383.5, 282, 237, 10, WHITE, BORDER_SOFT)
lines(1235, 405, 18, ["Instantly get enterprise-grade",
                      "apps, agents and automations."],
      size=11.5, font=MONO, fill=INK)
APPS = [
    ("file-pen", ["Underwriting", "Assistant"]), ("file-search", ["Credit Risk", "Analyzer"]),
    ("nodes", ["Policy Co-Pilot"]), ("search-circle", ["Collections", "Agent"]),
    ("scan-face", ["KYC Automation"]), ("clipboard-check", ["Sales", "Intelligence"]),
    ("eye-target", ["Fraud Detection"]), ("ellipsis", None),
]
for i, (ic, labs) in enumerate(APPS):
    col, row = i % 2, i // 2
    tx = 1231 + col * 136
    ty = 435 + row * 45.5
    rect(tx, ty, 122, 39, 7, WHITE, BORDER_SOFT)
    icon(ic, tx + 19, ty + 19.5, 19, INK if ic == "ellipsis" else GREEN_ICON, 1.45)
    if labs is None:
        add(f'<text x="{n(tx + 38)}" y="{n(ty + 16)}" font-family="{MONO}" '
            f'font-size="8.5" fill="{INK}"><tspan font-weight="bold" '
            f'font-size="10.5">290+</tspan> more</text>')
        txt(tx + 38, ty + 29, "apps & agents", 8.5, MONO, None, INK)
    elif len(labs) == 1:
        txt(tx + 38, ty + 23, labs[0], 8.5, MONO, None, INK)
    else:
        lines(tx + 38, ty + 16, 13, labs, size=8.5, font=MONO, fill=INK)

# -- power of an engineering team
rect(1221, 634.5, 282, 160, 10, WHITE, BORDER_SOFT)
lines(1235, 651, 15, ["The power of an engineering team,",
                      "in the hands of every SME."],
      size=10.5, font=MONO, fill=INK)
CHECKS = [["Explain in natural language"], ["Automate complex processes"],
          ["Boost productivity"], ["Deliver consistent, high quality"],
          ["Unlock capabilities that were", "previously impossible"]]
y = 686
for item in CHECKS:
    icon("check", 1242, y - 3.4, 13, GREEN_ICON, 1)
    for j, part in enumerate(item):
        txt(1256, y + j * 12, part, 6.6, MONO, None, INK2)
    y += 17 + (12 if len(item) > 1 else 0)
for r_, cy in ((0, 698.5), (1, 738.5)):
    for c_, cx in enumerate((1407, 1438.5, 1470)):
        avatar(f"av_{r_ * 3 + c_ + 1}", cx, cy, 14.5)
txt(1272, 789, "Your team. Supercharged.", 10.5, MONO, "bold", GREEN)

# ---------------------------------------------------------------- outcomes band
rect(21.5, 820.5, 1492, 140, 14, CARD, BORDER)
for x in (265.5, 531.5, 825.5, 1149.5):
    line(x, 836, x, 945, DIVIDER, 1.2)
add(f'<text x="59" y="853" font-family="{MONO}" font-size="15.5" font-weight="bold" '
    f'fill="{GREEN}">OUTCOMES THAT MOVE</text>')
add(f'<text x="59" y="876" font-family="{MONO}" font-size="15.5" font-weight="bold" '
    f'fill="{GREEN}">THE BUSINESS</text>')

OUTCOMES = [
    (311, 351, "gauge", "MORE  EFFICIENCY", "Lower total cost. Higher velocity.",
     ["Automate manual & repetitive work", "Reduce handoffs and delays",
      "Do more with the same team"]),
    (572.5, 617, "crosshair", "MORE EFFECTIVENESS", "Better quality, Fewer misses.",
     ["Consistent, governed processes", "Fewer errors and rework",
      "Right context, right decisions"]),
    (871, 920, "burst", "UNLOCK NEW CAPABILITIES", "Do what bandwidth never allowed.",
     ["Scale without headcount bloat", "Innovate faster",
      "Create new revenue opportunities"]),
]
for icx, tx, ic, head, sub, bullets in OUTCOMES:
    icon(ic, icx, 858, 34, GREEN_ICON, 1.4)
    add(f'<text x="{n(tx)}" y="844" font-family="{MONO}" font-size="10.5" '
        f'font-weight="bold" fill="{GREEN}">{esc(head)}</text>')
    txt(tx, 860, sub, 8.5, MONO, None, INK2)
    for i, b in enumerate(bullets):
        by = 889 + i * 20.7
        icon("check", tx + 5, by - 3.2, 12, GREEN_ICON, 1)
        txt(tx + 17, by, b, 8, MONO, None, INK2)

rect(1153.5, 827.5, 340, 127, 10, WHITE, BORDER_SOFT)
txt(1171, 851, "Lower Total Cost of the Process", 10.5, MONO, "bold", INK)
lines(1171, 873, 17.5, ["By automating and streamlining end-to-end",
                        "workflows — manual, physical or digital —",
                        "with intelligence and reliability."],
      size=9.5, font=MONO, fill=INK2)
txt(1171, 933, "That's Off Grid AI.", 10, MONO, "bold", GREEN)

# ---------------------------------------------------------------- footer
icon("ring-dot", 204, 988, 22, GREEN_ICON, 1.5)
add(f'<text x="232" y="993" font-family="{MONO}" font-size="10.5" fill="{INK2}" '
    f'letter-spacing="0.6">EDGE  INTELLIGENCE  '
    f'<tspan font-weight="bold">(OGAM / OGAD /</tspan> DATA)</text>')
arrow_right(529, 558, 988, INK2, 1.4, 5)
icon("cpu", 605, 988, 21, GREEN_ICON, 1.5)
add(f'<text x="633" y="993" font-family="{MONO}" font-size="10.5" fill="{INK2}" '
    f'letter-spacing="0.6"><tspan font-weight="bold">ENTERPRISE</tspan> AI '
    f'<tspan font-weight="bold">CONTROL PLANE</tspan> (OGAC)</text>')
arrow_right(905, 935, 988, INK2, 1.4, 5)
icon("burst", 982, 988, 21, GREEN_ICON, 1.4)
add(f'<text x="1010" y="993" font-family="{MONO}" font-size="10.5" fill="{INK2}" '
    f'letter-spacing="0.6"><tspan font-weight="bold">OUTCOMES</tspan> THAT '
    f'<tspan font-weight="bold">MOVE</tspan> THE '
    f'<tspan font-weight="bold">BUSINESS</tspan></text>')
txt(1501, 993, "offgridai.co", 10, MONO, None, GRAY, anchor="end")

add("</svg>")

with open(OUT, "w") as f:
    f.write("\n".join(out) + "\n")
print(f"wrote {OUT} ({os.path.getsize(OUT)/1024:.0f} KB, {len(out)} nodes)")
