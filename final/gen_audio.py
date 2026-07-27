#!/usr/bin/env python3
"""
gen_audio.py — Generate per-slide TTS audio from script.md using edge-tts

Usage:
  python gen_audio.py                            # default: GuyNeural, -5% rate
  python gen_audio.py --voice en-US-AndrewNeural
  python gen_audio.py --voice en-US-JennyNeural --rate -10%
  python gen_audio.py --slides 1 13 18           # specific slides only
  python gen_audio.py --no-full                  # skip full_script.mp3
  python gen_audio.py --list-voices              # list available en-US voices

Output: final/audio/s01.mp3 ... s21.mp3  +  full_script.mp3
"""

import asyncio
import re
import sys
import argparse
from pathlib import Path

try:
    import edge_tts
except ImportError:
    sys.exit(
        "\n  edge-tts not installed.\n"
        "  Run:  pip install edge-tts\n"
    )

SCRIPT_MD = Path(__file__).parent / "script.md"
DEFAULT_VOICE = "en-US-GuyNeural"
DEFAULT_RATE = "-5%"
MAX_CONCURRENT = 5  # limit concurrent requests to Microsoft TTS


def parse_slides(md_text: str) -> list:
    """Parse script.md → list of {num, title, text} dicts.

    Keeps only blockquote lines (> "...").
    Strips stage directions like *(play video)* automatically.
    """
    slides = []
    # Split on lines that begin a new slide heading
    blocks = re.split(r"\n(?=## SLIDE \d+)", md_text)

    for block in blocks:
        m = re.match(r"## SLIDE (\d+) — (.+?) `\[", block)
        if not m:
            continue

        num = int(m.group(1))
        title = m.group(2).strip()

        spoken = []
        for line in block.splitlines():
            stripped = line.strip()
            if stripped.startswith("> "):
                # Remove "> " prefix and surrounding quotation marks
                text = stripped[2:].strip().strip('"').strip("“”")
                if text:
                    spoken.append(text)

        full_text = " ".join(spoken).strip()
        if full_text:
            slides.append({"num": num, "title": title, "text": full_text})

    return slides


async def generate_mp3(
    text: str,
    path: Path,
    voice: str,
    rate: str,
    sem: asyncio.Semaphore,
) -> None:
    async with sem:
        communicate = edge_tts.Communicate(text, voice=voice, rate=rate)
        await communicate.save(str(path))


async def list_voices() -> None:
    voices = await edge_tts.list_voices()
    en_voices = [v for v in voices if v["Locale"].startswith("en-US")]
    print("\nAvailable en-US voices:\n")
    for v in sorted(en_voices, key=lambda x: x["ShortName"]):
        gender = v["Gender"].ljust(6)
        print(f"  {v['ShortName']:<38}  {gender}  {v.get('FriendlyName', '')}")
    print()


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate TTS audio from script.md",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--voice", default=DEFAULT_VOICE,
        help=f"Edge TTS voice name (default: {DEFAULT_VOICE})",
    )
    parser.add_argument(
        "--rate", default=DEFAULT_RATE,
        help="Rate offset: -10%% = slower, +10%% = faster (default: -5%%)",
    )
    parser.add_argument(
        "--out-dir", default=None,
        help="Output directory (default: final/audio/ next to this script)",
    )
    parser.add_argument(
        "--slides", nargs="+", type=int, metavar="N",
        help="Only generate audio for specific slide numbers",
    )
    parser.add_argument(
        "--no-full", action="store_true",
        help="Skip generating full_script.mp3",
    )
    parser.add_argument(
        "--list-voices", action="store_true",
        help="Print available en-US voices and exit",
    )
    args = parser.parse_args()

    if args.list_voices:
        await list_voices()
        return

    if not SCRIPT_MD.exists():
        sys.exit(f"script.md not found at {SCRIPT_MD}")

    md_text = SCRIPT_MD.read_text(encoding="utf-8")
    all_slides = parse_slides(md_text)

    if args.slides:
        slides = [s for s in all_slides if s["num"] in args.slides]
        if not slides:
            sys.exit(f"None of the requested slides ({args.slides}) found in script.md")
    else:
        slides = all_slides

    out_dir = Path(args.out_dir) if args.out_dir else SCRIPT_MD.parent / "audio"
    out_dir.mkdir(parents=True, exist_ok=True)

    sem = asyncio.Semaphore(MAX_CONCURRENT)

    print(f"\nVoice : {args.voice}")
    print(f"Rate  : {args.rate}")
    print(f"Output: {out_dir}/")
    print(f"\nGenerating {len(slides)} slide MP3s ...\n")

    async def run_slide(slide):
        path = out_dir / f"s{slide['num']:02d}.mp3"
        await generate_mp3(slide["text"], path, args.voice, args.rate, sem)
        print(f"  ✓  s{slide['num']:02d}  {slide['title']}")

    await asyncio.gather(*[run_slide(s) for s in slides])

    if not args.no_full and not args.slides:
        print("\nGenerating full_script.mp3 ...")
        # Separate slides with a short pause (double newline = natural breath)
        full_text = "\n\n".join(s["text"] for s in all_slides)
        full_path = out_dir / "full_script.mp3"
        await generate_mp3(full_text, full_path, args.voice, args.rate, sem)
        print("  ✓  full_script.mp3")

    total = len(slides) + (1 if not args.no_full and not args.slides else 0)
    print(f"\nDone — {total} file(s) saved to {out_dir}/\n")

    if not args.slides:
        print("Tips:")
        print("  Try a different voice:  python gen_audio.py --voice en-US-AndrewNeural")
        print("  Go slower:              python gen_audio.py --rate -15%")
        print("  Single slide:           python gen_audio.py --slides 13")
        print("  See all voices:         python gen_audio.py --list-voices")


if __name__ == "__main__":
    asyncio.run(main())
