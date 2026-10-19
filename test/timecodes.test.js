const test = require('node:test');
const assert = require('node:assert/strict');
const { extractEntries, rank, parseTime, parseCount, formatTime } = require('../src/lib/timecodes.js');

const titles = (entries) => entries.map((e) => [e.t, e.title]);

test('parseTime / formatTime', () => {
  assert.equal(parseTime('3:45'), 225);
  assert.equal(parseTime('1:02:03'), 3723);
  assert.ok(Number.isNaN(parseTime('3:75')));
  assert.equal(formatTime(3723), '1:02:03');
  assert.equal(formatTime(65), '1:05');
});

test('timestamp first, various separators and numbering', () => {
  const text = [
    'Tracklist:',
    '00:00 Intro',
    '1. 03:15 - First Song',
    '2) 7:40 | Second Song (Live)',
    '#3 1:02:03 — Third Song',
  ].join('\n');
  assert.deepEqual(titles(extractEntries(text)), [
    [0, 'Intro'],
    [195, 'First Song'],
    [460, 'Second Song (Live)'],
    [3723, 'Third Song'],
  ]);
});

test('title first, timestamp in brackets', () => {
  const text = 'Song A - 0:00\nSong B (4:12)\n[8:30] Song C';
  assert.deepEqual(titles(extractEntries(text)), [
    [0, 'Song A'],
    [252, 'Song B'],
    [510, 'Song C'],
  ]);
});

test('ranges keep the start time only', () => {
  assert.deepEqual(titles(extractEntries('0:00 - 4:12 Opening\n4:12 – 9:00 Closing')), [
    [0, 'Opening'],
    [252, 'Closing'],
  ]);
});

test('several entries in one line', () => {
  assert.deepEqual(titles(extractEntries('0:00 Intro 3:12 Song One 7:40 Song Two')), [
    [0, 'Intro'],
    [192, 'Song One'],
    [460, 'Song Two'],
  ]);
});

test('timestamp alone with title on the next line', () => {
  assert.deepEqual(titles(extractEntries('1:15\nSoldier Of Love\n\n7:54\nYour Love Is King')), [
    [75, 'Soldier Of Love'],
    [474, 'Your Love Is King'],
  ]);
});

test('cyrillic titles survive cleaning', () => {
  assert.deepEqual(titles(extractEntries('0:00 — Группа крови\n5:10 — Кукушка\n9:00 «Звезда»')), [
    [0, 'Группа крови'],
    [310, 'Кукушка'],
    [540, '«Звезда»'],
  ]);
});

test('rank prefers real tracklists and drops noise', () => {
  const results = rank(
    [
      { kind: 'comment', text: '1:03:24 goosebumps every time', likes: 5000 },
      { kind: 'comment', text: '0:00 A\n3:00 B\n6:00 C\n9:00 D', likes: 10 },
      { kind: 'comment', text: '9:00 D\n0:00 A\n6:00 C\n3:00 B', likes: 10 },
      { kind: 'description', text: '0:00 A\n3:00 B\n6:00 C\n9:00 D\n2:00:00 Beyond the end' },
    ],
    600,
  );
  assert.equal(results.length, 2);
  assert.equal(results[0].kind, 'description');
  assert.equal(results[0].entries.length, 4); // 2:00:00 is past the video end
});

test('parseCount understands short forms', () => {
  assert.equal(parseCount('158'), 158);
  assert.equal(parseCount('1.2K'), 1200);
  assert.equal(parseCount('3,4 тыс.'), 3400);
  assert.equal(parseCount('2M'), 2000000);
  assert.equal(parseCount(undefined), 0);
});
