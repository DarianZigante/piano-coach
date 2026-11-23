const fs = require('fs'), cp = require('child_process');
const { Ear, noteName } = require('../src/engine.js');
const { readWav } = require('./trace.js');
const inst = process.argv[2] || 'sal';
const trials = [], events = [];
let t = 0.5;
for (let m = 36; m <= 76; m += 2) for (const h of [2, 3, 4, 5]) {
  const up = m + Math.round(12 * Math.log2(h));
  if (up > 96) continue;
  for (const mode of ['alone', 'both', 'soft', 'loud']) {
    trials.push({ m, up, h, mode, t });
    events.push([t, m, 0.6, mode === 'loud' ? 0.45 : 0.75]);
    if (mode !== 'alone') events.push([t, up, 0.6, mode === 'soft' ? 0.4 : 0.75]);
    t += 0.95;
  }
}
fs.writeFileSync('/tmp/comb.json', JSON.stringify({ events, tail: 1 }));
const wav = `/tmp/comb_${inst}.wav`;
if (!fs.existsSync(wav)) cp.execFileSync('python3', ['tools/render.py', '/tmp/comb.json', wav, '--inst', inst], { stdio: 'pipe' });
const { sr, x } = readWav(wav);
const ear = new Ear({ sampleRate: sr });
let ti = 0; const acc = trials.map(() => ({ comb: [], indep: 0, n: 0, seen: 0 }));
ear.onFrame = (f) => {
  while (ti < trials.length - 1 && f.time >= trials[ti + 1].t) ti++;
  const tr = trials[ti]; ear.setContext(new Set([tr.m, tr.up]));
  const dt = f.time - tr.t;
  if (dt < 0.10 || dt > 0.45) return;
  const a = acc[ti]; a.n++;
  const u = f.notes.get(tr.up);
  if (u) { a.seen++; if (u.indep) a.indep++; if (u.comb != null) a.comb.push(u.comb); else a.comb.push(99); }
};
for (let i = 0; i + 128 <= x.length; i += 128) ear.push(x.subarray(i, i + 128));
const med = (a) => { if (!a.length) return NaN; const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
const mn = (a) => (a.length ? Math.min(...a) : NaN), mx = (a) => (a.length ? Math.max(...a.filter((v) => v < 90).concat([-99])) : NaN);
const byH = {};
trials.forEach((tr, i) => {
  const a = acc[i];
  (byH[tr.h] = byH[tr.h] || []).push({ ...tr, med: med(a.comb), min: mn(a.comb), max: mx(a.comb), seen: a.seen / a.n });
});
for (const h of Object.keys(byH)) {
  console.log(`\n== harmonic ${h} (${inst}) : median comb [min..max]   alone | both | upper soft | upper loud`);
  const rows = {};
  byH[h].forEach((r) => { (rows[r.m] = rows[r.m] || {})[r.mode] = r; });
  for (const m of Object.keys(rows)) {
    const r = rows[m]; const c = (q) => (q.seen < 0.5 ? '  (unseen)   ' : `${q.med > 90 ? ' free' : q.med.toFixed(1).padStart(5)} [${q.min > 90 ? 'fr' : q.min.toFixed(0)}..${q.max.toFixed(0)}]`.padEnd(15));
    console.log(`${noteName(+m).padEnd(4)}+${noteName(r.alone.up).padEnd(4)} ${c(r.alone)} | ${c(r.both)} | ${c(r.soft)} | ${c(r.loud)}`);
  }
}
