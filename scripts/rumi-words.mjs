// rumi-words.mjs — turn a recorder's timing into the per-word spans the app can play.
//
// TWO RECORDERS, ONE FORMAT. ElevenLabs returns per-character times; the free Microsoft voice
// returns one WordBoundary event per word. Both arrive here and both leave as the same flat
// list, so the app reads one shape and never asks who recorded a line. Added 2026-09-15, when
// the ElevenLabs key turned out to be a free-plan key that cannot speak Spanish at all.
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

/** The free voice's shape: { words: [{ text, start, end }] } in seconds, from the service's
 *  own WordBoundary events (scripts/rumi-edge-words.py). One event per word already, so there
 *  is nothing to group — but every check wordSpans() makes still applies, and for the same
 *  reason: the service normalises as it reads, so "10" can come back as one event saying
 *  "diez" and a line whose events do not match its own words gets no timing at all.
 *
 *  Returns the identical flat list, [end, s0, e0, s1, e1, ...], so the app has ONE format to
 *  read whoever recorded the clip. */
export function wordSpansFromMarks(text, marks) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const evs = marks && Array.isArray(marks.words) ? marks.words : null;
  if (!evs || evs.length !== words.length) return null;

  const bare = (w) => String(w).toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '');
  for (let i = 0; i < words.length; i += 1) {
    const e = evs[i];
    if (!e || typeof e.start !== 'number' || typeof e.end !== 'number') return null;
    if (!(e.end > e.start)) return null;
    if (i && e.start < evs[i - 1].start) return null;
    if (bare(e.text) !== bare(words[i])) return null;
  }

  const out = [round(evs[evs.length - 1].end)];
  for (const e of evs) out.push(round(e.start), round(e.end));
  return out;
}

/** A whole timing map: { key: alignment | marks } -> { key: spans }, with the keys it dropped.
 *  Both recorders are accepted by shape, not by a flag, so a bank recorded half by one and half
 *  by the other still produces one timing map and no line silently loses its timing. */
export function spanMap(items, times) {
  const map = {};
  const dropped = [];
  for (const it of items) {
    if (!times[it.key]) continue;
    const t = times[it.key];
    const s = Array.isArray(t.words) ? wordSpansFromMarks(it.text, t) : wordSpans(it.text, t);
    if (s) map[it.key] = s;
    else dropped.push(it.key);
  }
  return { map, dropped };
}
