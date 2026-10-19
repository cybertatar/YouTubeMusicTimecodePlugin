#!/usr/bin/env node
// Runs the real fetching + parsing pipeline against live YouTube.
// Usage: node scripts/probe.js <videoId> [durationSeconds]
const { getTimecodes } = require('../src/lib/innertube.js');
const { formatTime } = require('../src/lib/timecodes.js');

(async () => {
  const [videoId, duration] = process.argv.slice(2);
  if (!videoId) {
    console.error('Usage: node scripts/probe.js <videoId> [durationSeconds]');
    process.exit(1);
  }
  const res = await getTimecodes(videoId, { duration: Number(duration) || 0 });
  console.log(`${res.title} (${res.results.length} candidate lists)`);
  res.results.forEach((r, i) => {
    console.log(`\n#${i + 1} ${r.kind} ${r.author} likes=${r.likes} score=${r.score.toFixed(1)}`);
    if (i === 0) for (const e of r.entries) console.log(`  ${formatTime(e.t).padStart(8)}  ${e.title}`);
    else console.log(`  ${r.entries.length} entries, first: ${r.entries[0].title}`);
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
