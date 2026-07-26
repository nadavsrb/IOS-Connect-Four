#!/usr/bin/env python3
"""Generate the app icons with the Python standard library only (no Pillow).

Draws the app's Classic theme — the default one — as a real Connect Four
position: a glossy moulded-plastic blue cabinet, drilled navy sockets, and
red/yellow tokens with the same concentric groove and centre boss the live discs
have (see `.disc` in styles.css). Red has just completed a diagonal FOUR IN A ROW
and those four are lit warm, the way the game pulses a winning line.

The position is legal, not decorative: gravity holds (no disc floats above an
empty socket) and the counts alternate — five reds to four yellows, so red moved
last and won with the disc it just dropped. A Connect Four player reading the
icon closely finds a real board, not a pattern.

Two layouts, because one file can't satisfy both consumers:

  * default — the board IS the icon. It fills the canvas edge to edge with no
    field around it, and everything outside its rounded corners is transparent.
    The radius is kept at or under iOS's own squircle (~22.4%), so those
    transparent corners are always inside what the platform masks away and no
    background is ever visible. This is what iOS uses (apple-touch-icon) and what
    the manifest declares `purpose: "any"`.

  * maskable — a maskable icon may not have transparency and must keep its
    content inside a centre circle of 80% diameter. A 4x4 grid only fits that
    circle at 64.5% of the icon width (a corner token's furthest point sits
    0.620 x gridW from the middle), which is far too small to also fill the
    canvas. So this one keeps the Classic page backdrop behind an inset board.

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

# A legal position, row 0 at the TOP. R = red, Y = yellow, . = empty socket.
# Red's four run top-left to bottom-right — the direction the eye reads and the
# cabinet is lit from, so the winning line and the highlight reinforce each other.
# Every filled cell has support beneath it, and 5 R to 4 Y means red moved last.
PATTERN = [
    ["R", ".", ".", "."],
    ["Y", "R", ".", "."],
    ["Y", "Y", "R", "."],
    ["R", "Y", "Y", "R"],
]
WIN = [(0, 0), (1, 1), (2, 2), (3, 3)]  # the four to light
N = len(PATTERN)

# iOS masks home-screen icons with a squircle of roughly this radius. Staying at
# or under it means the transparent corners can never show.
IOS_MASK_RADIUS = 0.224


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def lerp(a, b, t):
    t = clamp(t)
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def scale(c, f):
    return tuple(v * f for v in c)


class Canvas:
    """Float RGB buffer plus an alpha plane. Alpha starts fully opaque and is
    only ever narrowed by mask_rounded(), so the opaque layouts never think
    about it."""

    def __init__(self, size):
        self.s = size
        self.buf = [0.0] * (size * size * 3)
        self.alpha = [255.0] * (size * size)

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
        """Additive light, for glows. Keep `amount` low: this saturates fast over
        the cabinet blue, and once a channel pins at 255 the warm glow turns into
        a white blowout — at 0.95 the centre of the board measured (255,226,245),
        i.e. the winning line had bleached a hole through the artwork."""
        if amount <= 0 or x < 0 or y < 0 or x >= self.s or y >= self.s:
            return
        i = (y * self.s + x) * 3
        b = self.buf
        for k in range(3):
            b[i + k] = min(255.0, b[i + k] + color[k] * amount)

    # --- fills ------------------------------------------------------------
    def fill(self, shade):
        """Paint every pixel, corners included. The full-bleed layout relies on
        this: the cabinet colour has to exist under the masked-away corners too,
        or scaling the icon down drags transparent black into its edges."""
        s = self.s
        for y in range(s):
            for x in range(s):
                self._blend(x, y, shade(x / (s - 1), y / (s - 1)), 1)

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
                self.add(x, y, color, (1 - d) ** 2.2 * peak)

    # --- shapes -----------------------------------------------------------
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

    def mask_rounded(self, x0, y0, x1, y1, rad):
        """Narrow alpha to a rounded rect — the icon's silhouette becomes the
        board itself, with nothing behind it."""
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        hw, hh = (x1 - x0) / 2, (y1 - y0) / 2
        for y in range(self.s):
            for x in range(self.s):
                d = self._round_rect_sdf(x + 0.5, y + 0.5, cx, cy, hw, hh, rad)
                self.alpha[y * self.s + x] = clamp(0.5 - d) * 255.0

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
                col = scale(col, 1 - 0.55 * clamp(-dy / rad))          # top-inner shadow
                col = lerp(col, (0x78, 0xA0, 0xFF), clamp(dy / rad - 0.55) * 0.16)  # bottom lip bounce
                self._blend(x, y, col, cov)

    def token(self, cx, cy, rad, base):
        """The app's disc: flat-ish face, a concentric groove, a small raised
        centre boss and a dark rim. Matches `.disc` + its ::before/::after.

        The groove has to be a full uniform ring. An earlier version lit its top
        half and darkened its bottom half, which at icon size stopped reading as a
        ridge and started reading as a mouth — one smiley face per token.
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
                    col = lerp(col, dark, k * 0.28)           # the groove, all the way round
                    col = lerp(col, light, k * bevel * 0.22)  # its top lip catches the light
                if t < 0.26:
                    col = lerp(col, light, (1 - t / 0.26) * 0.26 * (0.45 + bevel * 0.55))
                if t > 0.88:
                    col = lerp(col, rim, (t - 0.88) / 0.12 * 0.9)
                self._blend(x, y, col, cov)

    def streak(self, a, b, color, peak):
        """A soft warm glow along the winning line, under the tokens. The game
        draws an actual line too, but at icon size a drawn line — even a thin one
        — is the loudest thing there and reads as a pen mark across the artwork
        rather than part of it. Only the light survives the size."""
        (ax, ay), (bx, by) = a, b
        vx, vy = bx - ax, by - ay
        vlen2 = vx * vx + vy * vy
        reach = self.s * 0.075
        for y in range(max(0, int(min(ay, by) - reach)), min(self.s, int(max(ay, by) + reach))):
            for x in range(max(0, int(min(ax, bx) - reach)), min(self.s, int(max(ax, bx) + reach))):
                t = clamp(((x - ax) * vx + (y - ay) * vy) / vlen2)
                d = math.hypot(x - (ax + vx * t), y - (ay + vy * t))
                if d < reach:
                    self.add(x, y, color, (1 - d / reach) ** 2.6 * peak)

    # --- output -----------------------------------------------------------
    def write(self, path, with_alpha):
        s = self.s
        raw = bytearray()
        for y in range(s):
            raw.append(0)  # filter type 0
            for x in range(s):
                i = (y * s + x) * 3
                raw.extend(int(clamp(v, 0, 255) + 0.5) for v in self.buf[i : i + 3])
                if with_alpha:
                    raw.append(int(clamp(self.alpha[y * s + x], 0, 255) + 0.5))

        def chunk(tag, data):
            return (
                struct.pack(">I", len(data))
                + tag
                + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
            )

        with open(path, "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\n")
            f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", s, s, 8, 6 if with_alpha else 2, 0, 0, 0)))
            f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
            f.write(chunk(b"IEND", b""))


def cabinet(u, v):
    """160deg linear (top-left lit → bottom-right shaded), a white sheen over the
    top quarter and a shadowed base. No hard rim line: at 40px it read as a pale
    strip laid across the top rather than an edge."""
    col = lerp(BOARD_HI, BOARD_LO, clamp(u * 0.30 + v * 0.90))
    col = lerp(col, (255, 255, 255), clamp(1 - v / 0.26) ** 1.6 * 0.30)
    return scale(col, 1 - clamp((v - 0.78) / 0.22) ** 1.5 * 0.30)


def render(size, full_bleed=True):
    c = Canvas(size)

    if full_bleed:
        # No field: the cabinet IS the icon. Painted over every pixel so the
        # colour exists under the corners the mask removes, then masked.
        b0, b1 = 0.0, float(size)
        rad = size * IOS_MASK_RADIUS
        inset = size * 0.085
        c.fill(cabinet)
    else:
        c.background()
        m = size * 0.10
        b0, b1 = m, size - m
        rad = size * 0.115
        # gridW lands at 64% of the icon, inside the 80% maskable safe circle.
        inset = size * 0.08
        c.rounded_rect_shadow(b0, b0 + size * 0.012, b1, b1 + size * 0.022, rad, size * 0.075, 0.5)
        c.rounded_rect(b0, b0, b1, b1, rad, cabinet)

    g0 = b0 + inset
    grid_w = (b1 - b0) - 2 * inset
    cell = grid_w / N
    disc_r = cell * 0.36
    centre = lambda i: g0 + cell * (i + 0.5)

    for r in range(N):
        for col in range(N):
            c.socket(centre(col), centre(r), disc_r * 1.12)

    c.streak((centre(WIN[0][1]), centre(WIN[0][0])),
             (centre(WIN[-1][1]), centre(WIN[-1][0])), (255, 138, 56), 0.34)

    for r in range(N):
        for col in range(N):
            token = PATTERN[r][col]
            if token == "R":
                c.token(centre(col), centre(r), disc_r, RED)
            elif token == "Y":
                c.token(centre(col), centre(r), disc_r, YELLOW)

    for r, col in WIN:
        c.glow(centre(col), centre(r), disc_r * 2.1, (255, 120, 52), 0.34)

    if full_bleed:
        c.mask_rounded(b0, b0, b1, b1, rad)
    return c


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "..", "icons")
    os.makedirs(out, exist_ok=True)
    jobs = [
        (192, "icon-192.png", True),
        (512, "icon-512.png", True),
        (180, "apple-touch-icon-180.png", True),
        (512, "icon-maskable-512.png", False),
    ]
    for size, name, full_bleed in jobs:
        render(size, full_bleed).write(os.path.join(out, name), with_alpha=full_bleed)
        print(f"wrote icons/{name} ({size}x{size}, {'board only' if full_bleed else 'maskable'})")


if __name__ == "__main__":
    main()
