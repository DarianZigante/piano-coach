/* PianoEar — polyphonic piano note detection for a single microphone.
 *
 * Feed it mono audio blocks (any size). For every hop it produces a frame:
 *   { time, db, onset, notes: Map(midi -> {level, indep, comb, base}) }
 * and a stream of note-on events through the tracker:
 *   { midi, time, level, indep, comb, base, restrike }
 *
 * How it works (the same family of techniques the commercial listening apps use):
 *  1. A long Hann-windowed FFT (about 170 ms) resolves individual partials.
 *  2. Peaks are picked against a local noise floor and refined by parabolic interpolation.
 *  3. Every piano key is tested for its fundamental plus supporting harmonics.
 *  4. Candidates are walked from the lowest note up. A candidate whose fundamental
 *     coincides with a harmonic of an accepted lower note is only kept if the comb of
 *     partials it would add stands out from that lower note's spectrum ("explaining away").
 *  5. A short-window spectral-flux detector marks hammer strikes, which lets the
 *     tracker tell a re-struck note from one that is simply still ringing.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PianoEar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function FFT(n) {
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (var i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    var bits = Math.round(Math.log2(n));
    for (var j = 0; j < n; j++) {
      var r = 0;
      for (var b = 0; b < bits; b++) r |= ((j >> b) & 1) << (bits - 1 - b);
      this.rev[j] = r;
    }
  }
  FFT.prototype.transform = function (re, im) {
    var n = this.n, rev = this.rev, cos = this.cos, sin = this.sin, i, j, k, t;
    for (i = 0; i < n; i++) {
      j = rev[i];
      if (j > i) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (var size = 2; size <= n; size <<= 1) {
      var half = size >> 1, step = n / size;
      for (i = 0; i < n; i += size) {
        for (j = i, k = 0; j < i + half; j++, k += step) {
          var tr = re[j + half] * cos[k] + im[j + half] * sin[k];
          var ti = -re[j + half] * sin[k] + im[j + half] * cos[k];
          re[j + half] = re[j] - tr; im[j + half] = im[j] - ti;
          re[j] += tr; im[j] += ti;
        }
      }
    }
  };

  function hann(n) {
    var w = new Float64Array(n);
    for (var i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    return w;
  }

  var DEFAULTS = {
    minMidi: 21,          // A0 — the full 88 keys
    maxMidi: 108,         // C8
    maxHarm: 10,
    fMax: 9000,
    prominence: 9,        // dB a partial must stand above the local floor
    candProm: 15,         // dB a fundamental must stand above the local floor
    candRange: 26,        // dB below the loudest peak a fundamental may sit
    dynRange: 50,         // dB below the loudest peak that still counts as a partial
    absFloor: -80,        // dBFS; nothing quieter than this is a partial
    candFloor: -68,       // dBFS; nothing quieter than this is a note
    tolLow: 32,           // cents below the nominal partial
    tolHigh: 32,          // cents above (grows with harmonic number: strings are stiff)
    combStrong: 5.0,      // dB: octave/twelfth doubling clearly present
    combWeak: 1.5,        // dB: below this the upper note is treated as "not shown"
    strikeThr: 0.10,      // strike-detector sensitivity (summed flux excess)
    tuneCents: 0
  };

  function Ear(opts) {
    opts = opts || {};
    this.sr = opts.sampleRate || 48000;
    this.o = {};
    for (var k in DEFAULTS) this.o[k] = opts[k] !== undefined ? opts[k] : DEFAULTS[k];
    this.N = opts.fftSize || (this.sr > 60000 ? 16384 : 8192);
    this.hop = opts.hop || (this.sr > 60000 ? 2048 : 1024);
    this.Ns = this.N / 4;
    this.fft = new FFT(this.N);
    this.ffts = new FFT(this.Ns);
    this.win = hann(this.N);
    this.wins = hann(this.Ns);
    this.winGain = 0; for (var i = 0; i < this.N; i++) this.winGain += this.win[i];
    this.winGain /= 2; // a full-scale sine reads 0 dB
    this.ring = new Float32Array(this.N);
    this.ringPos = 0; this.filled = 0; this.sinceHop = 0; this.samples = 0;
    this.re = new Float64Array(this.N); this.im = new Float64Array(this.N);
    this.res = new Float64Array(this.Ns); this.ims = new Float64Array(this.Ns);
    this.kMax = Math.min(this.N / 2 - 3, Math.ceil((this.o.fMax * this.N) / this.sr));
    this.kMin = Math.max(3, Math.floor((26 * this.N) / this.sr));
    this.db = new Float32Array(this.kMax + 3);
    this.floor = new Float32Array(this.kMax + 3);
    this.prevShort = null;
    this.fluxHist = [];
    this.lastO = 0; this.prevO = 0; this.prevEx = 0; this.lastOnsetFrame = -10;
    this.ambient = null;        // per-bin ambient noise level (dB), from calibrate()
    this.frameIndex = 0;
    this.tracker = new Tracker(this);
    this.onFrame = null;
    this.onStrike = null;
    this.onNote = null;
    this.context = new Set();   // notes the score says may be sounding (expected + still ringing)
    this.wanted = this.context;
    this._buildNotes();
  }

  Ear.prototype._buildNotes = function () {
    var o = this.o;
    this.notes = [];
    var Ns = this.Ns, kTop = Ns / 2 - 2;
    for (var n = o.minMidi; n <= o.maxMidi; n++) {
      var f0 = 440 * Math.pow(2, (n - 69 + o.tuneCents / 100) / 12);
      var H = Math.max(1, Math.min(o.maxHarm, Math.floor(o.fMax / f0)));
      var kb = [];
      for (var h = 1; h <= 4; h++) { var k = Math.round((h * f0 * Ns) / this.sr); kb.push(k >= 2 && k <= kTop ? k : -1); }
      this.notes.push({ midi: n, f0: f0, H: H, kb: kb });
    }
    this.nNotes = this.notes.length;
    this.SH = 20;                                   // frames of short-level history
    this.sHist = new Float32Array(this.SH * this.nNotes * 4).fill(-140);
    this.sPos = 0;
  };
  // context: every note the score says may be sounding; now: the ones wanted at this moment
  Ear.prototype.setContext = function (set, now) { this.context = set || new Set(); this.wanted = now || this.context; };
  Ear.prototype.setTuning = function (cents) { this.o.tuneCents = cents; this._buildNotes(); };

  Ear.prototype.push = function (block) {
    var N = this.N, ring = this.ring;
    for (var i = 0; i < block.length; i++) {
      ring[this.ringPos] = block[i];
      this.ringPos = (this.ringPos + 1) % N;
      this.samples++;
      if (this.filled < N) this.filled++;
      if (++this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        if (this.filled >= N) this._frame();
      }
    }
  };

  Ear.prototype._frame = function () {
    var N = this.N, Ns = this.Ns, ring = this.ring, pos = this.ringPos, i, k;
    var re = this.re, im = this.im, win = this.win;
    var sum = 0;
    for (i = 0; i < N; i++) {
      var s = ring[(pos + i) % N];
      re[i] = s * win[i]; im[i] = 0;
    }
    // loudness of the most recent quarter window
    for (i = N - Ns; i < N; i++) { var v = ring[(pos + i) % N]; sum += v * v; }
    var rmsDb = 10 * Math.log10(sum / Ns + 1e-12);
    this.fft.transform(re, im);
    var db = this.db, g = this.winGain, kMax = this.kMax;
    for (k = 0; k <= kMax + 2; k++) {
      var m2 = (re[k] * re[k] + im[k] * im[k]) / (g * g);
      db[k] = 10 * Math.log10(m2 + 1e-14);
    }
    var nl = this.nfLong;
    if (!nl) { nl = this.nfLong = new Float32Array(kMax + 3); for (k = 0; k <= kMax + 2; k++) nl[k] = db[k]; }
    for (k = 0; k <= kMax + 2; k++) nl[k] = db[k] < nl[k] ? db[k] : nl[k] + 0.012;   // rises ~0.6 dB/s
    this._floor();
    var peaks = this._peaks();
    var notes = this._notes(peaks);

    // short window: strike detector
    var rs = this.res, is = this.ims, ws = this.wins;
    for (i = 0; i < Ns; i++) { rs[i] = ring[(pos + N - Ns + i) % N] * ws[i]; is[i] = 0; }
    this.ffts.transform(rs, is);
    var k0 = Math.floor((90 * Ns) / this.sr), k1 = Math.min(Ns / 2 - 1, Math.floor((8000 * Ns) / this.sr));
    if (!this.curShort) { this.curShort = new Float32Array(Ns / 2); this.prevShort = new Float32Array(Ns / 2); }
    if (!this.pShort) { this.pShort = new Float32Array(Ns / 2); this.nfShort = null; }
    var cur = this.curShort, prev = this.prevShort, flux = 0, pS = this.pShort, sg = (Ns / 4) * (Ns / 4);
    for (k = 0; k < Ns / 2; k++) pS[k] = (rs[k] * rs[k] + is[k] * is[k]) / sg + 1e-16;
    // Noise floor per bin by minimum statistics: drops at once to the quietest level seen,
    // creeps back up slowly. Makes the strike detector independent of microphone gain.
    var nf = this.nfShort;
    if (!nf) { nf = this.nfShort = new Float32Array(Ns / 2); for (k = 0; k < Ns / 2; k++) nf[k] = pS[k]; }
    for (k = k0; k <= k1; k++) {
      var pv = pS[k];
      nf[k] = pv < nf[k] ? pv : nf[k] * 1.004;
      var c = Math.log(1 + 0.2 * Math.sqrt(pv / nf[k]));
      var d = c - prev[k];
      if (d > 0) flux += d;
      cur[k] = c;
    }
    // short-window level of the first four partials of every key
    var nN = this.nNotes, sH = this.sHist, base = this.sPos * nN * 4, nl = this.notes;
    for (i = 0; i < nN; i++) {
      var kb = nl[i].kb;
      for (var hh = 0; hh < 4; hh++) {
        var kk = kb[hh];
        sH[base + i * 4 + hh] = kk < 0 ? -140 : 10 * Math.log10(pS[kk - 1] + pS[kk] + pS[kk + 1] + 1e-14);
      }
    }
    this.sPos = (this.sPos + 1) % this.SH;
    this.curShort = prev; this.prevShort = cur;
    flux /= (k1 - k0 + 1);
    // Strike detector: flux above its running median, summed over two frames (a strike
    // often straddles a frame boundary), then peak-picked one frame late.
    var hist = this.fluxHist;
    var sorted = hist.slice().sort(function (a, b) { return a - b; });
    var med = sorted.length ? sorted[sorted.length >> 1] : flux;
    var ex = Math.max(0, flux - med);
    var O = ex + this.prevEx;                      // strength at this frame
    var onset = this.lastO >= this.o.strikeThr && this.lastO >= O && this.lastO > this.prevO && this.frameIndex - this.lastOnsetFrame >= 3;
    if (onset) { this.lastOnsetFrame = this.frameIndex; this.onsetStrength = this.lastO; }
    hist.push(flux); if (hist.length > 40) hist.shift();
    this.prevO = this.lastO; this.lastO = O; this.prevEx = ex;

    var time = this.samples / this.sr;
    var frame = { index: this.frameIndex++, time: time, db: rmsDb, onset: onset, flux: flux, notes: notes, peaks: peaks };
    this.tracker.update(frame);
    if (this.onFrame) this.onFrame(frame);
  };

  // local noise floor: 35th percentile over a sliding window, evaluated every 4 bins
  Ear.prototype._floor = function () {
    var db = this.db, fl = this.floor, kMax = this.kMax, W = Math.max(8, Math.round((110 * this.N) / this.sr));
    var buf = [], step = 4, k, j;
    var pts = [];
    for (k = 0; k <= kMax + 2; k += step) {
      buf.length = 0;
      var a = Math.max(1, k - W), b = Math.min(kMax + 2, k + W);
      for (j = a; j <= b; j += 2) buf.push(db[j]);
      buf.sort(function (x, y) { return x - y; });
      pts.push(buf[Math.floor(buf.length * 0.35)]);
    }
    for (k = 0; k <= kMax + 2; k++) {
      var p = k / step, i0 = Math.floor(p), i1 = Math.min(pts.length - 1, i0 + 1), t = p - i0;
      var v = pts[Math.min(i0, pts.length - 1)] * (1 - t) + pts[i1] * t;
      if (this.ambient) { var amb = this.ambient[k] + 6; if (amb > v) v = amb; }
      fl[k] = v;
    }
  };

  Ear.prototype._peaks = function () {
    var db = this.db, fl = this.floor, o = this.o, kMin = this.kMin, kMax = this.kMax, k;
    var max = -200;
    for (k = kMin; k <= kMax; k++) if (db[k] > max) max = db[k];
    this.maxDb = max;
    this.refMax = Math.max(max, (this.refMax === undefined ? max : this.refMax) - 0.2);   // falls ~9 dB/s
    var thrAbs = max - o.dynRange, nl = this.nfLong;
    var peaks = [];
    for (k = kMin; k <= kMax; k++) {
      var b = db[k];
      if (b < thrAbs || b - fl[k] < o.prominence || b < nl[k] + 10) continue;
      if (b <= db[k - 1] || b < db[k + 1] || b < db[k - 2] || b < db[k + 2]) continue;
      var a = db[k - 1], c = db[k + 1];
      var den = a - 2 * b + c, dlt = den !== 0 ? (0.5 * (a - c)) / den : 0;
      if (dlt > 0.5) dlt = 0.5; if (dlt < -0.5) dlt = -0.5;
      peaks.push({ f: ((k + dlt) * this.sr) / this.N, db: b - 0.25 * (a - c) * dlt, k: k, prom: b - fl[k] });
    }
    return peaks; // ascending frequency
  };

  function findPeak(peaks, fLo, fHi) {
    var lo = 0, hi = peaks.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (peaks[mid].f < fLo) lo = mid + 1; else hi = mid; }
    var best = -1;
    for (var i = lo; i < peaks.length && peaks[i].f <= fHi; i++) if (best < 0 || peaks[i].db > peaks[best].db) best = i;
    return best;
  }

  Ear.prototype._notes = function (peaks) {
    var o = this.o, out = new Map(), list = this.notes, binHz = this.sr / this.N;
    this._lastPeaks = peaks;
    if (!peaks.length) return out;
    var cands = [], ctx = this.context, maxDb = this.maxDb, self = this;
    var candMin = maxDb - o.candRange;
    var quiet = this.refMax - 40;          // nothing this far below recent playing is a note
    var missing = [];                      // context notes whose fundamental is not showing
    for (var i = 0; i < list.length; i++) {
      var nt = list[i], H = nt.H, part = new Array(H + 2), idx = new Array(H + 2), found = 0, loose = false;
      for (var h = 1; h <= H; h++) {
        var f = nt.f0 * h;
        var tl = o.tolLow, th = o.tolHigh + Math.min(45, 0.7 * h * h);
        var fLo = f * Math.pow(2, -tl / 1200), fHi = f * Math.pow(2, th / 1200);
        if (f - fLo < 0.22 * binHz) fLo = f - 0.22 * binHz;   // never tighter than a fraction of a bin
        if (fHi - f < 0.22 * binHz) fHi = f + 0.22 * binHz;
        // A wanted bass note: its fundamental is smeared by neighbours and by the attack, so
        // look a little wider (its harmonics still have to line up exactly).
        var p = findPeak(peaks, fLo, fHi);
        if (p < 0 && h === 1 && nt.f0 < 131 && ctx.has(nt.midi)) { p = findPeak(peaks, f - 0.8 * binHz, f + 0.8 * binHz); if (p >= 0) loose = true; }
        idx[h] = p; part[h] = p >= 0 ? peaks[p].db : -Infinity;
        if (p >= 0) found++;
      }
      part[H + 1] = -Infinity; idx[H + 1] = -1;
      var inCtx = ctx.has(nt.midi);
      var hasF = idx[1] >= 0 && part[1] >= quiet && (inCtx ? (peaks[idx[1]].prom >= 12 && part[1] >= maxDb - 30) : (peaks[idx[1]].prom >= o.candProm && part[1] >= candMin));
      var rec = { midi: nt.midi, f0: nt.f0, H: H, part: part, idx: idx, level: part[1], found: found, virtual: false };
      if (hasF) {
        var sMin = maxDb - 42;
        var support = (H >= 2 && idx[2] >= 0 && part[2] >= sMin && peaks[idx[2]].prom >= 11) || (H >= 3 && idx[3] >= 0 && part[3] >= sMin && peaks[idx[3]].prom >= 11);
        var lone = peaks[idx[1]].prom >= 26 && part[1] >= maxDb - 22;
        if (!support && !(H < 2 || lone || nt.midi > 88)) continue;
        // found only by the wider search: both the 2nd and 3rd harmonic must sit exactly right
        if (loose && !(idx[2] >= 0 && idx[3] >= 0 && part[2] >= sMin && part[3] >= sMin)) continue;
        // a fundamental far weaker than its overtones says little about loudness: go by them
        if (H >= 3 && idx[2] >= 0 && idx[3] >= 0 && part[1] < Math.max(part[2], part[3]) - 12) rec.level = Math.max(part[2], part[3]) - 6;
        cands.push(rec);
      } else if (inCtx && nt.midi <= 60 && H >= 5) missing.push(rec);
    }
    // Context notes with no visible fundamental (a room null, small speakers, a deep bass
    // note): accept on the harmonic series, as long as the evidence is not simply the
    // overtones of other notes that are sounding right now.
    if (missing.length) {
      var owners = cands.filter(function (c) { return ctx.has(c.midi); });
      var owned = function (selfMidi, f) {
        for (var k = 0; k < owners.length; k++) {
          if (owners[k].midi === selfMidi) continue;
          var r = f / owners[k].f0, hh = Math.round(r);
          if (hh >= 1 && hh <= 8 && Math.abs(1200 * Math.log2(r / hh)) < 45) return true;
        }
        return false;
      };
      var added = false;
      for (var m2 = 0; m2 < missing.length; m2++) {
        var v = missing[m2], vp = v.part, vi = v.idx, lim = Math.max(maxDb - 28, quiet);
        // The 2nd harmonic must be there. The 3rd must not be missing when nothing else would
        // account for it (that pattern is the octave above, not this note). And at least one
        // of harmonics 2, 3, 5 must be something no other sounding note explains.
        if (vi[2] < 0 || vp[2] < lim) continue;
        var own2 = owned(v.midi, v.f0 * 2), own3 = owned(v.midi, v.f0 * 3);
        var has3 = vi[3] >= 0 && vp[3] >= lim + 4 && peaks[vi[3]].prom >= 12;
        if (!own3 && !has3) continue;
        var has5 = v.H >= 5 && vi[5] >= 0 && vp[5] >= lim + 4 && peaks[vi[5]].prom >= 12 && !owned(v.midi, v.f0 * 5);
        if (own2 && !(has3 && !own3) && !has5) continue;
        v.virtual = true; v.level = (has3 && vp[3] > vp[2] ? vp[3] : vp[2]) - 6;
        cands.push(v); added = true;
      }
      if (added) cands.sort(function (x, y) { return x.midi - y.midi; });
    }
    // explain-away, lowest first
    var accepted = [];
    for (var c = 0; c < cands.length; c++) {
      var cd = cands[c], comb = Infinity, base = -1, explained = false, bases = [];
      var pk = cd.virtual || cd.idx[1] < 0 ? null : peaks[cd.idx[1]];
      if (pk) {
        for (var a = 0; a < accepted.length; a++) {
          var m = accepted[a];
          var r = pk.f / m.f0, hh = Math.round(r);
          if (hh < 2 || hh > (m.f0 < 131 ? 40 : 24)) continue;
          var cents = 1200 * Math.log2(r / hh);
          if (cents < -o.tolLow || cents > o.tolHigh + Math.min(70, 0.7 * hh * hh)) continue;
          var D = this._comb(m, hh, cd);
          // far up a bass note's series the partials are weak and crowded: a key actually
          // struck there towers over its neighbours
          if (hh > 10 && D >= 10) continue;
          explained = true; bases.push(m.midi);
          if (base < 0 || (m.indep && D < comb)) base = m.midi;
          if (D < comb) comb = D;
        }
      }
      var indep = !explained;   // a note sitting on a lower note's harmonic is never independent evidence
      cd.indep = indep; cd.comb = explained ? comb : null; cd.base = base;
      accepted.push(cd);   // shadows explain their own overtones too
      // Is a lower octave or twelfth just emerging underneath? (Low fundamentals settle a
      // frame or two after their overtones do.)
      var sub = false;
      if (indep && pk) {
        for (var dv = 2; dv <= 3 && !sub; dv++) {
          var fs = cd.f0 / dv, ps = findPeak(peaks, fs * 0.955, fs * 1.045);
          if (ps >= 0 && peaks[ps].db >= cd.level - 12) sub = true;
        }
      }
      cd.sub = sub;
      out.set(cd.midi, { level: cd.level, indep: indep, comb: cd.comb, base: base, bases: bases, found: cd.found, virtual: cd.virtual, sub: sub });
    }
    return out;
  };

  // Is frequency f a low harmonic of some context note other than `self`?
  Ear.prototype._ownedByContext = function (self, f) {
    var tune = Math.pow(2, this.o.tuneCents / 1200), hit = false, wanted = this.wanted, act = this.tracker.active;
    this.context.forEach(function (m) {
      if (hit || m === self) return;
      if (!wanted.has(m) && !act.has(m)) return;      // only notes that are due now or actually sounding
      var f0 = 440 * Math.pow(2, (m - 69) / 12) * tune, r = f / f0, h = Math.round(r);
      if (h < 1 || h > 8) return;
      if (Math.abs(1200 * Math.log2(r / h)) < 45) hit = true;
    });
    return hit;
  };

  // How far partial h of note m stands above its two neighbours — the extra energy a
  // second note whose fundamental sits on that partial would add.
  Ear.prototype._comb = function (m, h, cd) {
    var thr = this.maxDb - this.o.dynRange;
    function L(j) { return j >= 1 && j <= m.H && m.part[j] > -Infinity ? m.part[j] : null; }
    var c = L(h); if (c === null) c = cd.level;
    var a = L(h - 1), b = L(h + 1), nb;
    if (h > m.H) {
      var pk = this._lastPeaks, pa = findPeak(pk, m.f0 * (h - 1) * 0.985, m.f0 * (h - 1) * 1.03), pb = findPeak(pk, m.f0 * (h + 1) * 0.985, m.f0 * (h + 1) * 1.03);
      a = pa >= 0 ? pk[pa].db : null; b = pb >= 0 ? pk[pb].db : null;
    }
    if (a === null && b === null) nb = thr; else if (a === null) nb = Math.max(b, thr); else if (b === null) nb = Math.max(a, thr); else nb = Math.max(a, b);
    return c - nb;
  };

  // Ambient calibration: call with the engine running in a quiet room.
  Ear.prototype.snapshotAmbient = function () {
    this.ambient = new Float32Array(this.db.length);
    for (var k = 0; k < this.db.length; k++) this.ambient[k] = this.db[k];
  };

  // Short-window level of partial h (0-based) of note index i, `back` frames ago (0 = newest).
  Ear.prototype._short = function (i, h, back) {
    var SH = this.SH;
    return this.sHist[((this.sPos - 1 - back + 4 * SH) % SH) * this.nNotes * 4 + i * 4 + h];
  };

  /* ---------- tracker: frames -> note events and strike reports ----------
   * 'new'      a key that was silent is now sounding (seen in the long window)
   * 'restrike' a key that was already sounding was struck again: its own partials jumped
   *            in the short window at a hammer strike, and it is not simply fading
   * onStrike   fired once per hammer strike after the spectrum has settled, with the
   *            levels from just before the strike — used for notes that hide behind
   *            something still ringing
   */
  function Tracker(ear) {
    this.ear = ear;
    this.frameDur = ear.hop / ear.sr;
    this.hist = [];
    this.queue = [];
    this.active = new Map();     // midi -> {level, indep, comb, base, virtual, since}
    this.st = new Map();
    this.lastStrike = -10; this.lastStrikeIdx = -10;
    this.settle = Math.max(3, Math.round(0.10 / this.frameDur));
  }
  Tracker.prototype.reset = function () { this.hist.length = 0; this.queue.length = 0; this.active.clear(); this.st.clear(); this.lastStrike = -10; };
  Tracker.prototype.update = function (frame) {
    var ear = this.ear, t = frame.time, self = this, hist = this.hist, fd = this.frameDur;
    hist.push(frame); if (hist.length > 20) hist.shift();
    if (frame.onset) {
      var idx = frame.index - 1, q = this.queue;
      this.lastStrike = t - fd; this.lastStrikeIdx = idx;
      var str = ear.onsetStrength / ear.o.strikeThr;
      if (!q.length || idx - q[q.length - 1].idx >= 3) q.push({ idx: idx, at: idx + this.settle, strength: str });
      else if (str > q[q.length - 1].strength) q[q.length - 1].strength = str;   // same strike, seen first by a wanted key
    }
    // A soft or masked strike the flux detector let through: if a wanted key's own bins
    // jump in the short window, treat that as a strike too.
    var want = ear.wanted, lastQ = this.queue.length ? this.queue[this.queue.length - 1].idx : this.lastStrikeIdx;
    if (!frame.onset && want && want.size && frame.index - lastQ >= 5) {
      var local = false, lo = ear.o.minMidi, n88 = ear.nNotes, floorL = frame.db - 40;
      want.forEach(function (m) {
        var i = m - lo; if (local || i < 0 || i >= n88 || ear.notes[i].kb[0] < 0) return;
        var now = Math.min(ear._short(i, 0, 0), ear._short(i, 0, 1)), before = Math.max(ear._short(i, 0, 3), ear._short(i, 0, 4));
        if (now >= floorL && now - before >= 6) local = true;
      });
      if (local) {
        var li = frame.index - 2;
        this.lastStrike = t - 2 * fd; this.lastStrikeIdx = li;
        this.queue.push({ idx: li, at: li + this.settle, strength: 0 });
      }
    }
    frame.notes.forEach(function (info, midi) {
      var s = self.st.get(midi);
      if (!s) { s = { on: false, run: 0, last: -10, offTime: -10, offLevel: -200, since: t, level: -200 }; self.st.set(midi, s); }
      s.run = t - s.last < fd * 1.5 ? s.run + 1 : 1;
      s.last = t; s.info = info;
      if (!s.on && s.run >= (info.level >= ear.maxDb - 18 ? 2 : 3) && !(info.sub && s.run < 6)) {
        // A note that dropped out briefly and returns no louder was ringing all along.
        // During a hammer strike only a very short dropout is forgiven; otherwise the
        // strike is taken as the reason it is back.
        var gap = t - s.offTime, open = t - self.lastStrike < 0.28;
        var flicker = info.level < s.offLevel + 3 && gap < (open ? 0.15 : 1.0);
        s.on = true;
        if (!flicker) {
          s.since = t - fd; s.emitAt = t;
          if (ear.onNote) ear.onNote({ type: 'new', midi: midi, time: t, level: info.level, indep: info.indep, comb: info.comb, base: info.base, bases: info.bases, virtual: info.virtual, strikeOpen: open, strikeIdx: self.lastStrikeIdx, gap: gap });
        }
      }
      s.level = info.level;
      if (s.on) self.active.set(midi, { level: info.level, indep: info.indep, comb: info.comb, base: info.base, bases: info.bases, virtual: info.virtual, since: s.since });
    });
    this.st.forEach(function (s, midi) {
      if (s.last === t) return;
      if (s.on && t - s.last > 0.10) { s.on = false; s.offTime = t; s.offLevel = s.level; self.active.delete(midi); }
      if (!s.on && t - s.last > 3) self.st.delete(midi);
    });
    // Each strike stays open for about a quarter of a second: notes are judged against it
    // as soon as they show (some blink out during the attack and only return afterwards).
    var q2 = this.queue;
    while (q2.length && frame.index > q2[0].idx + 12) q2.shift();
    for (var qi = 0; qi < q2.length; qi++) if (q2[qi].at <= frame.index) this._report(q2[qi], frame);
  };
  Tracker.prototype._report = function (sk, frame) {
    var ear = this.ear, hist = this.hist, back = frame.index - sk.idx, self = this;
    if (!sk.judged) {
      sk.judged = new Set(); sk.pre = new Map();
      for (var j = hist.length - 1; j >= 0; j--) if (hist[j].index === sk.idx - 2) { sk.pre = hist[j].notes; break; }
    }
    var minMidi = ear.o.minMidi, strikeTime = frame.time - back * this.frameDur, floorDb = frame.db - 40;
    frame.notes.forEach(function (info, midi) {
      if (sk.judged.has(midi)) return;
      var was = sk.pre.get(midi), lPre = was ? was.level : -200, s0 = self.st.get(midi);
      if (lPre < -150) {
        // Was not sounding just before the strike. Normally the 'new' event covers it — but a
        // note that dropped out for only an instant never produced one.
        if (s0 && s0.on && !(s0.emitAt >= strikeTime - 0.05)) {
          sk.judged.add(midi); s0.since = strikeTime; s0.emitAt = frame.time;
          if (ear.onNote) ear.onNote({ type: 'new', midi: midi, time: frame.time, level: info.level, indep: info.indep, comb: info.comb, base: info.base, bases: info.bases, virtual: info.virtual, strikeOpen: true, strikeIdx: sk.idx, gap: 0 });
        }
        return;
      }
      var d = info.level - lPre, direct, r0 = 0;
      if (info.virtual || midi < 60) {
        // low keys: the short window cannot tell neighbours apart, so go by the long window —
        // clearly louder than just before the strike
        direct = d >= 1.5;
      } else {
        var i = midi - minMidi, kb = ear.notes[i].kb, n = 0, avail = 0;
        for (var h = 0; h < 4; h++) {
          if (kb[h] < 0) continue;
          avail++;
          var before = Math.max(ear._short(i, h, back + 2), ear._short(i, h, back + 3));
          var after = Math.min(ear._short(i, h, 0), ear._short(i, h, 1));       // must still be up now
          if (h === 0) r0 = after - before;
          if (after >= floorDb && after - before >= 3) n++;
        }
        direct = r0 >= 3 && (n >= 2 || avail < 2);
        if (direct && d > -2.2 && d < -0.1) direct = false;   // an unstruck string simply keeps fading
        if (!direct && d >= 5) direct = true;                 // clearly louder than before the strike
      }
      if (!direct) return;
      sk.judged.add(midi);
      if (s0) { s0.since = strikeTime; s0.emitAt = frame.time; }
      if (ear.onNote) ear.onNote({ type: 'restrike', midi: midi, time: frame.time, strike: strikeTime, strikeIdx: sk.idx, level: info.level, indep: info.indep, comb: info.comb, base: info.base, bases: info.bases, virtual: info.virtual, rise: r0 || d, pre: lPre, strikeOpen: true });
    });
    if (!sk.reported) {
      sk.reported = true;
      var pre = new Map();
      sk.pre.forEach(function (v, m) { pre.set(m, v.level); });
      if (ear.onStrike) ear.onStrike({ time: frame.time, strike: strikeTime, strikeIdx: sk.idx, pre: pre, max: ear.maxDb, strength: sk.strength });
    }
  };

  var NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  function noteName(m) { return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

  return { Ear: Ear, FFT: FFT, noteName: noteName };
});
