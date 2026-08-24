// RUN EVERYTHING. Exits non-zero if any probe does.
//
// This exists because "run the probes" used to mean running twenty
// commands by hand and reading twenty walls of numbers, which is the same
// as not running them. Every probe below can fail now; before the v0.21.0
// overhaul, twelve of them exited 0 no matter what they measured.
import { spawn } from 'node:child_process';

// Ordered fastest-first, so a broken build says so in seconds rather than
// after the twenty-minute pressure run.
const PROBES = [
  'smoke', 'shotprobe', 'vraimprobe', 'rampprobe', 'groundprobe',
  'gymprobe', 'lookprobe', 'perfprobe', 'interactprobe', 'vrprobe',
  'modprobe', 'barrelprobe', 'hotprobe', 'droneprobe', 'recoilprobe',
  'traverseprobe', 'endingprobe', 'navprobe', 'pacingprobe',
  'holdoutprobe', 'pressureprobe',
];

const only = process.argv.slice(2);
const list = only.length ? PROBES.filter((p) => only.some((o) => p.includes(o))) : PROBES;

const failed = [];
for (const p of list) {
  const t0 = Date.now();
  process.stdout.write(`${p.padEnd(16)} `);
  const code = await new Promise((r) => {
    const child = spawn('node', [`test/${p}.mjs`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (c) => {
      if (c !== 0) {
        // Only the failures get printed in full. A green run should be
        // twenty lines, not two thousand.
        const lines = out.split('\n').filter((l) => /FAIL|RED|Error/.test(l));
        console.log(`RED  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
        for (const l of lines.slice(0, 8)) console.log(`    ${l.trim()}`);
      } else {
        console.log(`green (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      }
      r(c);
    });
  });
  if (code !== 0) failed.push(p);
}

console.log(failed.length
  ? `\nSUITE RED: ${failed.join(', ')}`
  : `\nSUITE GREEN (${list.length} probes)`);
process.exit(failed.length ? 1 : 0);
