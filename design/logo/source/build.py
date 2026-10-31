"""Builds the 9Drive logo kit SVGs: marks, lockups (horizontal, stacked; full and small cut), colours."""
import sys, os
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
from geometry import FULL, SMALL

FONT = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)

BLUE, INK = "#2563eb", "#18181b"          # light UI: accent, text
BLUE_D, INK_D = "#6b9bf2", "#ededef"      # dark UI: accent, text

MARK_X0, MARK_X1, MARK_TOP, MARK_BOTTOM = 56.0, 200.0, 24.0, 235.94

font = TTFont(FONT)
glyphset = font.getGlyphSet()
UPEM = font["head"].unitsPerEm
CAP = font["OS/2"].sCapHeight
blob = hb.Blob.from_file_path(FONT)
hbfont = hb.Font(hb.Face(blob))

def text_path(text, cap_px, x, baseline, tracking=0.0):
    """Outlines of `text` with cap height `cap_px`, left edge of the first glyph's origin at x."""
    s = cap_px / CAP
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(hbfont, buf, {"kern": True, "liga": True})
    names = font.getGlyphOrder()
    pen = SVGPathPen(glyphset, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    bpen = BoundsPen(glyphset)
    cx = 0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        g = names[info.codepoint]
        t = (s, 0, 0, -s, x + (cx + pos.x_offset) * s, baseline - pos.y_offset * s)
        glyphset[g].draw(TransformPen(pen, t)); glyphset[g].draw(TransformPen(bpen, t))
        cx += pos.x_advance + tracking * UPEM
    return pen.getCommands(), bpen.bounds

def lsb(ch):
    g = font.getBestCmap()[ord(ch)]
    return font["hmtx"][g][1]

def mark_group(paths, fill, dx=0.0, dy=0.0, scale=1.0):
    body = "".join(f'<path fill-rule="evenodd" d="{d}"/>' for d in paths)
    return f'<g fill="{fill}" transform="translate({dx:.2f} {dy:.2f}) scale({scale})">{body}</g>'

def write(name, w, h, content, title="9Drive"):
    with open(os.path.join(OUT, name), "w") as fh:
        fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.2f} {h:.2f}" role="img" aria-label="{title}"><title>{title}</title>{content}</svg>')

# Marks
for paths, suffix in [(FULL, ""), (SMALL, "-small")]:
    write(f"9drive-mark{suffix}.svg", 256, 256, mark_group(paths, BLUE))
    write(f"9drive-mark{suffix}-dark.svg", 256, 256, mark_group(paths, BLUE_D))
    write(f"9drive-mark{suffix}-master.svg", 256, 256, mark_group(paths, "#000"))

# Horizontal lockup: the mark is the "9" of the name. The round top and bottom of the 9 overshoot
# the cap height and baseline by ~1.4 % each, as round letters do.
OVERSHOOT = 3.0
cap_px = (MARK_BOTTOM - MARK_TOP) - 2 * OVERSHOOT
baseline = MARK_BOTTOM - OVERSHOOT
GAP = 0.085 * cap_px          # optical gap between the 9's round side and D's stem (tuned by eye)
def horizontal(paths, mark_fill, ink, name):
    x_text = (MARK_X1 - MARK_X0) + GAP - lsb("D") * cap_px / CAP
    d, b = text_path("Drive", cap_px, x_text, baseline, tracking=-0.01)
    width = b[2]
    content = mark_group(paths, mark_fill, dx=-MARK_X0) + f'<path fill="{ink}" d="{d}"/>'
    write(name, width, 256, content)
    return width
for paths, suffix in [(FULL, ""), (SMALL, "-small")]:
    w = horizontal(paths, BLUE, INK, f"9drive-lockup{suffix}.svg")
    horizontal(paths, BLUE_D, INK_D, f"9drive-lockup{suffix}-dark.svg")
    horizontal(paths, "#000", "#000", f"9drive-lockup{suffix}-master.svg")
print("horizontal lockup width (height 256):", round(w, 1))

# Stacked lockup: mark above, "Drive" below at 45 % of the mark's cap height.
def stacked(mark_fill, ink, name):
    st_cap = 0.45 * cap_px
    d, b = text_path("Drive", st_cap, 0, 0, tracking=-0.01)
    tw = b[2] - b[0]
    W = max(tw, MARK_X1 - MARK_X0) + 0
    mark_w = MARK_X1 - MARK_X0
    gap = 0.42 * st_cap
    text_top = (MARK_BOTTOM - MARK_TOP) + gap
    H = text_top + st_cap
    d, b = text_path("Drive", st_cap, (W - tw) / 2 - b[0], text_top + st_cap, tracking=-0.01)
    content = mark_group(FULL, mark_fill, dx=(W - mark_w) / 2 - MARK_X0, dy=-MARK_TOP) + f'<path fill="{ink}" d="{d}"/>'
    write(name, W, H, content)
stacked(BLUE, INK, "9drive-lockup-stacked.svg")
stacked(BLUE_D, INK_D, "9drive-lockup-stacked-dark.svg")
stacked("#000", "#000", "9drive-lockup-stacked-master.svg")
