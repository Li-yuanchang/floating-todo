from PIL import Image, ImageDraw
import os

size = 256
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Green circle background
draw.ellipse([16, 16, size-16, size-16], fill=(76, 175, 80, 255))

# White checkmark
cx, cy = size // 2, size // 2
points = [
    (cx - 40, cy),
    (cx - 12, cy + 32),
    (cx + 48, cy - 36),
]
draw.line(points, fill=(255, 255, 255, 255), width=20, joint='curve')

out = os.path.join(os.path.dirname(__file__), 'src-tauri', 'icons', 'icon.png')
img.save(out, 'PNG')
print(f'Saved icon to {out}')
