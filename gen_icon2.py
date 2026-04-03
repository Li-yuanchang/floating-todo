from PIL import Image, ImageDraw
import os

# Draw at 8x then downscale for anti-aliasing
scale = 8
size = 256 * scale
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

s = scale
cx, cy = size // 2, size // 2
pad = 20 * s

# Rounded rectangle background - green gradient effect via solid
bg_color = (76, 175, 80, 255)
r = 48 * s  # corner radius
draw.rounded_rectangle([pad, pad, size - pad, size - pad], radius=r, fill=bg_color)

# White clipboard body
clip_pad_x = 60 * s
clip_pad_top = 55 * s
clip_pad_bot = 40 * s
clip_r = 16 * s
draw.rounded_rectangle(
    [clip_pad_x, clip_pad_top, size - clip_pad_x, size - clip_pad_bot],
    radius=clip_r, fill=(255, 255, 255, 240)
)

# Clipboard clip at top
clip_w = 50 * s
clip_h = 18 * s
clip_r2 = 8 * s
draw.rounded_rectangle(
    [cx - clip_w, clip_pad_top - clip_h // 2, cx + clip_w, clip_pad_top + clip_h // 2 + 4 * s],
    radius=clip_r2, fill=(255, 255, 255, 240)
)
# Inner clip
inner_w = 30 * s
inner_h = 10 * s
draw.rounded_rectangle(
    [cx - inner_w, clip_pad_top - inner_h // 2, cx + inner_w, clip_pad_top + inner_h // 2],
    radius=6 * s, fill=bg_color
)

# Checkmark lines on clipboard
line_color = (76, 175, 80, 255)
line_gray = (180, 180, 180, 255)
lw = 6 * s

y_start = 100 * s
line_spacing = 40 * s
check_left = 80 * s
check_size = 14 * s
text_left = 110 * s
text_right = 185 * s

for i in range(3):
    y = y_start + i * line_spacing
    if i < 2:
        # Checkmark
        pts = [
            (check_left, y + check_size // 2),
            (check_left + check_size // 2, y + check_size),
            (check_left + check_size + 4 * s, y - 2 * s),
        ]
        draw.line(pts, fill=line_color, width=lw, joint='curve')
        # Line (completed - gray)
        draw.rounded_rectangle(
            [text_left, y + check_size // 2 - 3 * s, text_right, y + check_size // 2 + 3 * s],
            radius=3 * s, fill=line_gray
        )
    else:
        # Empty checkbox
        box_pad = 2 * s
        draw.rounded_rectangle(
            [check_left - box_pad, y - box_pad, check_left + check_size + box_pad, y + check_size + box_pad],
            radius=4 * s, outline=line_color, width=lw
        )
        # Active line (green)
        draw.rounded_rectangle(
            [text_left, y + check_size // 2 - 3 * s, text_right - 20 * s, y + check_size // 2 + 3 * s],
            radius=3 * s, fill=line_color
        )

# Downscale with anti-aliasing
img = img.resize((256, 256), Image.LANCZOS)

out = os.path.join(os.path.dirname(__file__), 'src-tauri', 'icons', 'icon.png')
img.save(out, 'PNG')
print(f'Saved {out}')

# Also save a 32x32 tray icon version
tray = img.resize((32, 32), Image.LANCZOS)
tray_path = os.path.join(os.path.dirname(__file__), 'src-tauri', 'icons', 'tray-icon.png')
tray.save(tray_path, 'PNG')
print(f'Saved {tray_path}')
