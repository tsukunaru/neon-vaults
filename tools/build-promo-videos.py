"""Build validated Yandex Games gameplay and advertising videos.

Reuses the approved gameplay capture and existing Neon Vaults artwork. The only
external executable is an already installed FFmpeg; the shipped game has no new
runtime dependency.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "store-assets"
OUTPUT = ASSETS / "promo-videos"
SOURCE_VIDEO = ASSETS / "gameplay-trailer-1280x720.mp4"
HERO = ROOT / "assets" / "ui" / "hero.webp"
FONT_BOLD = Path(r"C:\Windows\Fonts\arialbd.ttf")
FONT_REGULAR = Path(r"C:\Windows\Fonts\arial.ttf")
# Set FFMPEG or FFPROBE to an absolute path to override PATH discovery.
FFMPEG = Path(os.getenv("FFMPEG") or shutil.which("ffmpeg") or "ffmpeg")
FFPROBE = Path(os.getenv("FFPROBE") or shutil.which("ffprobe") or "ffprobe")


def run(*args: str) -> None:
    subprocess.run(args, cwd=ROOT, check=True)


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    ratio = max(size[0] / image.width, size[1] / image.height)
    resized = image.resize(
        (round(image.width * ratio), round(image.height * ratio)), Image.Resampling.LANCZOS
    )
    left = (resized.width - size[0]) // 2
    top = (resized.height - size[1]) // 2
    return resized.crop((left, top, left + size[0], top + size[1]))


def centered_text(
    draw: ImageDraw.ImageDraw,
    y: int,
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, ...],
    *,
    stroke_width: int = 0,
    stroke_fill: tuple[int, ...] | None = None,
) -> None:
    box = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_width)
    draw.text(
        ((draw._image.width - (box[2] - box[0])) // 2, y),
        text,
        font=font,
        fill=fill,
        stroke_width=stroke_width,
        stroke_fill=stroke_fill,
    )


def build_vertical_art() -> Path:
    background_path = OUTPUT / "vertical-background-1080x1920.jpg"

    hero = cover(Image.open(HERO).convert("RGB"), (1080, 1920))
    hero = ImageEnhance.Brightness(hero).enhance(0.26).filter(ImageFilter.GaussianBlur(22))
    hero.save(background_path, quality=92, subsampling=0)
    return background_path


def build_ad_cards() -> tuple[Path, Path, Path]:
    hero = cover(Image.open(HERO).convert("RGB"), (1920, 1080))

    def card(path: Path, subtitle: str, accent: str) -> None:
        image = ImageEnhance.Contrast(hero).enhance(1.08)
        shade = Image.new("RGBA", image.size, (1, 3, 13, 92))
        image = Image.alpha_composite(image.convert("RGBA"), shade)
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle(
            (290, 310, 1630, 770), radius=35, fill=(2, 5, 18, 185), outline=(38, 225, 255, 230), width=5
        )
        centered_text(
            draw,
            390,
            "Neon Vaults: Лабиринты",
            ImageFont.truetype(FONT_BOLD, 98),
            (248, 252, 255, 255),
            stroke_width=7,
            stroke_fill=(0, 104, 137, 235),
        )
        centered_text(
            draw,
            570,
            subtitle,
            ImageFont.truetype(FONT_BOLD, 48),
            (248, 211, 64, 255) if accent == "gold" else (50, 229, 255, 255),
        )
        image.convert("RGB").save(path, quality=94, subsampling=0)

    intro = OUTPUT / "ad-intro-1920x1080.jpg"
    outro = OUTPUT / "ad-outro-1920x1080.jpg"
    overlay = OUTPUT / "ad-game-overlay-1920x1080.png"
    card(intro, "СВАЙП  •  ДУМАЙ  •  ВЫХОДИ", "cyan")
    card(outro, "250 УРОВНЕЙ  •  ЕЖЕДНЕВНО  •  РЫВОК В ХРАНИЛИЩЕ", "gold")

    game_overlay = Image.new("RGBA", (1920, 1080), (0, 0, 0, 0))
    draw = ImageDraw.Draw(game_overlay)
    draw.rounded_rectangle((38, 32, 495, 112), radius=18, fill=(2, 5, 18, 190), outline=(42, 228, 255, 210), width=3)
    draw.text((70, 48), "Neon Vaults: Лабиринты", font=ImageFont.truetype(FONT_BOLD, 42), fill=(242, 252, 255, 255))
    game_overlay.save(overlay)
    return intro, outro, overlay


def add_tone(
    signal: np.ndarray,
    sample_rate: int,
    start: float,
    duration: float,
    frequency: float,
    amplitude: float,
    decay: float = 3.0,
    pan: float = 0.0,
) -> None:
    begin = max(0, round(start * sample_rate))
    end = min(len(signal), begin + round(duration * sample_rate))
    if end <= begin:
        return
    t = np.arange(end - begin, dtype=np.float64) / sample_rate
    envelope = np.minimum(t / 0.015, 1.0) * np.exp(-decay * t)
    tone = np.sin(2 * math.pi * frequency * t) * envelope * amplitude
    signal[begin:end, 0] += tone * math.sqrt((1 - pan) / 2)
    signal[begin:end, 1] += tone * math.sqrt((1 + pan) / 2)


def build_audio(duration: float = 22.0) -> Path:
    sample_rate = 48_000
    count = round(duration * sample_rate)
    t = np.arange(count, dtype=np.float64) / sample_rate
    signal = np.zeros((count, 2), dtype=np.float64)
    roots = (110.00, 87.31, 130.81, 98.00, 110.00, 146.83)

    for block, root in enumerate(roots):
        start = block * 4.0
        if start >= duration:
            break
        local = t - start
        active = (local >= 0) & (local < 4.2)
        envelope = np.zeros_like(t)
        envelope[active] = np.minimum(local[active] / 0.45, 1.0) * np.minimum((4.2 - local[active]) / 0.45, 1.0)
        pad = sum(np.sin(2 * math.pi * root * ratio * t) / weight for ratio, weight in ((1, 1), (1.5, 1.8), (2, 2.8)))
        shimmer = 0.5 * np.sin(2 * math.pi * root * 4 * t + 0.35 * np.sin(2 * math.pi * 0.17 * t))
        signal[:, 0] += (pad + shimmer) * envelope * 0.038
        signal[:, 1] += (pad - shimmer * 0.35) * envelope * 0.038

    note_pattern = (0, 7, 12, 16, 12, 7, 19, 16)
    for step in range(int(duration / 0.25)):
        start = step * 0.25
        root = roots[min(int(start // 4), len(roots) - 1)]
        frequency = root * 2 ** (note_pattern[step % len(note_pattern)] / 12) * 2
        add_tone(signal, sample_rate, start, 0.32, frequency, 0.045, decay=8.5, pan=(-0.35 if step % 2 else 0.35))

    rng = np.random.default_rng(20260901)
    for beat in np.arange(0.0, duration, 0.5):
        add_tone(signal, sample_rate, float(beat), 0.22, 58, 0.16, decay=12)
        start = round((beat + 0.25) * sample_rate)
        length = min(round(0.045 * sample_rate), count - start)
        if length > 0:
            noise = rng.normal(0, 1, length)
            noise = np.concatenate(([0.0], np.diff(noise)))
            env = np.exp(-np.arange(length) / sample_rate * 55)
            signal[start : start + length, 0] += noise * env * 0.018
            signal[start : start + length, 1] += noise[::-1] * env * 0.018

    for index, moment in enumerate((2.0, 4.8, 7.6, 10.5, 13.4, 16.2, 19.2, 20.4)):
        base = 659.25 * (1.0 if index % 3 else 1.12246)
        add_tone(signal, sample_rate, moment, 0.55, base, 0.085, decay=5.8, pan=-0.3)
        add_tone(signal, sample_rate, moment + 0.075, 0.65, base * 1.5, 0.065, decay=5.2, pan=0.3)

    fade = np.minimum(np.clip(t / 0.75, 0, 1), np.clip((duration - t) / 0.9, 0, 1))
    signal *= fade[:, None]
    peak = np.max(np.abs(signal))
    signal = np.tanh(signal * (1.35 / max(peak, 1e-9))) * 0.82
    pcm = (np.clip(signal, -1, 1) * 32767).astype("<i2")

    path = OUTPUT / "neon-promo-soundtrack-22s.wav"
    with wave.open(str(path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(pcm.tobytes())
    return path


def build_videos() -> tuple[Path, Path]:
    background = build_vertical_art()
    intro, outro, game_overlay = build_ad_cards()
    audio = build_audio()
    vertical = OUTPUT / "neon-vaults-vertical-gameplay-1080x1920.mp4"
    advert = OUTPUT / "neon-vaults-advert-1920x1080.mp4"

    # Keep the RU vertical trailer language-neutral: crop to the actual maze so
    # legacy HUD text (including the former English PAR label) cannot leak in.
    vertical_filter = (
        "[0:v]crop=520:575:380:105,"
        "minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,"
        "scale=1080:1194:flags=lanczos[game];"
        "[1:v]scale=1080:1920[bg];[bg][game]overlay=0:363,format=yuv420p[v]"
    )
    run(
        str(FFMPEG), "-y", "-i", str(SOURCE_VIDEO), "-loop", "1", "-framerate", "30", "-i", str(background),
        "-i", str(audio), "-filter_complex", vertical_filter, "-map", "[v]", "-map", "2:a:0", "-t", "19", "-r", "30",
        "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", str(vertical),
    )

    advert_filter = (
        "[1:v]scale=1920:1080,zoompan=z='min(zoom+0.0006,1.04)':d=60:s=1920x1080:fps=30,"
        "trim=duration=2,setpts=PTS-STARTPTS[intro];"
        "[0:v]setpts=(PTS-STARTPTS)/1.1666667,fps=30,"
        "scale=1920:1080:flags=lanczos,trim=duration=18[gamebase];"
        "[gamebase][3:v]overlay=0:0:shortest=1[game];"
        "[2:v]scale=1920:1080,zoompan=z='min(zoom+0.0006,1.04)':d=60:s=1920x1080:fps=30,"
        "trim=duration=2,setpts=PTS-STARTPTS[outro];"
        "[intro][game][outro]concat=n=3:v=1:a=0,format=yuv420p[v]"
    )
    run(
        str(FFMPEG), "-y", "-i", str(SOURCE_VIDEO), "-loop", "1", "-framerate", "30", "-i", str(intro),
        "-loop", "1", "-framerate", "30", "-i", str(outro), "-loop", "1", "-framerate", "30", "-i", str(game_overlay),
        "-i", str(audio), "-filter_complex", advert_filter, "-map", "[v]", "-map", "4:a:0", "-t", "22", "-r", "30",
        "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", str(advert),
    )
    return vertical, advert


def validate(path: Path, expected_size: tuple[int, int], max_duration: float = 28.0) -> dict[str, object]:
    result = subprocess.run(
        [
            str(FFPROBE), "-v", "error", "-show_entries",
            "format=duration,size:stream=codec_name,codec_type,width,height,pix_fmt,sample_rate,channels",
            "-of", "json", str(path),
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    metadata = json.loads(result.stdout)
    video = next(stream for stream in metadata["streams"] if stream["codec_type"] == "video")
    audio = next(stream for stream in metadata["streams"] if stream["codec_type"] == "audio")
    duration = float(metadata["format"]["duration"])
    size = int(metadata["format"]["size"])
    assert (video["width"], video["height"]) == expected_size
    assert video["codec_name"] == "h264" and video["pix_fmt"] == "yuv420p"
    assert audio["codec_name"] == "aac" and int(audio["sample_rate"]) == 48_000
    assert duration <= max_duration and size < 100_000_000
    return {"file": str(path), "duration": duration, "bytes": size, "video": video, "audio": audio}


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for required in (SOURCE_VIDEO, HERO, FONT_BOLD, FONT_REGULAR, FFMPEG, FFPROBE):
        if not required.exists():
            raise FileNotFoundError(required)
    vertical, advert = build_videos()
    report = {
        "verticalGameplay": validate(vertical, (1080, 1920)),
        "advertisingVideo": validate(advert, (1920, 1080)),
    }
    report_path = OUTPUT / "validation-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
