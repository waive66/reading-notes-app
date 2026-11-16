# -*- coding: utf-8 -*-
"""生成「心笺」桌面图标：自适应图标前景/背景 + 各密度传统图标 + 单色图标。"""
import math, os
from PIL import Image, ImageDraw, ImageFilter

RES = r"D:\心得笔记开发过程\reading-notes-app\android-for-apk\app\src\main\res"
S = 1024  # 主画布

CREAM_TOP = (255, 249, 240)
CREAM_BOT = (246, 226, 198)
COVER = (214, 148, 110)
COVER_DARK = (188, 122, 86)
PAGE = (255, 250, 242)
PAGE_LINE = (231, 214, 192)
HEART = (226, 140, 126)
GOLD = (232, 190, 120)
INK = (110, 78, 56)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def bg_layer(size=S, radial=True):
    img = Image.new("RGB", (size, size), CREAM_TOP)
    d = ImageDraw.Draw(img)
    if radial:
        cx, cy = size * 0.5, size * 0.28
        maxr = size * 0.95
        for i in range(int(maxr), 0, -3):
            t = i / maxr
            col = lerp(CREAM_TOP, CREAM_BOT, t ** 0.85)
            d.ellipse([cx - i, cy - i, cx + i, cy + i], fill=col)
    else:
        for y in range(size):
            d.line([(0, y), (size, y)], fill=lerp(CREAM_TOP, CREAM_BOT, y / size))
    return img


def heart_path(d, cx, cy, w, h, color):
    """用两段贝塞尔近似的多边形画心形"""
    pts = []
    for i in range(120):
        t = i / 120 * 2 * math.pi
        x = 16 * math.sin(t) ** 3
        y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
        pts.append((cx + x * w / 32.0, cy + y * h / 32.0))
    d.polygon(pts, fill=color)


def sparkle(d, cx, cy, r, color):
    pts = []
    for i in range(4):
        ang = math.pi / 2 * i
        pts.append((cx + math.cos(ang) * r, cy + math.sin(ang) * r))
        ang2 = ang + math.pi / 4
        pts.append((cx + math.cos(ang2) * r * 0.28, cy + math.sin(ang2) * r * 0.28))
    d.polygon(pts, fill=color)


def draw_book(img, cx, cy, w, h, scale=1.0, mono=False, mono_color=(255, 255, 255)):
    """打开的书：左右两页 + 书脊 + 爱心 + 光点"""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    s = scale

    cover_col = mono_color if mono else COVER
    page_col = mono_color if mono else PAGE
    line_col = None if mono else PAGE_LINE
    heart_col = mono_color if mono else HEART
    gold_col = mono_color if mono else GOLD

    # 阴影
    if not mono:
        sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse(
            [cx - w * 0.52, cy + h * 0.34, cx + w * 0.52, cy + h * 0.56],
            fill=(120, 84, 58, 46))
        img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(28)))

    # 书本底部（封面）
    d.rounded_rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2 + h * 0.06],
                        radius=int(w * 0.10), fill=cover_col)

    # 左右页（微微向上打开）
    pad = w * 0.045
    top_gap = h * 0.06
    mid_x = cx

    left = [
        (cx - w / 2 + pad, cy - h / 2 + top_gap),
        (mid_x - w * 0.012, cy - h / 2 + top_gap + h * 0.02),
        (mid_x - w * 0.012, cy + h / 2 - h * 0.02),
        (cx - w / 2 + pad, cy + h / 2 - h * 0.01),
    ]
    right = [
        (mid_x + w * 0.012, cy - h / 2 + top_gap + h * 0.02),
        (cx + w / 2 - pad, cy - h / 2 + top_gap),
        (cx + w / 2 - pad, cy + h / 2 - h * 0.01),
        (mid_x + w * 0.012, cy + h / 2 - h * 0.02),
    ]
    d.polygon(left, fill=page_col)
    d.polygon(right, fill=page_col)

    # 书脊
    d.rectangle([mid_x - w * 0.018, cy - h / 2 + top_gap + h * 0.02,
                 mid_x + w * 0.018, cy + h / 2 - h * 0.02], fill=cover_col if not mono else mono_color)

    # 页面横线
    if line_col:
        for k in range(3):
            yy = cy - h * 0.12 + k * h * 0.14
            d.line([(cx - w / 2 + pad * 2.2, yy), (mid_x - w * 0.08, yy)], fill=line_col, width=int(w * 0.012))
            d.line([(mid_x + w * 0.08, yy), (cx + w / 2 - pad * 2.2, yy)], fill=line_col, width=int(w * 0.012))

    # 爱心（右页）
    heart_path(d, cx + w * 0.20, cy - h * 0.10, w * 0.10 * s, h * 0.10 * s, heart_col)

    # 光点
    if not mono:
        sparkle(d, cx - w * 0.26, cy - h * 0.24, w * 0.045, gold_col)
        sparkle(d, cx + w * 0.30, cy + h * 0.16, w * 0.030, gold_col)

    img.alpha_composite(layer)


def make_foreground(size=432, mono=False):
    """自适应图标前景：内容控制在中间 66% 安全区内"""
    big = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    # 前景整体缩到 S 的 66%（108dp 里的 72dp 安全区）
    draw_book(big, S / 2, S / 2 + S * 0.01, S * 0.52, S * 0.44, 1.0, mono=mono)
    return big.resize((size, size), Image.LANCZOS)


def make_legacy(size, round_icon=False, mono=False):
    canvas = bg_layer(S).convert("RGBA")
    if not mono:
        draw_book(canvas, S / 2, S / 2 + S * 0.01, S * 0.52, S * 0.44, 1.0)
    else:
        draw_book(canvas, S / 2, S / 2 + S * 0.01, S * 0.52, S * 0.44, 1.0, mono=True, mono_color=(255, 255, 255))
    if round_icon:
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, S - 1, S - 1], fill=255)
        out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        out.paste(canvas, (0, 0), mask)
        canvas = out
    return canvas.resize((size, size), Image.LANCZOS)


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)


DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FG_SIZES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

# 1) 传统图标（< Android 8）
for name, px in DENSITIES.items():
    save(make_legacy(px, False), os.path.join(RES, f"mipmap-{name}", "ic_launcher.png"))
    save(make_legacy(px, True), os.path.join(RES, f"mipmap-{name}", "ic_launcher_round.png"))

# 2) 自适应图标前景（Android 8+）
for name, px in FG_SIZES.items():
    save(make_foreground(px), os.path.join(RES, f"mipmap-{name}", "ic_launcher_foreground.png"))

# 3) 单色图标（Android 13+ 主题图标）
for name, px in FG_SIZES.items():
    save(make_foreground(px, mono=True), os.path.join(RES, f"mipmap-{name}", "ic_launcher_monochrome.png"))

# 4) 背景层（用于自适应图标背景，纯色 + 渐变各存一份）
save(bg_layer(432), os.path.join(RES, "mipmap-xxxhdpi", "ic_launcher_bg.png"))

# 5) 预览图（给交付说明用）
prev = Image.new("RGB", (3 * 340 + 80, 380), (250, 246, 240))
sq = make_legacy(340, False).convert("RGBA")
rd = make_legacy(340, True).convert("RGBA")
prev.paste(sq, (20, 20), sq)
prev.paste(rd, (380, 20), rd)
fg = make_foreground(340).convert("RGBA")
prev.paste(fg, (740, 20), fg)
out_dir = r"D:\心得笔记开发过程\reading-notes-app\docs"
os.makedirs(out_dir, exist_ok=True)
prev.save(os.path.join(out_dir, "icon-preview.png"))

print("icons generated")
