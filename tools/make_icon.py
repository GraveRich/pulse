# Draws the Pulse app icon (black rounded tile, purple equaliser bars) -> src/pulse.ico + ui/icon.png
# Run:  python tools\make_icon.py
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def draw(size):
    ss = 4  # supersample for smooth edges
    n = size * ss
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(n * 0.23)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=r, fill=(12, 11, 17, 255))
    d.rounded_rectangle([ss, ss, n - 1 - ss, n - 1 - ss], radius=r - ss, outline=(58, 44, 84, 255), width=max(1, n // 96))

    heights = [0.30, 0.56, 0.86, 0.62, 0.38]
    top, bottom = (196, 148, 255), (124, 58, 237)
    bars = len(heights)
    area = n * 0.60
    gap = area / (bars * 1.9 - 0.9)
    bw = gap
    x0 = (n - (bars * bw + (bars - 1) * gap * 0.9)) / 2
    cy = n / 2
    grad = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for y in range(n):
        t = min(1.0, max(0.0, (y - n * 0.12) / (n * 0.76)))
        gd.line([(0, y), (n, y)], fill=lerp(top, bottom, t) + (255,))
    mask = Image.new("L", (n, n), 0)
    md = ImageDraw.Draw(mask)
    for i, h in enumerate(heights):
        x = x0 + i * (bw + gap * 0.9)
        hh = n * 0.62 * h
        md.rounded_rectangle([x, cy - hh / 2, x + bw, cy + hh / 2], radius=bw / 2, fill=255)
    img.paste(grad, (0, 0), mask)
    return img.resize((size, size), Image.LANCZOS)


big = draw(256)
big.save(os.path.join(ROOT, "src", "pulse.ico"), sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)])
draw(128).save(os.path.join(ROOT, "ui", "icon.png"))
print("icon written")
