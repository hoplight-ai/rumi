// rumi-words.mjs — turn ElevenLabs' per-character timing into per-word spans the app can play.
//
// WHY THE APP GETS WORDS AND NOT CHARACTERS. The slow speed (turtle) plays one word, then a gap,
// then the next word, from the real recording. It needs a start and an end per word and nothing
// else. Per-character arrays are about thirty times larger, and every byte here sits inside the
// one app file under a 10MB ceiling. So the conversion happens once, at embed time, and the page
// carries a flat list: [clip end, start0, end0, start1, end1, ...] in seconds, two decimals.
//
// THE WORD RULE MUST MATCH THE APP'S. The app splits the spoken line on whitespace, exactly as
// the device-voice turtle always has (speakSynth). If the recording's words do not line up one to
// one with that split — a normaliser that read "10" as "diez", a dropped article — the spans are
// wrong for that line, so this returns null and the app plays the line the way it does today.
// A wrong timing is worse than none: it cuts a word in half, and she repeats what she hears.

const round = (n) => Math.round(n * 100) / 100;

/** alignment: { characters, character_start_times_seconds, character_end_times_seconds }.
 *  Returns [end, s0, e0, s1, e1, ...] or null when the words do not line up with `text`. */
export function wordSpans(text, alignment) {
  if (!alignment || !Array.isArray(alignment.characters)) return null;
  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds || [];
  const ends = alignment.character_end_times_seconds || [];
  if (!chars.length || starts.length !== chars.length || ends.length !== chars.length) return null;

  const spans = [];
  let cur = null;
  for (let i = 0; i < chars.length; i += 1) {
    if (/\s/.test(chars[i])) {
      if (cur) { spans.push(cur); cur = null; }
    } else if (!cur) {
      cur = { s: starts[i], e: ends[i], w: chars[i] };
    } else {
      cur.e = ends[i];
      cur.w += chars[i];
    }
  }
  if (cur) spans.push(cur);

  const words = String(text).split(/\s+/).filter(Boolean);
  if (spans.length !== words.length) return null;
  // Same words, compared loosely: case and punctuation are the normaliser's business, letters
  // are not. A mismatch here means the service said something other than the line.
  const bare = (w) => w.toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '');
  for (let i = 0; i < words.length; i += 1) {
    if (bare(spans[i].w) !== bare(words[i])) return null;
  }
  for (let i = 0; i < spans.length; i += 1) {
    if (!(spans[i].e > spans[i].s) || (i && spans[i].s < spans[i - 1].s)) return null;
  }

  const out = [round(ends[ends.length - 1])];
  for (const sp of spans) out.push(round(sp.s), round(sp.e));
  return out;
}

/** A whole timing map: { key: alignment } -> { key: spans }, with the keys it had to drop. */
export function spanMap(items, times) {
  const map = {};
  const dropped = [];
  for (const it of items) {
    if (!times[it.key]) continue;
    const s = wordSpans(it.text, times[it.key]);
    if (s) map[it.key] = s;
    else dropped.push(it.key);
  }
  return { map, dropped };
}
