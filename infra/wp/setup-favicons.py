#!/usr/bin/env python3
"""
Generate and upload favicons for each WordPress site.
Requires PIL/Pillow for image generation and requests for WordPress API.
"""
import io
import os
import subprocess
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow required. Installing...")
    subprocess.run(["pip", "install", "-q", "Pillow"], check=True)
    from PIL import Image

# Brand colors from sites.yaml
BRANDS = {
    "JUNKIES": {"color": "#e6dcc8", "name": "Marketing Junkies"},
    "CRAZY": {"color": "#ff3366", "name": "Crazy4 Marketing"},
    "MENTALIST": {"color": "#0a0908", "name": "Marketing Mentalist"},
}


def hex_to_rgb(hex_color):
    """Convert hex color to RGB tuple."""
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))


def create_favicon(color_hex: str, size: int = 32) -> io.BytesIO:
    """Create a simple solid-color favicon PNG."""
    rgb = hex_to_rgb(color_hex)
    img = Image.new("RGB", (size, size), rgb)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def generate_favicons():
    """Generate favicon files for each site."""
    brand_dir = Path(__file__).parent.parent.parent / "autopub" / "config" / "brand"
    brand_dir.mkdir(parents=True, exist_ok=True)

    for key, info in BRANDS.items():
        favicon = create_favicon(info["color"])
        output_path = brand_dir / f"favicon-{key.lower()}.png"
        output_path.write_bytes(favicon.getvalue())
        print(f"Generated {output_path}")


if __name__ == "__main__":
    generate_favicons()
    print("✓ Favicons generated. Upload to each site via WordPress admin → Appearance → Customize → Site Identity → Site Icon")
