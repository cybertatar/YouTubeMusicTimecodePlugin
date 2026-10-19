// Extracts "timestamp + song title" lists from free-form text (video
// descriptions, comments) and picks the most plausible tracklist.
// Shared by the background script and Node tests, so no browser APIs here.
(function (root) {
  'use strict';

  // h:mm:ss or m:ss, not glued to other digits/colons.
  const TIME_RE = /(^|[^\d:])((?:\d{1,2}:)?\d{1,2}:\d{2})(?![\d:])/g;

  const MIN_ENTRIES = 3;
  const MIN_ORDERED_RATIO = 0.8;

  function parseTime(str) {
    const parts = str.split(':').map(Number);
    if (parts.some((n) => !Number.isFinite(n))) return NaN;
    if (parts.length === 2) {
      const [m, s] = parts;
      return s < 60 ? m * 60 + s : NaN;
    }
    const [h, m, s] = parts;
    return m < 60 && s < 60 ? h * 3600 + m * 60 + s : NaN;
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = String(sec % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function findTimes(line) {
    const out = [];
    TIME_RE.lastIndex = 0;
    let m;
    while ((m = TIME_RE.exec(line))) {
      const start = m.index + m[1].length;
      const t = parseTime(m[2]);
      if (Number.isFinite(t)) out.push({ t, start, end: start + m[2].length });
    }
    return out;
  }

  // Strips numbering, bullets, separators and empty brackets around a title.
  function cleanTitle(raw) {
    let s = raw
      .replace(/[​-‏⁠﻿]/g, '')
      .replace(/[([{]\s*[)\]}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const edge = /^[\s\-–—−:|•·.,;~>»*_/\\]+|[\s\-–—−:|•·,;~<«*_/\\]+$/g;
    for (let i = 0; i < 3; i++) {
      s = s.replace(edge, '');
      s = s.replace(/^(?:#?\d{1,3}[.)\]:]|#\d{1,3}\b|\d{1,3}\s+[-–—]|\(\d{1,3}\)|\[\d{1,3}\])\s*/, '');
      s = s.replace(/^[^\p{L}\p{N}"'«“(\[]+/u, '');
      s = s.trim();
    }
    return s;
  }

  function stripTimes(line, times) {
    let out = '';
    let pos = 0;
    for (const tm of times) {
      out += line.slice(pos, tm.start) + ' ';
      pos = tm.end;
    }
    return out + line.slice(pos);
  }

  // Splits "0:00 Intro 3:12 Song 7:40 Other" (several entries in one line).
  function splitInline(line, times) {
    const startsWithTime = cleanTitle(line.slice(0, times[0].start)) === '';
    const entries = [];
    for (let i = 0; i < times.length; i++) {
      const title = startsWithTime
        ? line.slice(times[i].end, i + 1 < times.length ? times[i + 1].start : line.length)
        : line.slice(i === 0 ? 0 : times[i - 1].end, times[i].start);
      entries.push({ t: times[i].t, title: cleanTitle(title) });
    }
    return entries;
  }

  // Returns [{t, title}] in the order they appear in the text.
  function extractEntries(text) {
    if (!text) return [];
    const lines = String(text).split(/\r?\n/);
    const entries = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const times = findTimes(line);
      if (!times.length) continue;

      // "0:00 - 4:12 Song" is a range: only the first value counts.
      const between = times.length === 2 ? line.slice(times[0].end, times[1].start) : null;
      const isRange = between !== null && /^\s*[-–—~]\s*$/.test(between);

      if (times.length >= 2 && !isRange) {
        const inline = splitInline(line, times);
        if (inline.filter((e) => e.title).length >= 2) {
          entries.push(...inline);
          continue;
        }
      }

      let title = cleanTitle(stripTimes(line, times));
      // Timestamp alone on a line, title on the next one.
      if (!title && i + 1 < lines.length && !findTimes(lines[i + 1]).length) {
        const next = cleanTitle(lines[i + 1]);
        if (next) {
          title = next;
          i++;
        }
      }
      entries.push({ t: times[0].t, title });
    }
    return entries;
  }

  // Cleans an extracted list and scores how likely it is a real tracklist.
  function evaluate(entries, duration) {
    let list = entries.filter((e) => e.title);
    if (duration > 0) list = list.filter((e) => e.t <= duration + 1);

    let ordered = 0;
    for (let i = 1; i < list.length; i++) if (list[i].t > list[i - 1].t) ordered++;
    const orderedRatio = list.length > 1 ? ordered / (list.length - 1) : 0;

    const seen = new Set();
    list = list
      .slice()
      .sort((a, b) => a.t - b.t)
      .filter((e) => (seen.has(e.t) ? false : (seen.add(e.t), true)));

    if (list.length < MIN_ENTRIES || orderedRatio < MIN_ORDERED_RATIO) {
      return { entries: list, score: 0 };
    }

    let score = list.length * orderedRatio;
    // A tracklist usually covers most of the video.
    if (duration > 0) {
      const coverage = list[list.length - 1].t / duration;
      score *= 0.5 + Math.min(coverage, 1) * 0.5;
    }
    return { entries: list, score };
  }

  function parseCount(str) {
    if (str == null) return 0;
    const m = String(str).replace(/\s/g, '').replace(',', '.').match(/^([\d.]+)([KkMmBbКкМм]|тыс\.?|млн\.?)?/);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const unit = (m[2] || '').toLowerCase();
    if (unit.startsWith('k') || unit.startsWith('к') || unit.startsWith('тыс')) return Math.round(n * 1e3);
    if (unit.startsWith('m') || unit.startsWith('м')) return Math.round(n * 1e6);
    if (unit.startsWith('b')) return Math.round(n * 1e9);
    return Math.round(n);
  }

  // candidates: [{kind: 'chapters'|'description'|'comment', text?, entries?, likes?, author?}]
  // Returns candidates with a non-zero score, best first.
  function rank(candidates, duration) {
    const bonus = { chapters: 6, description: 2, comment: 0 };
    const out = [];
    for (const c of candidates) {
      const raw = c.entries || extractEntries(c.text);
      const { entries, score } = evaluate(raw, duration);
      if (!score) continue;
      let total = score + (bonus[c.kind] || 0);
      if (c.kind === 'comment') total += Math.min(Math.log10((c.likes || 0) + 1), 4);
      out.push({ kind: c.kind, author: c.author || '', likes: c.likes || 0, entries, score: total });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  const api = { parseTime, formatTime, extractEntries, evaluate, rank, parseCount, cleanTitle };
  root.YTMTC = Object.assign(root.YTMTC || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
