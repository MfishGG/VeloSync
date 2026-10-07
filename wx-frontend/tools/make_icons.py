# -*- coding: utf-8 -*-
"""VeloSync 小程序图标生成器

设计语言：「速度线 + 环形同步箭头」
- 品牌图标：靛蓝渐变圆角方块 + 白色环形双向同步箭头 + 内部三条递减速度线
- tabBar 图标：线性单色图标，普通态 #94a3b8 / 选中态 #4f46e5，透明底

用法：
    python tools/make_icons.py
"""
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND_DIR = os.path.join(ROOT, "assets", "brand")
TAB_DIR = os.path.join(ROOT, "assets", "tabbar")

PRIMARY = (79, 70, 229, 255)      # #4f46e5
PRIMARY_LIGHT = (99, 102, 241, 255)  # #6366f1
PRIMARY_DEEP = (67, 56, 202, 255)    # #4338ca
MUTED = (148, 163, 184, 255)      # #94a3b8
WHITE = (255, 255, 255, 255)

SS = 4  # 超采样倍数，先大后缩，得到平滑边缘


# ---------------------------------------------------------------- 基础工具
def new_canvas(size):
    return Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))


def save(img, path, final_size):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out = img.resize((final_size, final_size), Image.LANCZOS)
    out.save(path, "PNG")
    return path


def S(size):
    """坐标归一化：0..1 → 像素（含超采样）"""
    def f(v):
        return v * size * SS
    return f


def _unit(v, angle_deg):
    return math.cos(math.radians(angle_deg)) * v, math.sin(math.radians(angle_deg)) * v


def arrow_head(draw, cx, cy, angle_deg, length, width, color):
    """在 (cx, cy) 处，沿 angle_deg 方向画一个实心箭头三角。

    angle_deg 采用 PIL 约定：0° 指向右，角度顺时针增大（因屏幕 y 轴向下）。
    """
    ux, uy = _unit(1.0, angle_deg)
    px, py = _unit(1.0, angle_deg + 90)
    tip = (cx + ux * length * 0.55, cy + uy * length * 0.55)
    back = (cx - ux * length * 0.45, cy - uy * length * 0.45)
    left = (back[0] + px * width / 2, back[1] + py * width / 2)
    right = (back[0] - px * width / 2, back[1] - py * width / 2)
    draw.polygon([tip, left, right], fill=color)


def ring_arrows(draw, size, cx, cy, radius, stroke, color, gap_deg=26):
    """环形双向同步箭头：两段圆弧，各自末端带箭头。"""
    k = S(size)
    box = [k(cx - radius), k(cy - radius), k(cx + radius), k(cy + radius)]
    stroke_px = int(k(stroke))
    r_px = k(radius)

    for start in (196, 16):
        end = start + 148
        draw.arc(box, start=start, end=end, fill=color, width=stroke_px)
        # 末端箭头：沿顺时针切向（PIL 下顺时针切线为 (-sinθ, cosθ)）
        theta = end
        rad = math.radians(theta)
        tipx = k(cx) + r_px * math.cos(rad)
        tipy = k(cy) + r_px * math.sin(rad)
        tangent = (-math.sin(rad), math.cos(rad))
        ang = math.degrees(math.atan2(tangent[1], tangent[0]))
        arrow_head(
            draw,
            tipx - tangent[0] * stroke_px * 0.5,
            tipy - tangent[1] * stroke_px * 0.5,
            ang,
            stroke_px * 2.35,
            stroke_px * 2.6,
            color,
        )


def speed_lines(draw, size, cx, cy, widths, thickness, gap, color, align="left"):
    """速度线：多条长度递减的圆头横线，右端对齐产生「加速」错觉。"""
    k = S(size)
    n = len(widths)
    total = thickness * (n - 1) * 0 + gap * (n - 1)
    y0 = cy - total / 2
    for i, w in enumerate(widths):
        y = k(y0 + gap * i)
        if align == "left":
            x1 = k(cx - max(widths) / 2)
        else:
            x1 = k(cx + max(widths) / 2 - w)
        x2 = x1 + k(w)
        draw.line([x1, y, x2, y], fill=color, width=int(k(thickness)), joint="curve")
        r = k(thickness) / 2
        draw.ellipse([x1 - r, y - r, x1 + r, y + r], fill=color)
        draw.ellipse([x2 - r, y - r, x2 + r, y + r], fill=color)


def diagonal_gradient(size, c1, c2):
    """低分辨率逐像素算对角渐变，再放大，避免条带。"""
    low = 64
    img = Image.new("RGB", (low, low))
    px = img.load()
    for y in range(low):
        for x in range(low):
            t = (x + y) / (2 * (low - 1))
            px[x, y] = tuple(
                int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)
            )
    return img.resize((size * SS, size * SS), Image.BICUBIC)


# ---------------------------------------------------------------- 品牌图标
def make_brand(size=512):
    canvas = new_canvas(size)
    k = S(size)

    # 圆角方块底 + 对角渐变
    grad = diagonal_gradient(size, (129, 140, 248), (67, 56, 202)).convert("RGBA")
    mask = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size * SS - 1, size * SS - 1], radius=int(k(0.225)), fill=255
    )
    canvas.paste(grad, (0, 0), mask)

    draw = ImageDraw.Draw(canvas)
    # 环形同步箭头
    ring_arrows(draw, size, 0.5, 0.5, 0.325, 0.062, WHITE)
    # 内部速度线（长度递减，左对齐）
    speed_lines(
        draw,
        size,
        0.5,
        0.5,
        widths=[0.245, 0.165, 0.085],
        thickness=0.052,
        gap=0.086,
        color=WHITE,
        align="left",
    )
    return canvas


# ---------------------------------------------------------------- tabBar 图标
def icon_dashboard(size, color):
    """仪表盘：速度表弧 + 指针"""
    canvas = new_canvas(size)
    draw = ImageDraw.Draw(canvas)
    k = S(size)
    cx = cy = 0.5
    r = 0.33
    box = [k(cx - r), k(cy - r), k(cx + r), k(cy + r)]
    w = int(k(0.085))
    # 上部弧（160° → 380°，即经过左侧、顶部、右侧）
    draw.arc(box, start=158, end=382, fill=color, width=w)
    # 指针：指向右上
    ang = -48
    ux, uy = _unit(1.0, ang)
    draw.line(
        [k(cx), k(cy), k(cx + ux * r * 0.82), k(cy + uy * r * 0.82)],
        fill=color,
        width=int(k(0.085)),
    )
    # 中心圆点
    rr = k(0.062)
    draw.ellipse([k(cx) - rr, k(cy + r * 0.18) - rr, k(cx) + rr, k(cy + r * 0.18) + rr], fill=color)
    # 底部刻度两点
    for dx in (-0.28, 0.28):
        rr2 = k(0.045)
        px, py = k(cx + dx), k(cy + r * 0.72)
        draw.ellipse([px - rr2, py - rr2, px + rr2, py + rr2], fill=color)
    return canvas


def icon_sync(size, color):
    """同步任务：环形双向箭头（与品牌图标同源的简化版）"""
    canvas = new_canvas(size)
    draw = ImageDraw.Draw(canvas)
    ring_arrows(draw, size, 0.5, 0.5, 0.33, 0.078, color)
    return canvas


def icon_matrix(size, color):
    """矩阵：3×3 宫格，两个角填充"""
    canvas = new_canvas(size)
    draw = ImageDraw.Draw(canvas)
    k = S(size)
    cell = 0.215
    gap = 0.068
    total = cell * 3 + gap * 2
    x0 = 0.5 - total / 2
    y0 = 0.5 - total / 2
    w = int(k(0.058))
    for r in range(3):
        for c in range(3):
            x = x0 + c * (cell + gap)
            y = y0 + r * (cell + gap)
            box = [k(x), k(y), k(x + cell), k(y + cell)]
            filled = (r, c) in ((0, 0), (1, 1), (2, 2))
            if filled:
                draw.rounded_rectangle(box, radius=int(k(0.052)), fill=color)
            else:
                draw.rounded_rectangle(box, radius=int(k(0.052)), outline=color, width=w)
    return canvas


def icon_fit(size, color):
    """FIT：曲线图外框 + 折线 + 末端点"""
    canvas = new_canvas(size)
    draw = ImageDraw.Draw(canvas)
    k = S(size)
    w = int(k(0.072))
    box = [k(0.11), k(0.14), k(0.89), k(0.86)]
    draw.rounded_rectangle(box, radius=int(k(0.17)), outline=color, width=w)
    # 内部折线
    pts = [
        (0.27, 0.62),
        (0.40, 0.44),
        (0.52, 0.56),
        (0.66, 0.33),
        (0.79, 0.46),
    ]
    draw.line([(k(x), k(y)) for x, y in pts], fill=color, width=int(k(0.068)), joint="curve")
    for x, y in pts:
        r = k(0.068) / 2
        draw.ellipse([k(x) - r, k(y) - r, k(x) + r, k(y) + r], fill=color)
    return canvas


def icon_mine(size, color):
    """我的：头 + 肩"""
    canvas = new_canvas(size)
    draw = ImageDraw.Draw(canvas)
    k = S(size)
    w = int(k(0.078))
    # 头
    hr = 0.155
    hx, hy = 0.5, 0.31
    draw.ellipse(
        [k(hx - hr), k(hy - hr), k(hx + hr), k(hy + hr)], outline=color, width=w
    )
    # 肩（半圆弧）
    box = [k(0.17), k(0.49), k(0.83), k(1.05)]
    draw.arc(box, start=182, end=358, fill=color, width=w)
    return canvas


TAB_ICONS = {
    "dashboard": icon_dashboard,
    "sync": icon_sync,
    "matrix": icon_matrix,
    "fit": icon_fit,
    "mine": icon_mine,
}


def main():
    os.makedirs(BRAND_DIR, exist_ok=True)
    os.makedirs(TAB_DIR, exist_ok=True)

    # 品牌图标（多尺寸）；120 是 iGPSPORT 开放平台申请要求的规格
    brand = make_brand(512)
    for s in (512, 144, 120, 96):
        p = save(brand, os.path.join(BRAND_DIR, f"logo-{s}.png"), s)
        print("brand :", os.path.relpath(p, ROOT), f"{s}x{s}")

    # tabBar 图标（微信推荐 81x81）
    for name, fn in TAB_ICONS.items():
        normal = fn(81, MUTED)
        active = fn(81, PRIMARY)
        p1 = save(normal, os.path.join(TAB_DIR, f"{name}.png"), 81)
        p2 = save(active, os.path.join(TAB_DIR, f"{name}-on.png"), 81)
        print("tabbar:", os.path.relpath(p1, ROOT), "|", os.path.relpath(p2, ROOT))

    print("\n完成：品牌图标 4 个，tabBar 图标 10 个。")


if __name__ == "__main__":
    main()
