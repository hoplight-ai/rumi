#!/usr/bin/env python3
"""rumi-edge-words.py - one clip from the free voice, WITH per-word timing.

WHY THIS EXISTS AND WHY IT IS NOT THE edge-tts COMMAND.
The slow speed plays the real recording one word at a time, which needs a start and an end
per word. The `edge-tts` command cannot give that: its --write-subtitles merges the whole
line into a single caption (measured 2026-09-15 on a real stroke cue, one cue of 5.06s for
seven words), and its default request asks the service for SentenceBoundary events only.
The library underneath it takes boundary="WordBoundary" and then the service returns one
event per word, with an offset and a duration. So this calls the library directly.

It is the SAME service, the SAME voice and the SAME rate as the command it replaces, so the
audio is unchanged; the only difference is that the word marks are kept instead of dropped.
Offsets and durations arrive in 100-nanosecond ticks and are written as seconds.

usage (rumi-audio.mjs calls it once per clip, serially):
  python3 scripts/rumi-edge-words.py --voice es-ES-XimenaNeural --rate=-35% \
      --text "Baja una linea grande" --media out.mp3 --marks out.mp3.json
"""
import argparse
import asyncio
import json
import sys

try:
    import edge_tts
except ImportError:  # pragma: no cover - the caller reports this in one line
    sys.stderr.write("edge_tts is not importable by this python3\n")
    sys.exit(2)

TICKS_PER_SECOND = 10_000_000


async def run(args):
    comm = edge_tts.Communicate(
        args.text, args.voice, rate=args.rate, boundary="WordBoundary",
    )
    audio = bytearray()
    words = []
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            words.append({
                "text": chunk["text"],
                "start": chunk["offset"] / TICKS_PER_SECOND,
                "end": (chunk["offset"] + chunk["duration"]) / TICKS_PER_SECOND,
            })

    # A clip this small is a refusal or a truncation, never speech. Writing nothing is what
    # lets the caller's retry see a missing file rather than a plausible-looking stub.
    if len(audio) < 512:
        sys.stderr.write(f"clip too small ({len(audio)} bytes)\n")
        sys.exit(3)

    with open(args.media, "wb") as fh:
        fh.write(audio)
    # The marks file is written only when there are marks. No marks is not a failure: the
    # line still has its recording and simply plays whole, which is what it does today.
    if words:
        with open(args.marks, "w", encoding="utf-8") as fh:
            json.dump({"text": args.text, "words": words}, fh, ensure_ascii=False)
    print(f"{len(audio)} {len(words)}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--voice", required=True)
    p.add_argument("--rate", required=True)
    p.add_argument("--text", required=True)
    p.add_argument("--media", required=True)
    p.add_argument("--marks", required=True)
    asyncio.run(run(p.parse_args()))


if __name__ == "__main__":
    main()
