# 裁掉无头浏览器截图底部的空白（固定视口截图必然多出空白）
# 用法: python crop-png.py <in.png> <out.png> [容差]
# 背景带网格/纹理时逐像素精确比较会失效 ⇒ 用容差 + 取最后一行众数当背景色
from PIL import Image
from collections import Counter
import sys

src, dst = sys.argv[1], sys.argv[2]
tol = int(sys.argv[3]) if len(sys.argv) > 3 else 10
im = Image.open(src).convert('RGB')
w, h = im.size
px = im.load()
bg = Counter(px[x, h - 3] for x in range(0, w, 13)).most_common(1)[0][0]


def close(c):
    return abs(c[0] - bg[0]) <= tol and abs(c[1] - bg[1]) <= tol and abs(c[2] - bg[2]) <= tol


bottom = h - 1
while bottom > 0:
    if not all(close(px[x, bottom]) for x in range(0, w, 5)):
        break
    bottom -= 1

cut = min(h, bottom + 1 + 26)
im.crop((0, 0, w, cut)).save(dst)
print(f'trimmed {w}x{h} -> {w}x{cut}')
