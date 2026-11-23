// print short-window per-note partial energy around strikes
const { Ear, noteName } = require('../src/engine.js');
const { readWav } = require('./trace.js');
const [file, watchArg, from, to] = process.argv.slice(2);
const watch = watchArg.split(',').map(Number);
const { sr, x } = readWav(file);
const ear = new Ear({ sampleRate: sr });
const Ns = ear.Ns;
function shortLevel(midi) {
  const f0 = 440 * Math.pow(2, (midi - 69) / 12); let e = 0;
  for (let h = 1; h <= 3; h++) { const k = Math.round(h * f0 * Ns / sr); for (let j = k - 1; j <= k + 1; j++) e += ear.res[j] * ear.res[j] + ear.ims[j] * ear.ims[j]; }
  return 10 * Math.log10(e / (Ns * Ns / 16) + 1e-14);
}
ear.onFrame = (f) => {
  if (f.time < +from || f.time > +to) return;
  const cols = watch.map((m) => { const i = f.notes.get(m); return `${noteName(m)} s${shortLevel(m).toFixed(1).padStart(6)} L${i ? i.level.toFixed(1).padStart(6) : '   -- '}`; });
  console.log(`${f.time.toFixed(3)} flux ${f.flux.toFixed(3)}${f.onset ? '*' : ' '} ${cols.join(' | ')}`);
};
for (let i = 0; i + 128 <= x.length; i += 128) ear.push(x.subarray(i, i + 128));
