"""Build and validate English-only Yandex Games store media."""

from __future__ import annotations

import importlib.util
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "store-assets" / "en-release"
FRAMES = OUTPUT / "capture-frames"

spec = importlib.util.spec_from_file_location("promo_builder", ROOT / "tools" / "build-promo-videos.py")
if spec is None or spec.loader is None:
    raise RuntimeError("Unable to load the existing promo builder")
promo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promo)


def run(*args: str) -> None:
    subprocess.run(args, cwd=ROOT, check=True)


def card(path: Path, size: tuple[int, int], title: str, subtitle: str) -> None:
    hero = promo.cover(Image.open(promo.HERO).convert("RGB"), size)
    hero = ImageEnhance.Contrast(hero).enhance(1.08).filter(ImageFilter.GaussianBlur(0.4))
    image = Image.alpha_composite(hero.convert("RGBA"), Image.new("RGBA", size, (1, 3, 13, 70)))
    draw = ImageDraw.Draw(image)
    landscape = size[0] > size[1]
    if landscape:
        box = (round(size[0] * 0.15), round(size[1] * 0.29), round(size[0] * 0.85), round(size[1] * 0.71))
        title_size, subtitle_size = round(size[1] * 0.12), round(size[1] * 0.045)
        title_y, subtitle_y = round(size[1] * 0.38), round(size[1] * 0.56)
    else:
        box = (round(size[0] * 0.08), round(size[1] * 0.34), round(size[0] * 0.92), round(size[1] * 0.66))
        title_size, subtitle_size = round(size[0] * 0.085), round(size[0] * 0.036)
        title_y, subtitle_y = round(size[1] * 0.42), round(size[1] * 0.54)
    draw.rounded_rectangle(box, radius=max(18, size[0] // 50), fill=(2, 5, 18, 195), outline=(42, 228, 255, 235), width=max(3, size[0] // 360))
    promo.centered_text(
        draw,
        title_y,
        title,
        ImageFont.truetype(promo.FONT_BOLD, title_size),
        (248, 252, 255, 255),
        stroke_width=max(2, size[0] // 300),
        stroke_fill=(0, 104, 137, 235),
    )
    promo.centered_text(
        draw,
        subtitle_y,
        subtitle,
        ImageFont.truetype(promo.FONT_BOLD, subtitle_size),
        (248, 211, 64, 255),
    )
    image.convert("RGB").save(path, quality=94, subsampling=0)


def upscale_mobile_screenshots() -> None:
    for stem in ("mobile-gameplay-01-campaign", "mobile-gameplay-02-vault-rush"):
        target = OUTPUT / f"{stem}.png"
        source = OUTPUT / f"{stem}-source-360x640.png"
        if not source.exists():
            image = Image.open(target).convert("RGB")
            if image.size != (360, 640):
                raise ValueError(f"Unexpected mobile capture size: {target} {image.size}")
            image.save(source)
        image = Image.open(source).convert("RGB").resize((720, 1280), Image.Resampling.LANCZOS)
        image.save(target, optimize=True)


def frame_input(prefix: str) -> str:
    return str(FRAMES / f"{prefix}-%04d.png")


def build_videos() -> tuple[Path, Path, Path]:
    landscape_intro = OUTPUT / "landscape-intro.jpg"
    landscape_outro = OUTPUT / "landscape-outro.jpg"
    vertical_intro = OUTPUT / "vertical-intro.jpg"
    vertical_outro = OUTPUT / "vertical-outro.jpg"
    card(landscape_intro, (1920, 1080), "NEON VAULTS", "THINK  •  DASH  •  ESCAPE")
    card(landscape_outro, (1920, 1080), "250 LEVELS", "DAILY  •  VAULT RUSH")
    card(vertical_intro, (1080, 1920), "NEON VAULTS", "THINK  •  DASH  •  ESCAPE")
    card(vertical_outro, (1080, 1920), "250 LEVELS", "DAILY  •  VAULT RUSH")
    audio = promo.build_audio(duration=22.0)

    horizontal = OUTPUT / "neon-vaults-horizontal-gameplay-en-1280x720.mp4"
    vertical = OUTPUT / "neon-vaults-vertical-gameplay-en-1080x1920.mp4"
    advert = OUTPUT / "neon-vaults-advert-en-1920x1080.mp4"

    horizontal_filter = (
        "[0:v]scale=1280:720,trim=duration=2,setpts=PTS-STARTPTS[intro];"
        "[1:v]fps=30,scale=1280:720,trim=duration=8,setpts=PTS-STARTPTS[campaign];"
        "[2:v]fps=30,scale=1280:720,trim=duration=6,setpts=PTS-STARTPTS[rush];"
        "[3:v]scale=1280:720,trim=duration=2,setpts=PTS-STARTPTS[outro];"
        "[intro][campaign][rush][outro]concat=n=4:v=1:a=0,format=yuv420p[v]"
    )
    run(
        str(promo.FFMPEG), "-y", "-loop", "1", "-framerate", "30", "-i", str(landscape_intro),
        "-framerate", "10", "-i", frame_input("desktop"),
        "-framerate", "10", "-i", frame_input("desktop-rush"),
        "-loop", "1", "-framerate", "30", "-i", str(landscape_outro), "-i", str(audio),
        "-filter_complex", horizontal_filter, "-map", "[v]", "-map", "4:a:0", "-t", "18", "-r", "30",
        "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", str(horizontal),
    )

    vertical_filter = (
        "[0:v]scale=1080:1920,trim=duration=2,setpts=PTS-STARTPTS[intro];"
        "[1:v]fps=30,scale=1080:1920:flags=neighbor,trim=duration=8,setpts=PTS-STARTPTS[campaign];"
        "[2:v]fps=30,scale=1080:1920:flags=neighbor,trim=duration=6,setpts=PTS-STARTPTS[rush];"
        "[3:v]scale=1080:1920,trim=duration=2,setpts=PTS-STARTPTS[outro];"
        "[intro][campaign][rush][outro]concat=n=4:v=1:a=0,format=yuv420p[v]"
    )
    run(
        str(promo.FFMPEG), "-y", "-loop", "1", "-framerate", "30", "-i", str(vertical_intro),
        "-framerate", "10", "-i", frame_input("mobile"),
        "-framerate", "10", "-i", frame_input("mobile-rush"),
        "-loop", "1", "-framerate", "30", "-i", str(vertical_outro), "-i", str(audio),
        "-filter_complex", vertical_filter, "-map", "[v]", "-map", "4:a:0", "-t", "18", "-r", "30",
        "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", str(vertical),
    )

    advert_filter = (
        "[0:v]scale=1920:1080,trim=duration=2,setpts=PTS-STARTPTS[intro];"
        "[1:v]fps=30,scale=1920:1080:flags=lanczos,trim=duration=8,setpts=PTS-STARTPTS[campaign];"
        "[2:v]fps=30,scale=1920:1080:flags=lanczos,trim=duration=6,setpts=PTS-STARTPTS[rush];"
        "[3:v]scale=1920:1080,trim=duration=3,setpts=PTS-STARTPTS[outro];"
        "[intro][campaign][rush][outro]concat=n=4:v=1:a=0,format=yuv420p[v]"
    )
    run(
        str(promo.FFMPEG), "-y", "-loop", "1", "-framerate", "30", "-i", str(landscape_intro),
        "-framerate", "10", "-i", frame_input("desktop"),
        "-framerate", "10", "-i", frame_input("desktop-rush"),
        "-loop", "1", "-framerate", "30", "-i", str(landscape_outro), "-i", str(audio),
        "-filter_complex", advert_filter, "-map", "[v]", "-map", "4:a:0", "-t", "19", "-r", "30",
        "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", str(advert),
    )
    return horizontal, vertical, advert


def main() -> None:
    required = [
        FRAMES / "desktop-0000.png",
        FRAMES / "desktop-rush-0000.png",
        FRAMES / "mobile-0000.png",
        FRAMES / "mobile-rush-0000.png",
    ]
    for path in required:
        if not path.exists():
            raise FileNotFoundError(path)
    upscale_mobile_screenshots()
    horizontal, vertical, advert = build_videos()
    report = {
        "horizontalGameplay": promo.validate(horizontal, (1280, 720)),
        "verticalGameplay": promo.validate(vertical, (1080, 1920)),
        "advertisingVideo": promo.validate(advert, (1920, 1080)),
        "screenshots": {
            path.name: list(Image.open(path).size)
            for path in sorted(OUTPUT.glob("*gameplay-*.png"))
            if "source" not in path.name
        },
    }
    report_path = OUTPUT / "validation-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
