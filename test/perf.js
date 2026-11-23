// usage: node test/perf.js <pieceId> <out.json> [speedFactor] [errorSpec]
// Turns a library piece into a list of performed notes [[t, midi, dur, vel], ...].
const P = require('../src/pieces.js'), fs = require('fs');
const [id, out, sp, err] = process.argv.slice(2);
const piece = P.library.find((p) => p.id === id); const speed = +(sp || 1);
const secPerDiv = 60 / (piece.tempo * speed) / 8; const ev = [];
[['rh', 0.8], ['lh', 0.65]].forEach(([hand, vel]) => {
  let t = 1.6; const open = {};
  P.parseHand(piece[hand]).forEach((bar) => bar.forEach((e) => {
    const d = e.dur * secPerDiv;
    if (!e.rest) e.pitches.forEach((p) => {
      if (open[p.midi]) { open[p.midi][2] += d; if (!e.tie) delete open[p.midi]; return; }
      const n = [+t.toFixed(4), p.midi, +(d * 1.02).toFixed(4), vel]; ev.push(n); if (e.tie) open[p.midi] = n;
    });
    t += d;
  }));
});
ev.sort((a, b) => a[0] - b[0]);
if (err) { const [k, wrong] = err.split(':').map(Number); const tgt = ev[k]; ev.push([tgt[0], wrong, tgt[2], tgt[3]]); ev.splice(k, 1); }   // replace the k-th note with a wrong one
fs.writeFileSync(out, JSON.stringify({ events: ev, tail: 2.5 }));
console.log(id, ev.length, 'notes,', (ev[ev.length - 1][0] + 2.5).toFixed(1), 's');
