// strike-detector recall / false alarms over all rendered scenario files; prints flux excess stats
const fs = require('fs'), path = require('path');
const { Ear } = require('../src/engine.js'); const { readWav } = require('./trace.js');
const dir = path.join(__dirname, '..', 'audio');
const thr = process.argv[2] ? +process.argv[2] : undefined;
let tp = 0, fn = 0, fp = 0; const misses = [], fps = [];
const STEP = +(process.env.STEP || 1); let fi = 0;
for (const f of fs.readdirSync(dir).filter((n) => /^c_.*\.json$/.test(n))) {
  if (fi++ % STEP) continue;
  const wav = path.join(dir, f.replace('.json', '.wav')); if (!fs.existsSync(wav)) continue;
  const ev = JSON.parse(fs.readFileSync(path.join(dir, f))).events;
  const truth = [...new Set(ev.map((e) => Math.round(e[0] * 1000)))].sort((a, b) => a - b).map((v) => v / 1000);
  const merged = []; truth.forEach((t) => { if (!merged.length || t - merged[merged.length - 1] > 0.07) merged.push(t); });
  const { sr, x } = readWav(wav); const ear = new Ear(thr !== undefined ? { sampleRate: sr, strikeThr: thr } : { sampleRate: sr }); const det = [];
  ear.onFrame = (fr) => { if (fr.onset) det.push(fr.time - ear.hop / sr); };
  for (let i = 0; i + 128 <= x.length; i += 128) ear.push(x.subarray(i, i + 128));
  const used = new Set();
  merged.forEach((t) => { const k = det.findIndex((d, i) => !used.has(i) && d - t > -0.03 && d - t < 0.12); if (k >= 0) { used.add(k); tp++; } else { fn++; misses.push(f + '@' + t); } });
  det.forEach((d, i) => { if (!used.has(i)) fps.push(f + '@' + d.toFixed(2)); });
  fp += det.length - used.size;
}
console.log(`thr ${thr}: strikes found ${tp}, missed ${fn}, false ${fp}`);
if (process.argv[3]) { console.log('missed:', misses.slice(0, 12).join(' ')); console.log('false:', fps.slice(0, 12).join(' ')); }
