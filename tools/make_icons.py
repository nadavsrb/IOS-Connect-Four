#!/usr/bin/env python3
"""Generate the app icons with the Python standard library only (no Pillow).

Draws a neon Connect Four tile: dark gradient background, a rounded purple board,
and a 3x3 grid of glowing pink/cyan discs. Outputs PNGs into ../icons/.

Run: python3 tools/make_icons.py
"""
import os
import struct
import zlib

PINK = (255, 61, 127)
CYAN = (61, 215, 255)
BG_TOP = (18, 18, 46)
BG_BOT = (6, 6, 15)
BOARD = (52, 38, 130)
SOCKET = (10, 11, 30)

# 3x3 layout: P = pink disc, C = cyan disc, 0 = empty socket
PATTERN = [
    ["P", "0", "C"],
    ["0", "P", "0"],
    ["C", "0", "P"],
]


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def darker(c, f=0.55):
    return tuple(int(round(v * f)) for v in c)


class Canvas:
    def __init__(self, size):
        self.s = size
        self.buf = bytearray(size * size * 4)

    def px(self, x, y, color, cov):
        if cov <= 0:
            return
        x = int(x)
        y = int(y)
        if x < 0 or y < 0 or x >= self.s or y >= self.s:
            return
        i = (y * self.s + x) * 4
        b = self.buf
        if cov >= 1:
            b[i], b[i + 1], b[i + 2], b[i + 3] = color[0], color[1], color[2], 255
        else:
            inv = 1 - cov
            b[i] = int(color[0] * cov + b[i] * inv)
            b[i + 1] = int(color[1] * cov + b[i + 1] * inv)
            b[i + 2] = int(color[2] * cov + b[i + 2] * inv)
            b[i + 3] = 255

    def background(self):
        for y in range(self.s):
            col = lerp(BG_TOP, BG_BOT, y / (self.s - 1))
            for x in range(self.s):
                self.px(x, y, col, 1)

    def rounded_rect(self, x0, y0, x1, y1, rad, color):
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        hw, hh = (x1 - x0) / 2, (y1 - y0) / 2
        for y in range(int(y0) - 1, int(y1) + 2):
            for x in range(int(x0) - 1, int(x1) + 2):
                qx = abs(x - cx) - (hw - rad)
                qy = abs(y - cy) - (hh - rad)
                mx, my = max(qx, 0.0), max(qy, 0.0)
                dist = (mx * mx + my * my) ** 0.5 + min(max(qx, qy), 0.0) - rad
                self.px(x, y, color, clamp(0.5 - dist))

    def circle(self, cx, cy, rad, color):
        for y in range(int(cy - rad) - 1, int(cy + rad) + 2):
            for x in range(int(cx - rad) - 1, int(cx + rad) + 2):
                d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                self.px(x, y, color, clamp(rad - d + 0.5))

    def disc(self, cx, cy, rad, base):
        # glossy disc: bright highlight toward the top-left, darker rim.
        lx, ly = cx - rad * 0.34, cy - rad * 0.34
        for y in range(int(cy - rad) - 1, int(cy + rad) + 2):
            for x in range(int(cx - rad) - 1, int(cx + rad) + 2):
                d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                cov = clamp(rad - d + 0.5)
                if cov <= 0:
                    continue
                hd = ((x - lx) ** 2 + (y - ly) ** 2) ** 0.5
                shade = clamp(1 - hd / (rad * 1.7))
                col = lerp(base, (255, 255, 255), shade * 0.55)
                edge = clamp(d / rad)
                col = lerp(col, darker(base), edge * 0.35)
                self.px(x, y, col, cov)

    def write(self, path):
        s = self.s

        def chunk(tag, data):
            return (
                struct.pack(">I", len(data))
                + tag
                + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
            )

        ihdr = struct.pack(">IIBBBBB", s, s, 8, 6, 0, 0, 0)
        raw = bytearray()
        stride = s * 4
        for y in range(s):
            raw.append(0)
            raw.extend(self.buf[y * stride : (y + 1) * stride])
        idat = zlib.compress(bytes(raw), 9)
        with open(path, "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\n")
            f.write(chunk(b"IHDR", ihdr))
            f.write(chunk(b"IDAT", idat))
            f.write(chunk(b"IEND", b""))


def render(size):
    c = Canvas(size)
    c.background()
    # Board sits inside the maskable safe zone (~15% margin).
    m = size * 0.155
    b0, b1 = m, size - m
    c.rounded_rect(b0, b1 * 0 + b0, b1, b1, size * 0.11, BOARD)  # square board
    board_w = b1 - b0
    cell = board_w / 3
    disc_r = cell * 0.33
    for r in range(3):
        for col in range(3):
            ccx = b0 + cell * (col + 0.5)
            ccy = b0 + cell * (r + 0.5)
            c.circle(ccx, ccy, disc_r * 1.02, SOCKET)  # socket first
            token = PATTERN[r][col]
            if token == "P":
                c.disc(ccx, ccy, disc_r, PINK)
            elif token == "C":
                c.disc(ccx, ccy, disc_r, CYAN)
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
