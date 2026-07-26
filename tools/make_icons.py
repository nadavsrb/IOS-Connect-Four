#!/usr/bin/env python3
"""Generate the app icons with the Python standard library only (no Pillow).

Draws the app's Classic theme — the default one — rather than a generic grid: a
glossy moulded-plastic blue cabinet on the deep navy page gradient, drilled navy
sockets, and red/yellow tokens with the same concentric ridge and centre dimple
the real discs have (see `.disc` in styles.css). The three reds form a diagonal
four-in-a-row with the game's own glowing win streak drawn through them, so the
icon says "Connect Four, and someone just won" at a glance.

Legibility at 40px drove the composition: a 3x3 grid is the most cells that stay
distinct that small, and a single diagonal reads as a line where a scattered
pattern reads as noise.

Run: python3 tools/make_icons.py
"""
import math
import os
import struct
import zlib

# --- Classic theme palette, lifted from styles.css -------------------------
BG_TOP = (0x13, 0x24, 0x4D)      # --bg-layers base linear, top
BG_BOT = (0x0B, 0x17, 0x30)      # …and bottom
GLOW = (0x3C, 0x78, 0xE6)        # the blue page glow
BOARD_HI = (0x3A, 0x88, 0xFF)    # cabinet, lit top-left
BOARD_LO = (0x12, 0x3F, 0x9C)    # cabinet, shaded bottom-right
SOCKET_IN = (0x07, 0x16, 0x34)   # socket centre
SOCKET_OUT = (0x0A, 0x1C, 0x40)  # socket rim
RED = (0xFF, 0x3B, 0x30)         # P1 default
YELLOW = (0xFF, 0xD2, 0x3F)      # P2 default

# R = red, Y = yellow, 0 = empty. The reds run top-left → bottom-right: that is
# the direction the eye reads first and the direction the cabinet is lit from, so
# the winning line and the highlight reinforce each other instead of crossing.
PATTERN = [
    ["R", "0", "Y"],
    ["Y", "R", "0"],
    ["0", "Y", "R"],
]


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def lerp(a, b, t):
    t = clamp(t)
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def scale(c, f):
    return tuple(v * f for v in c)


class Canvas:
    """Float RGB buffer with coverage-blended drawing. Opaque throughout, so
    there is no alpha compositing to get wrong — every icon is full-bleed."""

    def __init__(self, size):
        self.s = size
        self.buf = [0.0] * (size * size * 3)

    def _blend(self, x, y, color, cov):
        if cov <= 0 or x < 0 or y < 0 or x >= self.s or y >= self.s:
            return
        i = (y * self.s + x) * 3
        b = self.buf
        if cov >= 1:
            b[i], b[i + 1], b[i + 2] = color[0], color[1], color[2]
        else:
            inv = 1 - cov
            b[i] = color[0] * cov + b[i] * inv
            b[i + 1] = color[1] * cov + b[i + 1] * inv
            b[i + 2] = color[2] * cov + b[i + 2] * inv

    def add(self, x, y, color, amount):
        """Screen-ish additive light, for glows."""
        if amount <= 0 or x < 0 or y < 0 or x >= self.s or y >= self.s:
            return
        i = (y * self.s + x) * 3
        b = self.buf
        for k in range(3):
            b[i + k] = min(255.0, b[i + k] + color[k] * amount)

    # --- background ------------------------------------------------------
    def background(self):
        s = self.s
        for y in range(s):
            col = lerp(BG_TOP, BG_BOT, y / (s - 1))
            for x in range(s):
                self._blend(x, y, col, 1)
        # A broad glow behind where the cabinet will sit, so it reads as lit
        # plastic on a lit field rather than a sticker on a flat colour.
        self.glow(s * 0.5, s * 0.46, s * 0.62, GLOW, 0.42)

    def glow(self, cx, cy, rad, color, peak):
        for y in range(max(0, int(cy - rad)), min(self.s, int(cy + rad) + 1)):
            for x in range(max(0, int(cx - rad)), min(self.s, int(cx + rad) + 1)):
                d = math.hypot(x - cx, y - cy) / rad
                if d >= 1:
                    continue
                f = (1 - d) ** 2.2
                self.add(x, y, color, f * peak)

    # --- shapes ----------------------------------------------------------
    @staticmethod
    def _round_rect_sdf(x, y, cx, cy, hw, hh, rad):
        qx = abs(x - cx) - (hw - rad)
        qy = abs(y - cy) - (hh - rad)
        return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - rad

    def rounded_rect(self, x0, y0, x1, y1, rad, shade):
        """`shade(u, v)` returns the colour at normalised position (0..1) inside
        the rect, so the cabinet's gradient and sheen are one pass."""
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        hw, hh = (x1 - x0) / 2, (y1 - y0) / 2
        for y in range(max(0, int(y0) - 2), min(self.s, int(y1) + 3)):
            for x in range(max(0, int(x0) - 2), min(self.s, int(x1) + 3)):
                d = self._round_rect_sdf(x + 0.5, y + 0.5, cx, cy, hw, hh, rad)
                cov = clamp(0.5 - d)
                if cov <= 0:
                    continue
                self._blend(x, y, shade((x - x0) / (x1 - x0), (y - y0) / (y1 - y0)), cov)

    def rounded_rect_shadow(self, x0, y0, x1, y1, rad, spread, strength):
        """Soft dark shadow under the cabinet — sells it as a physical object."""
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        hw, hh = (x1 - x0) / 2, (y1 - y0) / 2
        for y in range(max(0, int(y0 - spread)), min(self.s, int(y1 + spread) + 1)):
            for x in range(max(0, int(x0 - spread)), min(self.s, int(x1 + spread) + 1)):
                d = self._round_rect_sdf(x + 0.5, y + 0.5, cx, cy, hw, hh, rad)
                if d <= 0 or d >= spread:
                    continue
                f = (1 - d / spread) ** 2
                i = (y * self.s + x) * 3
                for k in range(3):
                    self.buf[i + k] *= 1 - f * strength

    def socket(self, cx, cy, rad):
        """Drilled hole: dark radial plus the heavy shadow along its top edge."""
        for y in range(int(cy - rad) - 1, int(cy + rad) + 2):
            for x in range(int(cx - rad) - 1, int(cx + rad) + 2):
                dx, dy = x + 0.5 - cx, y + 0.5 - cy
                d = math.hypot(dx, dy)
                cov = clamp(rad - d + 0.5)
                if cov <= 0:
                    continue
                col = lerp(SOCKET_IN, SOCKET_OUT, clamp(d / rad / 0.72))
                # top-inner shadow, and a faint bounce off the bottom lip
                col = scale(col, 1 - 0.55 * clamp(-dy / rad))
                col = lerp(col, (0x78, 0xA0, 0xFF), clamp(dy / rad - 0.55) * 0.16)
                self._blend(x, y, col, cov)

    def token(self, cx, cy, rad, base):
        """The app's disc: flat-ish face, a concentric groove, a small raised
        centre boss and a dark rim. Matches `.disc` + its ::before/::after.

        The groove has to be a full uniform ring. An earlier version lit its top
        half and darkened its bottom half, which at icon size stopped reading as a
        ridge and started reading as a mouth — three tokens, three smiley faces.
        """
        light = lerp(base, (255, 255, 255), 0.44)
        dark = scale(base, 0.62)
        rim = scale(base, 0.30)
        for y in range(int(cy - rad) - 2, int(cy + rad) + 3):
            for x in range(int(cx - rad) - 2, int(cx + rad) + 3):
                dx, dy = x + 0.5 - cx, y + 0.5 - cy
                d = math.hypot(dx, dy)
                cov = clamp(rad - d + 0.5)
                if cov <= 0:
                    continue
                t = d / rad
                bevel = clamp((-dy / rad + 1) / 2)  # 1 at the top, 0 at the bottom
                col = lerp(base, light, bevel * 0.38)
                col = lerp(col, dark, clamp((t - 0.5) / 0.5) * 0.45)
                groove = abs(t - 0.60)
                if groove < 0.07:
                    k = 1 - groove / 0.07
                    col = lerp(col, dark, k * 0.28)          # the groove itself, all the way round
                    col = lerp(col, light, k * bevel * 0.22)  # its top lip catches the light
                if t < 0.26:
                    col = lerp(col, light, (1 - t / 0.26) * 0.26 * (0.45 + bevel * 0.55))
                if t > 0.88:
                    col = lerp(col, rim, (t - 0.88) / 0.12 * 0.9)
                self._blend(x, y, col, cov)

    def streak(self, a, b, half, color, peak):
        """The win line: a wide soft coloured glow with a thin bright core — the
        same two-layer treatment drawWinLine() paints in the game. Kept thin, or
        at icon size it stops being a line through the tokens and becomes a bar
        laid across them."""
        (ax, ay), (bx, by) = a, b
        vx, vy = bx - ax, by - ay
        vlen2 = vx * vx + vy * vy
        reach = half * 6
        for y in range(max(0, int(min(ay, by) - reach)), min(self.s, int(max(ay, by) + reach))):
            for x in range(max(0, int(min(ax, bx) - reach)), min(self.s, int(max(ax, bx) + reach))):
                t = clamp(((x - ax) * vx + (y - ay) * vy) / vlen2)
                d = math.hypot(x - (ax + vx * t), y - (ay + vy * t))
                if d < reach:
                    self.add(x, y, color, (1 - d / reach) ** 2.6 * peak)
                if d < half:
                    self._blend(x, y, (255, 250, 245), clamp(half - d + 0.5) * 0.9)

    # --- output ----------------------------------------------------------
    def write(self, path):
        s = self.s
        raw = bytearray()
        for y in range(s):
            raw.append(0)  # filter type 0
            row = self.buf[y * s * 3 : (y + 1) * s * 3]
            raw.extend(int(clamp(v, 0, 255) + 0.5) for v in row)

        def chunk(tag, data):
            return (
                struct.pack(">I", len(data))
                + tag
                + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
            )

        with open(path, "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\n")
            f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", s, s, 8, 2, 0, 0, 0)))
            f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
            f.write(chunk(b"IEND", b""))


def render(size):
    c = Canvas(size)
    c.background()

    # The cabinet. Its width is set by the maskable safe zone (a centre circle of
    # 80% diameter, so radius 40%): a corner token's centre sits boardW/3 from the
    # middle on each axis, √2·boardW/3 radially, and its own radius adds
    # 0.335·boardW/3 — total 0.583·boardW, which has to stay under 40%. Hence
    # 68.4%: any wider and a circular mask starts biting the corner discs.
    m = size * 0.158
    b0, b1 = m, size - m
    rad = size * 0.115
    c.rounded_rect_shadow(b0, b0 + size * 0.012, b1, b1 + size * 0.022, rad, size * 0.075, 0.5)

    def cabinet(u, v):
        # 160deg linear (top-left lit → bottom-right shaded), a white sheen over
        # the top quarter and a shadowed base. No hard rim line: at 40px it read
        # as a separate pale strip laid across the top rather than an edge.
        col = lerp(BOARD_HI, BOARD_LO, clamp(u * 0.30 + v * 0.90))
        col = lerp(col, (255, 255, 255), clamp(1 - v / 0.26) ** 1.6 * 0.30)
        col = scale(col, 1 - clamp((v - 0.78) / 0.22) ** 1.5 * 0.30)
        return col

    c.rounded_rect(b0, b0, b1, b1, rad, cabinet)

    board_w = b1 - b0
    cell = board_w / 3
    disc_r = cell * 0.335
    centre = lambda i: b0 + cell * (i + 0.5)

    for r in range(3):
        for col in range(3):
            c.socket(centre(col), centre(r), disc_r * 1.12)

    # The winning three are LIT rather than struck through. A drawn line, even a
    # thin one, is the loudest thing in the icon at 40px — it reads as a pen mark
    # across the artwork instead of part of it. The game pulses the winning discs
    # as well as drawing the line, so this keeps the half that survives the size:
    # a warm glow along the diagonal, under the tokens, then a halo around each.
    ends = ((centre(0), centre(0)), (centre(2), centre(2)))
    c.streak(*ends, 0, (255, 110, 74), 0.85)

    for r in range(3):
        for col in range(3):
            token = PATTERN[r][col]
            if token == "R":
                c.token(centre(col), centre(r), disc_r, RED)
            elif token == "Y":
                c.token(centre(col), centre(r), disc_r, YELLOW)

    for r in range(3):
        for col in range(3):
            if PATTERN[r][col] == "R":
                c.glow(centre(col), centre(r), disc_r * 2.1, (255, 96, 64), 0.58)
    return c


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "..", "icons")
    os.makedirs(out, exist_ok=True)
    for size, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon-180.png")]:
        render(size).write(os.path.join(out, name))
        print(f"wrote icons/{name} ({size}x{size})")


if __name__ == "__main__":
    main()
