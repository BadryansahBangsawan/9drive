"""9Drive "Stack" mark: a bold geometric 9 (ring + tangent arm with a round end) sliced
horizontally into stacked layers. All edges are computed exactly: arcs, lines, no clip paths."""
import math

CX, CY, RO, RI = 128.0, 96.0, 72.0, 28.0          # bowl: outer/inner radius
W = RO - RI                                          # stroke weight (44)
TH = math.radians(40)                                # arm leaves the bowl 40° below horizontal
D = (-math.sin(TH), math.cos(TH))                    # arm direction (down-left)
N = (math.cos(TH), math.sin(TH))                     # arm normal (radial at the junction)
RC = (RO + RI) / 2
T = (CX + RC * math.cos(TH), CY + RC * math.sin(TH))
L = 112.0
E = (T[0] + D[0] * L, T[1] + D[1] * L)               # arm end (centre of the round cap)
H = W / 2
P1 = (T[0] + N[0] * H, T[1] + N[1] * H)              # outer edge start (tangent to outer circle)
P4 = (T[0] - N[0] * H, T[1] - N[1] * H)              # inner edge start (tangent to inner circle)
P2 = (E[0] + N[0] * H, E[1] + N[1] * H)              # outer edge end
P3 = (E[0] - N[0] * H, E[1] - N[1] * H)              # inner edge end
K = D[0] / D[1]                                      # dx per dy along the arm

def x_outer(y): return P1[0] + K * (y - P1[1])
def x_inner(y): return P4[0] + K * (y - P4[1])
def circle_x(y, side):                               # outer circle x at height y; side -1 left, +1 right
    return CX + side * math.sqrt(RO * RO - (y - CY) ** 2)

def f(v): return f"{v:.2f}".rstrip("0").rstrip(".")
def pt(p): return f"{f(p[0])} {f(p[1])}"

def inner_edge_meets_circle():
    # s along the inner edge from P4 where it leaves the outer circle
    dx, dy = P4[0] - CX, P4[1] - CY
    b = 2 * (dx * D[0] + dy * D[1]); c = dx * dx + dy * dy - RO * RO
    s = (-b + math.sqrt(b * b - 4 * c)) / 2
    return (P4[0] + D[0] * s, P4[1] + D[1] * s)

COUNTER = f"M{f(CX)} {f(CY-RI)} A{f(RI)} {f(RI)} 0 1 0 {f(CX)} {f(CY+RI)} A{f(RI)} {f(RI)} 0 1 0 {f(CX)} {f(CY-RI)} Z"

def top_layer(y_cut):
    """Bowl above y_cut (with the counter as a hole). Handles a cut below P1, where the arm's
    outer edge (tangent at P1) runs just outside the circle."""
    xl = circle_x(y_cut, -1)
    if y_cut <= P1[1]:
        xr = circle_x(y_cut, +1)
        return f"M{pt((xl, y_cut))} A{f(RO)} {f(RO)} 0 1 1 {pt((xr, y_cut))} Z " + COUNTER
    return (f"M{pt((xl, y_cut))} A{f(RO)} {f(RO)} 0 1 1 {pt(P1)} L{pt((x_outer(y_cut), y_cut))} Z " + COUNTER)

def arm_band(y0, y1):
    """Straight piece of the arm between y0 and y1 (both below the bowl, above the cap)."""
    assert y0 >= CY + RO and y1 <= P3[1]
    return f"M{pt((x_inner(y0), y0))} L{pt((x_outer(y0), y0))} L{pt((x_outer(y1), y1))} L{pt((x_inner(y1), y1))} Z"

def bottom_layer(y0):
    """Arm below y0, ending in a round cap. y0 may fall inside the cap."""
    if y0 < P3[1]:
        return (f"M{pt((x_inner(y0), y0))} L{pt((x_outer(y0), y0))} L{pt(P2)} "
                f"A{f(H)} {f(H)} 0 0 1 {pt(P3)} Z")
    xl = E[0] - math.sqrt(H * H - (y0 - E[1]) ** 2)
    return f"M{pt((xl, y0))} L{pt((x_outer(y0), y0))} L{pt(P2)} A{f(H)} {f(H)} 0 0 1 {pt((xl, y0))} Z"

def svg(paths, fill="#000", title="9Drive", extra=""):
    body = "".join(f'<path fill-rule="evenodd" d="{d}"/>' for d in paths)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="{title}">'
            f'<title>{title}</title>{extra}<g fill="{fill}">{body}</g></svg>')

GAP = 12
BOWL_CUT = 158              # the bowl ends flat here; 34 units of ring under the counter
TAIL_TOP = 170              # below the bowl's lowest point (168): the tail layers are pure arm
# Full mark (>= 48 px): bowl + two equal tail layers.
SPLIT = 197
FULL = [top_layer(BOWL_CUT), arm_band(TAIL_TOP, SPLIT), bottom_layer(SPLIT + GAP)]
# Small cut (<= 32 px): bowl + one tail layer, wider gap so it survives 16 px.
SMALL = [top_layer(152), bottom_layer(TAIL_TOP)]

if __name__ == "__main__":
    import sys
    print("layer heights:", BOWL_CUT - (CY - RO), SPLIT - TAIL_TOP, (E[1] + H) - (SPLIT + GAP))
    print("bottom:", E[1] + H, "left:", min(E[0] - H, CX - RO), "right:", CX + RO)
