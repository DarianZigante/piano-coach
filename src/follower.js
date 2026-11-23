/* Follower — score-following logic for "wait" practice.
 *
 * steps: [{ notes: [{midi, staff, tied}], ... }]   (staff 0 = right hand, 1 = left hand)
 *
 * It consumes strike reports from PianoEar and decides, for the step under the cursor,
 * which notes were played, which strikes were mistakes, and when to move on.
 *
 * Decision rules, in order, for every strike:
 *  1. A wanted note with its own strike evidence counts — unless it only shows up as an
 *     overtone of a wrong lower note.
 *  2. A wanted note hidden behind a note that is still ringing (same pitch, or an octave
 *     or other pure interval below) cannot show clean evidence. If the strike is not
 *     accounted for by anything outside the step, it gets the benefit of the doubt.
 *  3. A new note that is in nobody's harmonic series and is not part of the music here
 *     is a mistake.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PianoFollower = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function Follower(ear, opts) {
    opts = opts || {};
    this.ear = ear;
    this.steps = [];
    this.hands = 'both';
    this.index = -1;
    this.running = false;
    this.cb = {};
    this.wrongDelay = opts.wrongDelay || 0.11;    // time a stray note must persist before it counts
    this.earlyWindow = opts.earlyWindow || 0.40;  // a next-step note played this early is carried over
    this.ringTime = opts.ringTime || 3.0;         // how long earlier notes are assumed to keep sounding
    this.minMidi = ear.o.minMidi; this.maxMidi = ear.o.maxMidi;
    this.legit = new Map();     // midi -> last time it was legitimately played
    this.pending = [];          // stray notes waiting to be confirmed
    this.early = [];            // next-step notes played slightly early
    this.hit = new Set();
    this.expected = []; this.nextExpected = []; this.allowed = new Set();
    this.stepStart = 0; this.now = 0; this.doneFrame = -1; this.holdAt = -1;
    this.stats = [];
    var self = this;
    this.outside = [];          // recent strikes on notes that are not part of the current step
    ear.onNote = function (e) { self._note(e); };
    ear.onStrike = function (r) { self._strike(r); };
    var prev = ear.onFrame;
    ear.onFrame = function (f) { self._tick(f); if (prev) prev(f); };
  }

  Follower.prototype.load = function (steps) { this.steps = steps; this.index = -1; this.stats = steps.map(function () { return null; }); };
  Follower.prototype.setHands = function (h) { this.hands = h; };

  Follower.prototype._wanted = function (i) {
    var st = this.steps[i], out = [], hands = this.hands;
    if (!st) return out;
    for (var k = 0; k < st.notes.length; k++) {
      var n = st.notes[k];
      if (n.tied) continue;
      if (hands === 'right' && n.staff !== 0) continue;
      if (hands === 'left' && n.staff !== 1) continue;
      if (n.midi < this.minMidi || n.midi > this.maxMidi) continue;   // outside what a microphone can follow
      if (out.indexOf(n.midi) < 0) out.push(n.midi);
    }
    return out;
  };
  Follower.prototype._all = function (i) {
    var st = this.steps[i], out = [];
    if (st) for (var k = 0; k < st.notes.length; k++) out.push(st.notes[k].midi);
    return out;
  };
  Follower.prototype.nextPlayable = function (i, end) {
    var last = end === undefined ? this.steps.length - 1 : end;
    while (i <= last && this._wanted(i).length === 0) i++;
    return i <= last ? i : -1;
  };

  Follower.prototype.start = function (from, to) {
    this.rangeEnd = to === undefined ? this.steps.length - 1 : to;
    this.legit.clear(); this.pending.length = 0; this.early.length = 0; this.outside.length = 0; this.doneFrame = -1; this.holdAt = -1;
    this.stats = this.steps.map(function () { return null; });
    var i = this.nextPlayable(from || 0, this.rangeEnd);
    if (i < 0) { this.running = false; return false; }
    this.running = true;
    this._enter(i);
    return true;
  };
  Follower.prototype.stop = function () { this.running = false; };

  Follower.prototype._enter = function (i) {
    this.index = i;
    this.expected = this._wanted(i);
    this.hit = new Set();
    this.stepStart = this.now;
    this.mistakes = 0; this.holdAt = -1; this.tries = 0;
    var nx = this.nextPlayable(i + 1, this.rangeEnd);
    this.nextExpected = nx >= 0 ? this._wanted(nx) : [];
    this._context();
    if (this.cb.step) this.cb.step(i, this.expected.slice());
    // notes for this step that were struck a touch early
    var early = this.early; this.early = [];
    for (var k = 0; k < early.length; k++) {
      var e = early[k];
      if (!(this.now - e.time < this.earlyWindow + 0.25) || this.expected.indexOf(e.midi) < 0 || !this.running || this.index !== i) continue;
      var a = this.ear.tracker.active.get(e.midi);
      if (a && a.indep && a.comb === null) this._hit(e.midi, this.now);   // still a note in its own right
    }
  };

  Follower.prototype._context = function () {
    var ctx = new Set(this.expected), now = this.now, ring = this.ringTime;
    this._all(this.index).forEach(function (m) { ctx.add(m); });
    this.legit.forEach(function (t, m) { if (now - t < ring) ctx.add(m); });
    this.allowed = ctx;
    this.ear.setContext(ctx, new Set(this._all(this.index)));
  };

  Follower.prototype._hit = function (m, time) {
    if (this.hit.has(m)) return;
    this.hit.add(m); this.legit.set(m, time);
    if (this.cb.hit) this.cb.hit(this.index, m);
    this._check(time);
  };

  Follower.prototype._belongs = function (e) {
    // Independent evidence — or sitting on a harmonic of a note that belongs here and
    // loud enough to plausibly be a struck key rather than just that overtone.
    if (e.indep || e.virtual) return true;
    var b = e.bases || [], ok = false;
    for (var i = 0; i < b.length; i++) if (this.allowed.has(b[i]) || this.expected.indexOf(b[i]) >= 0) ok = true;
    return ok && e.level >= this.ear.maxDb - 15;
  };

  // Does key m sit on a harmonic (2nd to 12th) of a note wanted right now?
  Follower.prototype._overtone = function (m) {
    var exp = this.expected;
    for (var i = 0; i < exp.length; i++) {
      var r = Math.pow(2, (m - exp[i]) / 12), h = Math.round(r);
      if (h >= 2 && h <= 12 && Math.abs(1200 * Math.log2(r / h)) < 50) return true;
    }
    return false;
  };
  Follower.prototype._loudest = function () {
    var loud = -200; this.ear.tracker.active.forEach(function (v) { if (v.level > loud) loud = v.level; });
    return loud;
  };

  Follower.prototype._note = function (e) {
    if (!this.running) return;
    var m = e.midi;
    if (this.expected.indexOf(m) >= 0) {
      // a re-strike only counts if the hammer fell after the previous step was completed
      if (e.type === 'restrike' && e.strikeIdx < this.doneFrame) return;
      // an overtone that surfaces late from the strike that finished the previous step
      if (e.type === 'new' && !e.indep && !e.virtual && e.strikeOpen && e.strikeIdx < this.doneFrame) return;
      // a note inferred from its overtones alone has to arrive with a fresh hammer strike
      if (e.virtual && !(e.strikeOpen && e.strikeIdx >= this.doneFrame)) return;
      // so does a faint one: weak peaks keep surfacing for a while after any strike
      if (e.type === 'new' && e.level < this.ear.maxDb - 12 && !(e.strikeIdx >= this.doneFrame)) return;
      // and anything that surfaces while the strike that finished the last step is still open
      if (e.type === 'new' && e.strikeOpen && e.strikeIdx < this.doneFrame) return;
      if (!this.hit.has(m) && this._belongs(e)) this._hit(m, e.time);
      return;
    }
    if (!e.indep || e.virtual) return;
    var inStep = this._all(this.index).indexOf(m) >= 0;
    if (!inStep) this.outside.push({ midi: m, time: e.time });
    // Still ringing from earlier, or the other hand's note: let it be — unless it had
    // fallen silent and has clearly been played again.
    if (this.allowed.has(m) && (inStep || e.type !== 'new' || !(e.gap >= 0.3))) return;
    if (e.comb !== null || !e.strikeOpen) return;    // on a harmonic of something else, or not a key strike
    if (this._overtone(m) && e.level < this._loudest() - 8) return;   // an overtone of a wanted note
    var early = this.nextExpected.indexOf(m) >= 0;
    if (early) this.early.push({ midi: m, time: e.time });
    this.pending.push({ midi: m, time: e.time, early: early });
  };

  Follower.prototype._strike = function (rep) {
    if (!this.running) return;
    var out = this.outside, any = false, i;
    for (i = 0; i < out.length; i++) if (out[i].time >= rep.strike - 0.03) any = true;
    this.outside = out.filter(function (o) { return rep.time - o.time < 0.6; });
    if (any || rep.strikeIdx < this.doneFrame || rep.strength < 1.5) return;   // needs a clear hammer strike
    this.tries++;    // accounted for elsewhere, or it belonged to the previous step
    // Wanted notes hidden behind something already ringing at their pitch
    var act = this.ear.tracker.active, exp = this.expected.slice(), at = this.index;
    for (i = 0; i < exp.length && this.running && this.index === at; i++) {
      var w = exp[i]; if (this.hit.has(w)) continue;
      var a = act.get(w); if (!a) continue;
      var pre = rep.pre.has(w) ? rep.pre.get(w) : -200;
      if (!this._belongs(a)) continue;
      // Second clear strike on the same step with the note sounding and nothing stray:
      // take it, rather than leave the player stuck on a note the microphone cannot isolate.
      if (this.tries >= 2) { this._hit(w, rep.time); continue; }
      if (!(pre >= rep.max - 14)) continue;
      // A string nobody struck just keeps fading. Unless the strike was a strong one, the
      // level at this pitch must at least have held.
      var d = a.level - pre;
      if (rep.strength < 2.5 && d < -0.1) continue;
      this._hit(w, rep.time);
    }
  };

  Follower.prototype._tick = function (f) {
    this.now = f.time;
    if (!this.running) return;
    if (!this._ctxAt || f.time - this._ctxAt > 0.5) { this._ctxAt = f.time; this._context(); }
    if (!this.pending.length) return;
    var act = this.ear.tracker.active, wrong = [], rest = [], i;
    var loud = -200; act.forEach(function (v) { if (v.level > loud) loud = v.level; });
    for (i = 0; i < this.pending.length; i++) {
      var p = this.pending[i], age = f.time - p.time;
      var st = act.get(p.midi);
      // every frame of the wait must show it as a note in its own right
      if (!st || !st.indep || st.comb !== null || st.virtual) { p.bad = (p.bad || 0) + 1; if (p.bad >= 2) continue; }
      if (this.hit.has(p.midi) || this.expected.indexOf(p.midi) >= 0) continue;   // a later step took it
      if (age < (p.early ? this.earlyWindow : this.wrongDelay)) { rest.push(p); continue; }
      if (!st || st.level < loud - 18) continue;     // far quieter than what is being played
      if (this._overtone(p.midi) && st.level < loud - 8) continue;
      wrong.push(p.midi);
    }
    this.pending = rest;
    if (wrong.length) {
      this.mistakes++;
      this.holdAt = -1;
      this.hit = new Set();                 // the step has to be played again, cleanly
      if (this.cb.wrong) this.cb.wrong(this.index, wrong, this.expected.slice());
    } else if (this.holdAt >= 0) this._check(this.holdAt);
  };

  // Move past the current step by hand (it counts as not right first time).
  Follower.prototype.skip = function () {
    if (!this.running) return;
    this.mistakes++; this.pending.length = 0; this.holdAt = -1;
    var self = this; this.expected.forEach(function (m) { self.hit.add(m); self.legit.set(m, self.now); });
    this._check(this.now);
  };

  Follower.prototype._check = function (time) {
    var exp = this.expected, k;
    for (k = 0; k < exp.length; k++) if (!this.hit.has(exp[k])) return;
    // a stray note struck together with the right ones? wait until it is judged
    for (k = 0; k < this.pending.length; k++) if (!this.pending[k].early) { this.holdAt = time; return; }
    this.holdAt = -1;
    var i = this.index;
    this.stats[i] = { time: time, wait: time - this.stepStart, mistakes: this.mistakes, firstTry: this.mistakes === 0 };
    this.doneFrame = this.ear.frameIndex;
    if (this.cb.done) this.cb.done(i, this.stats[i]);
    var nx = this.nextPlayable(i + 1, this.rangeEnd);
    if (nx < 0) { this.running = false; if (this.cb.finish) this.cb.finish(); return; }
    this.now = Math.max(this.now, time);
    this._enter(nx);
  };

  return { Follower: Follower };
});
