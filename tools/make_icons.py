# -*- coding: utf-8 -*-
"""產生小柯機器人動態圖形和視覺特效工具的所有圖示：網址列小圖示、主畫面捷徑、Windows .ico、Mac/Linux 用 PNG。
造型：小柯機器人的頭是一台螢幕（天線、耳朵、笑臉），螢幕上有一條動畫曲線與關鍵影格，右上角一顆特效星芒。
執行：python tools/make_icons.py（需要 Pillow）
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
S = 1024
SS = 4


def grad(size, top, bottom):
    g = Image.new("RGB", (1, 256))
    for y in range(256):
        t = y / 255
        g.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return g.resize((size, size))


def draw_robot(d, k, cx=512, cy=470, scale=1.0, star=True):
    def P(*v):
        return [round((cx + (x - 512) * scale) * k) if i % 2 == 0 else round((cy + (x - 470) * scale) * k) for i, x in enumerate(v)]
    R = lambda r: round(r * scale * k)
    white = (255, 255, 255)
    d.rounded_rectangle(P(498, 130, 526, 230), radius=R(10), fill=white)
    d.ellipse(P(462, 70, 562, 170), fill=(255, 213, 10))
    d.rounded_rectangle(P(96, 360, 186, 600), radius=R(36), fill=white)
    d.rounded_rectangle(P(838, 360, 928, 600), radius=R(36), fill=white)
    d.polygon(P(452, 760, 572, 760, 600, 870, 424, 870), fill=white)
    d.rounded_rectangle(P(330, 852, 694, 900), radius=R(24), fill=white)
    d.rounded_rectangle(P(160, 220, 864, 770), radius=R(110), fill=white)
    d.rounded_rectangle(P(222, 282, 802, 708), radius=R(64), fill=(14, 18, 44))
    cyan = (34, 211, 238)
    d.ellipse(P(332, 380, 448, 496), fill=cyan)
    d.ellipse(P(576, 380, 692, 496), fill=cyan)
    # 笑臉＝動畫曲線，兩端是關鍵影格
    pts = []
    for i in range(41):
        t = i / 40
        pts.append((320 + t * 384, 560 + math.sin(t * math.pi) * 70))
    flat = []
    for x, y in pts:
        flat += [x, y]
    d.line(P(*flat), fill=(255, 196, 64), width=R(22), joint="curve")
    for x, y in (pts[0], pts[-1]):
        d.polygon(P(x, y - 30, x + 30, y, x, y + 30, x - 30, y), fill=(255, 255, 255))
    if star:
        sx, sy = 776, 268
        poly = []
        for i in range(8):
            r = 96 if i % 2 == 0 else 30
            a = i / 8 * math.tau - math.pi / 2
            poly += [sx + math.cos(a) * r, sy + math.sin(a) * r]
        d.polygon(P(*poly), fill=(255, 245, 160))


def make(size_px, maskable=False, rounded=True, bg=True):
    k = SS
    img = Image.new("RGBA", (S * k, S * k), (0, 0, 0, 0))
    if bg:
        g = grad(S * k, (64, 120, 255), (196, 64, 255)).convert("RGBA")
        mask = Image.new("L", (S * k, S * k), 0)
        md = ImageDraw.Draw(mask)
        if maskable or not rounded:
            md.rectangle([0, 0, S * k, S * k], fill=255)
        else:
            md.rounded_rectangle([40 * k, 40 * k, (S - 40) * k, (S - 40) * k], radius=230 * k, fill=255)
        img.paste(g, (0, 0), mask)
    d = ImageDraw.Draw(img)
    draw_robot(d, k, scale=0.78 if maskable else 1.0, cy=490 if maskable else 470)
    return img.resize((size_px, size_px), Image.LANCZOS)


def main():
    (ROOT / "icons").mkdir(exist_ok=True)
    make(512).save(ROOT / "icons" / "icon-512.png")
    make(192).save(ROOT / "icons" / "icon-192.png")
    make(512, maskable=True).save(ROOT / "icons" / "icon-maskable-512.png")
    make(1024).save(ROOT / "icons" / "icon-1024.png")
    make(180, rounded=False).convert("RGB").save(ROOT / "apple-touch-icon.png")
    make(32).save(ROOT / "favicon-32.png")
    make(16).save(ROOT / "favicon-16.png")
    big = make(256)
    big.save(ROOT / "icons" / "app.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("icons ok")


if __name__ == "__main__":
    main()
