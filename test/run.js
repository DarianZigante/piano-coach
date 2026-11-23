// End-to-end tests of ear + follower against rendered piano audio.
// usage: node test/run.js [filter] [--v] [--inst sal,sf2] [--cfg name]
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const { Ear, noteName } = require('../src/engine.js');
const { Follower } = require('../src/follower.js');
const { readWav } = require('./trace.js');

const args = process.argv.slice(2);
const filter = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--inst' && args[args.indexOf(a) - 1] !== '--cfg') || '';
const verbose = args.includes('--v');
const insts = (args.includes('--inst') ? args[args.indexOf('--inst') + 1] : 'sal,sf2').split(',');
const cfgSel = args.includes('--cfg') ? args[args.indexOf('--cfg') + 1] : null;

const CFGS = {
  clean: [],
  noisy: ['--noise', '-46', '--reverb', '0.5'],
  laptop: ['--hp', '140', '--noise', '-52', '--gain', '-18'],
  sr44: ['--sr', '44100', '--detune', '8'],
  quiet: ['--gain', '-30', '--noise', '-64'],
};

const R = (a) => ({ midi: a, staff: 0 }), L = (a) => ({ midi: a, staff: 1 });
function seq(stepNotes, dt, opts = {}) {
  // stepNotes: array of arrays of {midi, staff}; returns {steps, perf, onsets}
  const t0 = 0.6, hold = opts.hold || 1.0, vel = opts.vel || 0.7;
  const steps = stepNotes.map((ns) => ({ notes: ns }));
  const perf = [], onsets = [];
  let t = t0, jit = 0;
  stepNotes.forEach((ns, i) => {
    const d = Array.isArray(dt) ? dt[i % dt.length] : dt;
    onsets.push(t);
    ns.forEach((n, k) => {
      if (n.tied) return;
      const v = vel * (n.staff === 1 ? (opts.lhVel || 0.85) : 1) * (1 - 0.12 * ((i * 7 + k * 3) % 5) / 5);
      perf.push([+(t + (opts.spread || 0) * k).toFixed(4), n.midi, +(d * hold).toFixed(4), +v.toFixed(3)]);
    });
    t += d;
  });
  return { steps, perf, onsets };
}

const scenarios = [];
function add(name, build) { scenarios.push({ name, build }); }

const CMAJ = [60, 62, 64, 65, 67, 69, 71, 72];
add('scale-8ths', () => seq([...CMAJ, ...CMAJ.slice(0, 7).reverse()].map((m) => [R(m)]), 0.25));
add('scale-16ths', () => seq([...CMAJ, ...CMAJ.slice(0, 7).reverse()].map((m) => [R(m)]), 0.15));
add('scale-low', () => seq([36, 38, 40, 41, 43, 45, 47, 48, 47, 45, 43, 41, 40, 38, 36].map((m) => [L(m)]), 0.3));
add('scale-high', () => seq([72, 74, 76, 77, 79, 81, 83, 84, 86, 88, 89, 91].map((m) => [R(m)]), 0.25));
add('repeat-400', () => seq(Array(8).fill(0).map(() => [R(60)]), 0.4));
add('repeat-250', () => seq(Array(8).fill(0).map(() => [R(64)]), 0.25));
add('repeat-180', () => seq(Array(8).fill(0).map(() => [R(67)]), 0.18, { hold: 0.9 }));
add('repeat-low', () => seq(Array(6).fill(0).map(() => [L(43)]), 0.35));
add('repeat-pedal', () => seq(Array(6).fill(0).map(() => [R(72)]), 0.3, { hold: 3 }));
add('triads-lh', () => seq([[48, 52, 55], [53, 57, 60], [55, 59, 62], [48, 52, 55], [45, 48, 52], [50, 53, 57], [43, 47, 50, 53], [48, 52, 55]].map((c) => c.map(L)), 0.7));
add('triads-rh', () => seq([[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67], [64, 67, 72], [62, 65, 69], [59, 62, 67], [60, 64, 67]].map((c) => c.map(R)), 0.6));
add('chords-both', () => seq([[L(36), L(48), R(60), R(64), R(67)], [L(41), L(53), R(60), R(65), R(69)], [L(43), L(55), R(59), R(62), R(67)], [L(36), L(48), R(60), R(64), R(67)]], 0.9));
add('octaves-parallel', () => seq(CMAJ.map((m) => [L(m - 12), R(m)]), 0.4));
add('tenths-parallel', () => seq(CMAJ.map((m) => [L(m - 12), R(m + 4)]), 0.4));
add('melody-bass', () => seq([[L(48), R(76)], [R(74)], [L(43), R(72)], [R(74)], [L(45), R(76)], [R(76)], [L(41), R(77)], [R(76)], [L(48), R(79)], [R(72)]], 0.35, { hold: 1.6 }));
add('melody-over-chord', () => seq([[L(48), L(52), L(55), R(72)], [R(74)], [R(76)], [R(77)], [L(47), L(50), L(55), R(79)], [R(77)], [R(76)], [R(74)], [L(48), L(52), L(55), R(72)]], 0.3, { hold: 2.5 }));
add('alberti', () => { const lh = [48, 55, 52, 55, 48, 55, 52, 55, 47, 55, 50, 55, 48, 55, 52, 55]; const rh = { 0: 72, 4: 76, 8: 74, 12: 72 }; return seq(lh.map((m, i) => (rh[i] ? [L(m), R(rh[i])] : [L(m)])), 0.2, { hold: 1.2 }); });
add('prelude-c', () => { const bars = [[60, 64, 67, 72, 76], [60, 62, 69, 74, 77], [59, 62, 67, 74, 77], [60, 64, 67, 72, 76]]; const st = []; bars.forEach((b) => { for (let r = 0; r < 2; r++) { st.push([L(b[0])], [L(b[1])], [R(b[2])], [R(b[3])], [R(b[4])], [R(b[2])], [R(b[3])], [R(b[4])]); } }); return seq(st, 0.19, { hold: 5 }); });
add('fur-elise', () => seq([[R(76)], [R(75)], [R(76)], [R(75)], [R(76)], [R(71)], [R(74)], [R(72)], [L(45), R(69)], [L(52)], [L(57)], [R(60)], [R(64)], [R(69)], [L(40), R(71)], [L(52)], [L(56)], [R(64)], [R(68)], [R(71)], [L(45), R(72)]], 0.2, { hold: 1.8 }));
add('gymnopedie', () => seq([[L(43)], [L(59), L(62), L(66)], [L(38)], [L(57), L(61), L(66)], [L(43)], [L(59), L(62), L(66), R(78)], [R(81)], [L(38), R(79)], [L(57), L(61), L(66), R(78)], [R(73)]], 0.7, { hold: 2.2 }));
add('bass-deep', () => seq([[L(28)], [L(33)], [L(36)], [L(31)], [L(29)], [L(24 + 12)]], 0.6));
add('soft-loud', () => seq([[L(48), L(55), R(76)], [R(77)], [R(79)], [L(47), L(55), R(74)]], 0.5, { lhVel: 0.35, hold: 1.5 }));
add('rolled-chord', () => seq([[60, 64, 67, 72].map(R), [59, 62, 67, 74].map(R)], 1.0, { spread: 0.06 }));

// --- error scenarios: built from a base sequence plus a mutation
function withWrong(base, k, wrongMidi, opts = {}) {
  const s = base();
  const t = s.onsets[k], gap = opts.gap || 0.8;
  // shift everything from step k on by gap; insert the wrong attempt at t
  const perf = [];
  const stepMidis = s.steps[k].notes.map((n) => n.midi);
  s.perf.forEach((e) => { perf.push(e[0] >= t - 1e-6 ? [e[0] + gap, e[1], e[2], e[3]] : e); });
  const replace = opts.replace !== undefined ? opts.replace : stepMidis[stepMidis.length - 1];
  stepMidis.forEach((m) => { if (m === replace) { if (wrongMidi != null) perf.push([t, wrongMidi, 0.5, 0.7]); } else perf.push([t, m, 0.5, 0.7]); });
  s.perf = perf.sort((a, b) => a[0] - b[0]);
  s.error = { step: k, wrong: wrongMidi, time: t, fixTime: t + gap };
  s.onsets = s.onsets.map((o, i) => (i >= k ? o + gap : o));
  return s;
}
const baseScale = () => seq(CMAJ.map((m) => [R(m)]), 0.4);
add('err-semitone', () => withWrong(baseScale, 3, 66));            // F# instead of F
add('err-tone', () => withWrong(baseScale, 4, 69));                // A instead of G
add('err-octave-low', () => withWrong(baseScale, 2, 52));          // E3 instead of E4
add('err-octave-high', () => withWrong(baseScale, 2, 76));         // E5 instead of E4
add('err-fifth', () => withWrong(baseScale, 5, 76));
const baseChords = () => seq([[48, 52, 55], [53, 57, 60], [55, 59, 62], [48, 52, 55]].map((c) => c.map(L)), 0.9);
add('err-chord-wrong-third', () => withWrong(baseChords, 1, 56, { replace: 57 }));   // Ab instead of A
add('err-chord-missing', () => withWrong(baseChords, 2, null, { replace: 59 }));     // B left out
add('err-chord-missing-top', () => withWrong(baseChords, 1, null, { replace: 60 }));
const baseBoth = () => seq([[L(48), R(72)], [L(43), R(74)], [L(45), R(76)], [L(41), R(77)], [L(48), R(79)]], 0.6, { hold: 1.3 });
add('err-melody-wrong', () => withWrong(baseBoth, 2, 75, { replace: 76 }));
add('err-bass-wrong', () => withWrong(baseBoth, 3, 43, { replace: 41 }));
add('err-melody-missing', () => ({ ...withWrong(baseBoth, 2, null, { replace: 76 }), lenient: true }));
add('err-bass-missing', () => withWrong(baseBoth, 1, null, { replace: 43 }));
const baseOct = () => seq(CMAJ.slice(0, 5).map((m) => [L(m - 12), R(m)]), 0.6);
add('err-octave-missing-top', () => ({ ...withWrong(baseOct, 2, null, { replace: 64 }), lenient: true }));
add('err-octave-missing-bottom', () => withWrong(baseOct, 2, null, { replace: 52 }));


// --- whole library pieces, performed at 80% of the marked tempo
const PIECES = require('../src/pieces.js');
function pieceScenario(id, speed) {
  const piece = PIECES.library.find((p) => p.id === id), secPerDiv = 60 / (piece.tempo * speed) / 8;
  const at = new Map(), perf = [];
  [['rh', 0, 0.8], ['lh', 1, 0.65]].forEach(([hand, staff, vel]) => {
    let t = 0; const open = {};
    PIECES.parseHand(piece[hand]).forEach((bar) => bar.forEach((e) => {
      const d = e.dur * secPerDiv;
      if (!e.rest) e.pitches.forEach((pt) => {
        const key = Math.round(t * 1000);
        if (!at.has(key)) at.set(key, { t, notes: [] });
        const tied = !!open[pt.midi];
        at.get(key).notes.push({ midi: pt.midi, staff, tied });
        if (tied) { open[pt.midi][2] += d; if (!e.tie) delete open[pt.midi]; }
        else { const n = [+(t + 0.6).toFixed(4), pt.midi, +(d * 1.02).toFixed(4), vel]; perf.push(n); if (e.tie) open[pt.midi] = n; }
      });
      t += d;
    }));
  });
  const keys = [...at.keys()].sort((a, b) => a - b);
  return { steps: keys.map((k) => ({ notes: at.get(k).notes })), onsets: keys.map((k) => at.get(k).t + 0.6), perf: perf.sort((a, b) => a[0] - b[0]) };
}
PIECES.library.forEach((p) => add('piece-' + p.id, () => pieceScenario(p.id, 0.8)));

function render(sc, inst, cfgName) {
  const key = crypto.createHash('md5').update(JSON.stringify([sc.perf, inst, CFGS[cfgName]])).digest('hex').slice(0, 12);
  const wav = path.join(__dirname, '..', 'audio', `c_${key}.wav`);
  if (!fs.existsSync(wav)) {
    const js = path.join(__dirname, '..', 'audio', `c_${key}.json`);
    fs.writeFileSync(js, JSON.stringify({ events: sc.perf, tail: 1.2 }));
    cp.execFileSync('python3', [path.join(__dirname, '..', 'tools', 'render.py'), js, wav, '--inst', inst, ...CFGS[cfgName]], { stdio: 'pipe' });
  }
  return wav;
}

function runOne(sc, wav) {
  const { sr, x } = readWav(wav);
  const ear = new Ear({ sampleRate: sr });
  const fol = new Follower(ear);
  const log = [], done = [], wrongs = [];
  fol.cb.done = (i, st) => { done[i] = st.time; if (verbose) log.push(`${st.time.toFixed(3)} done step ${i}`); };
  fol.cb.wrong = (i, ms, exp) => { wrongs.push({ step: i, midis: ms, time: fol.now }); if (verbose) log.push(`${fol.now.toFixed(3)} WRONG at step ${i}: ${ms.map(noteName)} (wanted ${exp.map(noteName)})`); };
  if (verbose) { const on = ear.onNote; }
  if (args.includes('--frames')) { const a0 = +args[args.indexOf('--frames') + 1], a1 = +args[args.indexOf('--frames') + 2]; const pf = ear.onFrame; ear.onFrame = (f) => { if (f.time >= a0 && f.time <= a1) log.push(`${f.time.toFixed(3)} ${f.onset ? '*' : ' '} ` + [...f.notes.entries()].map(([m, i]) => `${noteName(m)}${i.indep ? '' : '~'}${i.virtual ? 'v' : ''}:${i.level.toFixed(0)}`).join(' ') + '   || peaks<700: ' + f.peaks.filter((p) => p.f < 700).map((p) => p.f.toFixed(0) + ':' + p.db.toFixed(0)).join(' ')); pf(f); }; }
  fol.load(sc.steps);
  let started = false;
  const B = 128;
  for (let i = 0; i + B <= x.length; i += B) {
    ear.push(x.subarray(i, i + B));
    if (!started && ear.samples / sr > 0.3) {
      started = true; fol.start(0);
      if (verbose) {
        const o1 = ear.onNote; ear.onNote = (e) => { log.push(`${e.time.toFixed(3)}   ${e.type} ${noteName(e.midi)}${e.indep ? '' : '~' + noteName(e.base)}${e.virtual ? 'v' : ''} L${e.level.toFixed(0)}${e.type === 'restrike' ? ' rise ' + e.rise.toFixed(0) + ' pre ' + e.pre.toFixed(0) : ''}${e.strikeOpen ? '' : ' (no strike)'}`); o1(e); };
        const o2 = ear.onStrike; ear.onStrike = (r) => { log.push(`${r.time.toFixed(3)}   strike report @${r.strike.toFixed(3)} strength ${r.strength.toFixed(1)}`); o2(r); };
      }
    }
  }
  // evaluate
  const res = { late: [], stuck: [], falseWrong: [], missedWrong: false, early: [] };
  const lat = [];
  sc.steps.forEach((st, i) => {
    if (!st.notes.some((n) => !n.tied)) return;
    if (done[i] === undefined) { res.stuck.push(i); return; }
    const d = done[i] - sc.onsets[i];
    lat.push(d);
    if (d > 0.3) res.late.push(`${i}(+${d.toFixed(2)})`);
    if (d < -0.02) res.early.push(`${i}(${d.toFixed(2)})`);
  });
  if (sc.error) {
    const e = sc.error;
    const got = wrongs.filter((w) => w.step === e.step && w.time < e.fixTime + 0.05);
    if (e.wrong != null && !got.length) res.missedWrong = true;
    wrongs.forEach((w) => { if (!(w.step === e.step && w.time < e.fixTime + 0.05)) res.falseWrong.push(`${w.step}:${w.midis.map(noteName)}`); });
    if (e.wrong != null && got.length && !got.some((w) => w.midis.includes(e.wrong))) res.misnamed = got.map((w) => w.midis.map(noteName).join('+')).join(',');
    // the step must not have been passed before the fix
    if (done[e.step] !== undefined && done[e.step] < e.fixTime - 0.05) { if (sc.lenient) { res.lenientPass = true; res.early = []; } else res.passedEarly = true; }
  } else {
    wrongs.forEach((w) => res.falseWrong.push(`${w.step}:${w.midis.map(noteName)}@${w.time.toFixed(2)}`));
  }
  res.meanLat = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0;
  res.ok = !res.late.length && !res.stuck.length && !res.falseWrong.length && !res.missedWrong && !res.passedEarly && !res.early.length;
  return { res, log };
}

let pass = 0, fail = 0;
const cfgs = cfgSel ? cfgSel.split(',') : Object.keys(CFGS);
const summary = [];
for (const sc0 of scenarios) {
  if (filter && !sc0.name.includes(filter)) continue;
  const sc = sc0.build();
  for (const inst of insts) for (const cfg of cfgs) {
    const wav = render(sc, inst, cfg);
    const { res, log } = runOne(sc, wav);
    const tag = `${sc0.name.padEnd(26)} ${inst.padEnd(4)} ${cfg.padEnd(7)}`; if (verbose) console.log("wav " + wav);
    if (res.ok) { pass++; if (verbose) console.log(`ok   ${tag} lat ${(res.meanLat * 1000).toFixed(0)}ms`); }
    else {
      fail++;
      const bits = [];
      if (res.stuck.length) bits.push('STUCK ' + res.stuck.join(','));
      if (res.late.length) bits.push('late ' + res.late.join(','));
      if (res.early.length) bits.push('EARLY ' + res.early.join(','));
      if (res.falseWrong.length) bits.push('FALSE-WRONG ' + res.falseWrong.join(' '));
      if (res.missedWrong) bits.push('missed-wrong');
      if (res.passedEarly) bits.push('PASSED-WITHOUT-NOTE');
      if (res.misnamed) bits.push('misnamed ' + res.misnamed);
      console.log(`FAIL ${tag} ${bits.join(' | ')}`);
    }
    if (verbose && (!res.ok || args.includes('--log'))) console.log(log.map((l) => '       ' + l).join('\n'));
    summary.push({ name: sc0.name, inst, cfg, ok: res.ok });
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
