// usage: node test/trace.js file.wav [--frames] [--from s] [--to s]
const fs = require('fs');
const { Ear, noteName } = require('../src/engine.js');

function readWav(path) {
  const b = fs.readFileSync(path);
  let pos = 12, fmt = null, data = null;
  while (pos < b.length - 8) {
    const id = b.toString('ascii', pos, pos + 4), size = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(pos + 8), ch: b.readUInt16LE(pos + 10), sr: b.readUInt32LE(pos + 12), bits: b.readUInt16LE(pos + 22) };
    if (id === 'data') { data = b.subarray(pos + 8, pos + 8 + size); break; }
    pos += 8 + size + (size & 1);
  }
  const n = data.length / (fmt.bits / 8) / fmt.ch, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = fmt.format === 3 ? data.readFloatLE(i * 4 * fmt.ch) : data.readInt16LE(i * 2 * fmt.ch) / 32768;
  }
  return { sr: fmt.sr, x: out };
}
module.exports = { readWav };

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args[0];
  const showFrames = args.includes('--frames');
  const from = args.includes('--from') ? +args[args.indexOf('--from') + 1] : 0;
  const to = args.includes('--to') ? +args[args.indexOf('--to') + 1] : 1e9;
  const { sr, x } = readWav(file);
  const ear = new Ear({ sampleRate: sr });
  ear.onStrike = (r) => {
    if (r.time < from || r.time > to) return;
    console.log(`${r.time.toFixed(3)}  STRIKE@${r.strike.toFixed(3)} ${r.struck.map((e) => `${noteName(e.midi)}${e.indep ? '' : '~' + noteName(e.base)}${e.virtual ? 'v' : ''}(+${e.rise.toFixed(0)})`).join(' ')}`);
  };
  if (showFrames) ear.onFrame = (f) => {
    if (f.time < from || f.time > to) return;
    const ns = [...f.notes.entries()].map(([m, i]) => `${noteName(m)}${i.indep ? '' : '~'}:${i.level.toFixed(0)}${i.comb != null ? '/' + i.comb.toFixed(0) : ''}`).join(' ');
    console.log(`${f.time.toFixed(3)} ${f.db.toFixed(0)}dB flux ${f.flux.toFixed(3)}${f.onset ? ' *' : '  '} | ${ns}`);
  };
  const B = 128;
  for (let i = 0; i + B <= x.length; i += B) ear.push(x.subarray(i, i + B));
}
