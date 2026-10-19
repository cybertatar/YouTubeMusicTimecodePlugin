#!/usr/bin/env node
// Builds unpacked extensions for each browser into dist/<target>.
// Usage: node scripts/build.js [chrome|firefox|safari ...] [--zip]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const TARGETS = {
  chrome: (m) => m,
  firefox: (m) => ({
    ...m,
    browser_specific_settings: {
      gecko: {
        id: 'ytm-timecodes@cybertatar',
        strict_min_version: '121.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  }),
  safari: (m) => m,
};

const args = process.argv.slice(2);
const zip = args.includes('--zip');
const targets = args.filter((a) => !a.startsWith('--'));

for (const target of targets.length ? targets : Object.keys(TARGETS)) {
  if (!TARGETS[target]) throw new Error(`Unknown target: ${target}`);
  const out = path.join(DIST, target);
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(SRC, out, { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(TARGETS[target](manifest), null, 2) + '\n');

  if (zip && target !== 'safari') {
    const file = path.join(DIST, `ytm-timecodes-${target}-${manifest.version}.zip`);
    fs.rmSync(file, { force: true });
    execFileSync('zip', ['-qr', file, '.'], { cwd: out });
    console.log(`Packed ${path.relative(ROOT, file)}`);
  }
  console.log(`Built dist/${target}`);
}
