/* Piano Coach — the page: library, sheet music, listening, feedback, report. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var P = window.PianoPieces, Ear = window.PianoEar.Ear, Follower = window.PianoFollower.Follower;
  var INK = '#000000', GOOD = '#2b8a3e', SLOW = '#b7791f', DIM = '#aab5bf';
  var STORE = 'pianoCoach.v1';
  var store = (function () { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
  store.best = store.best || {}; store.imports = store.imports || [];
  function save() { try { localStorage.setItem(STORE, JSON.stringify(store)); } catch (e) { /* storage unavailable: carry on */ } }

  var S = { piece: null, steps: [], osmd: null, zoom: 1, hands: 'both', cursorPos: 0, cur: 0, listening: false, ear: null, fol: null, audio: null,
    demo: null, mistakes: [], range: [0, 0], runFrom: 0, startedAt: 0, barOffset: 1, nBars: 1, frame: 0,
    log: [], skips: 0, heard: null, stepAt: 0 };

  /* ---------- names ---------- */
  var SH = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'], FL = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  function nm(m) { var t = S.piece && S.piece.key < 0 ? FL : SH; return t[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- library ---------- */
  function barsOf(p) { if (p.bars) return p.bars; var n = p.rh ? p.rh.split('|').length - (p.pickup ? 1 : 0) : 0; return n; }
  function renderLibrary() {
    var groups = [['Warm-ups', []], ['Pieces', []], ['Seasonal', []], ['Your music', []]];
    P.library.concat(store.imports).forEach(function (p) { var g = groups.filter(function (x) { return x[0] === p.group; })[0] || groups[3]; g[1].push(p); });
    var host = $('groups'); host.innerHTML = '';
    host.style.display = 'flex'; host.style.flexDirection = 'column'; host.style.gap = '26px';
    groups.forEach(function (g) {
      var sec = document.createElement('div'); sec.className = 'group';
      var h = document.createElement('h2'); h.textContent = g[0]; sec.appendChild(h);
      var cards = document.createElement('div'); cards.className = 'cards'; sec.appendChild(cards);
      g[1].forEach(function (p) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'card';
        var best = store.best[p.id], n = barsOf(p);
        b.innerHTML = '<h3>' + esc(p.title) + '</h3><span class="by">' + esc(p.composer || '') + '</span><span class="about">' + esc(p.note || '') + '</span>' +
          '<span class="meta">' + (n ? '<span class="chip">' + n + ' bars</span>' : '') + (best ? '<span class="chip best">Best ' + best.pct + '%</span>' : '') + '</span>';
        b.addEventListener('click', function () { openPiece(p); });
        if (p.imported) {
          var rm = document.createElement('span'); rm.className = 'remove'; rm.textContent = 'Remove'; rm.setAttribute('role', 'button'); rm.tabIndex = 0;
          rm.addEventListener('click', function (e) { e.stopPropagation(); store.imports = store.imports.filter(function (q) { return q.id !== p.id; }); save(); renderLibrary(); });
          b.querySelector('.meta').appendChild(rm);
        }
        cards.appendChild(b);
      });
      if (g[0] === 'Your music') {
        var add = document.createElement('button'); add.type = 'button'; add.className = 'card add';
        add.innerHTML = '<h3>Add your own music</h3><span class="about">Open a MusicXML file (.musicxml, .xml or .mxl). Notation programs such as MuseScore can save in this format.</span>';
        add.addEventListener('click', function () { $('file').click(); });
        cards.appendChild(add);
      }
      sec.hidden = !cards.children.length;
      host.appendChild(sec);
    });
  }
  $('file').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return; this.value = '';
    var mxl = /\.mxl$/i.test(f.name), r = new FileReader();
    r.onload = function () {
      var data = r.result;
      if (mxl) { var u = new Uint8Array(data), s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); data = s; }
      var p = { id: 'own-' + Date.now(), group: 'Your music', title: f.name.replace(/\.[^.]+$/, ''), composer: '', note: 'Your own file', xml: data, imported: true, tempo: 80, key: 0 };
      if (data.length < 1200000) { store.imports.push(p); save(); }
      openPiece(p);
    };
    if (mxl) r.readAsArrayBuffer(f); else r.readAsText(f);
  });

  /* ---------- keyboard: all 88 keys, A0 to C8 ---------- */
  var WHITE = [0, 2, 4, 5, 7, 9, 11], KW = 23, KH = 104;
  function buildKeys() {
    var x = 0, whites = '', blacks = '', labels = '', names = '';
    for (var m = 21; m <= 108; m++) {
      var pc = m % 12;
      if (WHITE.indexOf(pc) >= 0) {
        whites += '<rect class="wk" id="k' + m + '" x="' + x + '" y="0" width="' + KW + '" height="' + KH + '" rx="2"/>';
        if (pc === 0) labels += '<text class="klabel" x="' + (x + KW / 2) + '" y="' + (KH - 5) + '">C' + (m / 12 - 1) + '</text>';
        names += '<text class="kname" id="t' + m + '" x="' + (x + KW / 2) + '" y="' + (KH - 20) + '" visibility="hidden"></text>';
        x += KW;
      } else {
        blacks += '<rect class="bk" id="k' + m + '" x="' + (x - 7) + '" y="0" width="14" height="' + Math.round(KH * 0.62) + '" rx="2"/>';
        names += '<text class="kname" id="t' + m + '" x="' + x + '" y="' + Math.round(KH * 0.62 - 6) + '" visibility="hidden" style="font-size:8px"></text>';
      }
    }
    $('keys').innerHTML = '<svg viewBox="0 0 ' + x + ' ' + KH + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Piano keyboard">' + whites + labels + blacks + names + '</svg>';
  }
  var keyState = {};   // midi -> class currently shown for "want"
  function showWanted(i) {
    Object.keys(keyState).forEach(function (m) { var k = $('k' + m); if (k) k.classList.remove('want-r', 'want-l'); var t = $('t' + m); if (t) t.setAttribute('visibility', 'hidden'); });
    keyState = {};
    var st = S.steps[i]; if (!st) return;
    var withNames = $('names').checked;
    st.notes.forEach(function (n) {
      if (n.tied || !inHands(n)) return;
      var k = $('k' + n.midi); if (!k) return;
      var cls = n.staff === 0 ? 'want-r' : 'want-l';
      k.classList.add(cls); keyState[n.midi] = cls;
      var t = $('t' + n.midi);
      if (t && withNames) { t.textContent = nm(n.midi).replace(/-?\d+$/, ''); t.setAttribute('visibility', 'visible'); }
    });
  }
  function flashKey(m, cls, ms) {
    var k = $('k' + m); if (!k) return;
    k.classList.add(cls); setTimeout(function () { k.classList.remove(cls); }, ms || 380);
  }

  /* ---------- score ---------- */
  function inHands(n) { return S.hands === 'both' || (S.hands === 'right' ? n.staff === 0 : n.staff !== 0); }
  function heads(n) {
    if (!n.el) return [];
    var hs = n.el.querySelectorAll('.vf-notehead');
    if (hs.length === n.nHeads && hs[n.rank]) return [hs[n.rank]];
    return Array.prototype.slice.call(hs);
  }
  function paint(n, color) {
    heads(n).forEach(function (h) {
      var ps = h.querySelectorAll('path');
      for (var i = 0; i < ps.length; i++) { ps[i].setAttribute('fill', color); ps[i].setAttribute('stroke', color); }
    });
  }
  function paintStep(i, color) { var st = S.steps[i]; if (st) st.notes.forEach(function (n) { if (inHands(n)) paint(n, color); }); }
  function paintAll() { S.steps.forEach(function (st) { st.notes.forEach(function (n) { paint(n, inHands(n) ? INK : DIM); }); }); }

  function extractSteps() {
    var osmd = S.osmd, cur = osmd.cursor, steps = [], guard = 0;
    cur.show(); cur.reset();
    var it = cur.Iterator;
    while (!it.EndReached && guard++ < 20000) {
      var ves = it.CurrentVoiceEntries || [], notes = [], gns = [];
      try { gns = cur.GNotesUnderCursor() || []; } catch (e) { gns = []; }
      ves.forEach(function (ve) {
        var staff = 0; try { staff = ve.ParentSourceStaffEntry.ParentStaff.idInMusicSheet; } catch (e) { staff = 0; }
        var real = ve.Notes.filter(function (n) { return !n.isRest() && !(ve.IsGrace || n.IsGraceNote); });
        var sorted = real.slice().sort(function (a, b) { return a.halfTone - b.halfTone; });
        real.forEach(function (n) {
          var tie = n.NoteTie, el = null;
          for (var g = 0; g < gns.length; g++) if (gns[g].sourceNote === n) { try { el = gns[g].getSVGGElement(); } catch (e) { el = null; } break; }
          notes.push({ midi: n.halfTone + 12, staff: staff > 0 ? 1 : 0, tied: !!(tie && tie.StartNote !== n), len: n.Length.RealValue, el: el, rank: sorted.indexOf(n), nHeads: sorted.length });
        });
      });
      var ts = 0; try { ts = it.CurrentEnrolledTimestamp.RealValue; } catch (e) { ts = steps.length * 0.25; }
      steps.push({ m: it.CurrentMeasureIndex, ts: ts, notes: notes });
      cur.next();
    }
    cur.reset(); S.cursorPos = 0;
    S.steps = steps;
    S.nBars = steps.length ? steps[steps.length - 1].m + 1 : 1;
  }
  function setCursor(i) {
    var c = S.osmd.cursor; i = Math.max(0, Math.min(S.steps.length - 1, i));
    if (i < S.cursorPos) { c.reset(); S.cursorPos = 0; }
    while (S.cursorPos < i) { c.next(); S.cursorPos++; }
    S.cur = i;
    var el = c.cursorElement, wrap = $('scoreWrap');
    if (el) {
      var r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect();
      if (r.top < w.top + 8 || r.bottom > w.bottom - 8) wrap.scrollTo({ top: wrap.scrollTop + (r.top - w.top) - 36, behavior: 'smooth' });
    }
  }
  function stepRange(fromBar, toBar) {
    var a = -1, b = -1;
    S.steps.forEach(function (st, i) { var n = st.m + S.barOffset; if (n >= fromBar && n <= toBar) { if (a < 0) a = i; b = i; } });
    return a < 0 ? [0, S.steps.length - 1] : [a, b];
  }
  function applyBars() {
    var lo = S.barOffset, hi = S.nBars - 1 + S.barOffset;
    var f = Math.max(lo, Math.min(hi, parseInt($('from').value, 10) || lo)), t = Math.max(f, Math.min(hi, parseInt($('to').value, 10) || hi));
    $('from').value = f; $('to').value = t;
    S.range = stepRange(f, t);
  }

  function render() {
    S.osmd.zoom = S.zoom; S.osmd.render();
    extractSteps(); paintAll();
  }
  function openPiece(p) {
    stopAll();
    S.piece = p; S.hands = 'both'; S.mistakes = [];
    $('library').hidden = true; $('practice').hidden = false; $('report').hidden = true;
    $('title').textContent = p.title; $('by').textContent = p.composer || '';
    $('loading').hidden = false; $('score').style.visibility = 'hidden';
    setHandsButtons();
    say('Setting out the music…');
    setTimeout(function () {
      try {
        if (!S.osmd) {
          S.osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay($('score'), { autoResize: false, backend: 'svg', drawTitle: false, drawSubtitle: false, drawComposer: false, drawLyricist: false,
            drawPartNames: false, drawPartAbbreviations: false, autoBeam: true, drawMeasureNumbers: true, cursorsOptions: [{ type: 0, color: '#0b7285', alpha: 0.3, follow: false }] });
        }
        S.osmd.load(p.xml || P.toMusicXml(p)).then(function () {
          if (p.imported) {
            try { p.tempo = S.osmd.Sheet.DefaultStartTempoInBpm || 80; } catch (e) { p.tempo = 80; }
            try { var ks = S.osmd.Sheet.SourceMeasures[0].FirstInstructionsStaffEntries[0].Instructions; ks.forEach(function (k) { if (k.Key !== undefined) p.key = k.Key; }); } catch (e) { /* keep default */ }
          }
          S.barOffset = p.pickup ? 0 : 1;
          render();
          $('loading').hidden = true; $('score').style.visibility = 'visible';
          $('from').min = $('to').min = S.barOffset; $('from').max = $('to').max = S.nBars - 1 + S.barOffset;
          $('from').value = S.barOffset; $('to').value = S.nBars - 1 + S.barOffset;
          applyBars(); setCursor(S.range[0]); showWanted(S.cur);
          $('scoreWrap').scrollTop = 0;
          say('Press <b>Start listening</b>, then play. <small>The music waits for you at every note. Teal is your right hand, purple your left.</small>');
        }).catch(function (e) { loadFailed(e); });
      } catch (e) { loadFailed(e); }
    }, 30);
  }
  function loadFailed(e) {
    $('loading').hidden = false; $('loading').textContent = 'This file could not be read as sheet music.';
    say('That file could not be opened. <small>' + esc(String(e && e.message || e)).slice(0, 160) + '</small>', 'bad');
  }

  /* ---------- coach line ---------- */
  var sayTimer = null;
  function say(html, cls) { var el = $('say'); el.className = cls || ''; el.innerHTML = html; }
  function prompt(i) {
    var st = S.steps[i]; if (!st) return;
    var r = [], l = [];
    st.notes.forEach(function (n) { if (n.tied || !inHands(n)) return; (n.staff === 0 ? r : l).push(n.midi); });
    r.sort(function (a, b) { return a - b; }); l.sort(function (a, b) { return a - b; });
    var part = function (arr, cls) { return arr.map(function (m) { return '<span class="n ' + cls + '">' + nm(m) + '</span>'; }).join(' '); };
    var bits = [];
    if (l.length) bits.push('<span class="l">Left</span> ' + part(l, 'l'));
    if (r.length) bits.push('<span class="r">Right</span> ' + part(r, 'r'));
    say('Play ' + bits.join(' &nbsp;·&nbsp; ') + '<small>Bar ' + (st.m + S.barOffset) + '</small>');
  }
  function wrongText(played, expected) {
    var p = played[0], best = expected[0], d = 99;
    expected.forEach(function (e) { if (Math.abs(e - p) < d) { d = Math.abs(e - p); best = e; } });
    var same = expected.filter(function (e) { return (e - p) % 12 === 0; })[0];
    if (same !== undefined) return 'That was ' + nm(p) + ': the right note, but an octave too ' + (p > same ? 'high' : 'low') + '. <small>Play ' + nm(same) + '.</small>';
    if (d === 1) return 'You played ' + nm(p) + '. The music has ' + nm(best) + ', the very next key ' + (best > p ? 'up' : 'down') + '.';
    if (d === 2) return 'You played ' + nm(p) + '. The music has ' + nm(best) + ', two keys ' + (best > p ? 'up' : 'down') + '.';
    return 'You played ' + played.map(nm).join(' and ') + '. Look for ' + expected.map(nm).join(', ') + '.';
  }

  /* ---------- listening ---------- */
  function micProblem(e) {
    var n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'The microphone is blocked. <small>Click the microphone icon at the right of the address bar, choose Allow, then press Start listening again.</small>';
    if (n === 'NotFoundError') return 'No microphone was found on this computer.';
    return 'The microphone could not be started. <small>' + esc(String(e && e.message || e)).slice(0, 140) + '</small>';
  }
  function ensureAudio() {
    if (S.audio) return S.audio.ctx.state === 'suspended' ? S.audio.ctx.resume() : Promise.resolve();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('This browser cannot use the microphone here. Open the file in Chrome.'));
    // Voice-call processing would erase held piano notes, so all of it is switched off.
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } }).then(function (stream) {
      var Ctx = window.AudioContext || window.webkitAudioContext, ctx = new Ctx();
      var src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(1024, 1, 1), mute = ctx.createGain();
      mute.gain.value = 0; src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
      var ear = new Ear({ sampleRate: ctx.sampleRate });
      ear.onFrame = onFrame;
      var fol = new Follower(ear);
      fol.cb.step = function (i) { S.stepAt = Date.now(); setCursor(i); prompt(i); showWanted(i); };
      fol.cb.hit = function (i, m) { var st = S.steps[i]; st.notes.forEach(function (n) { if (n.midi === m && inHands(n)) paint(n, GOOD); }); flashKey(m, 'hit'); };
      fol.cb.wrong = function (i, midis, expected) {
        S.mistakes.push({ step: i, bar: S.steps[i].m + S.barOffset, played: midis.slice(), expected: expected.slice() });
        note('wrong bar ' + (S.steps[i].m + S.barOffset) + ': ' + midis.map(nmA).join(' ') + ' for ' + expected.map(nmA).join(' '));
        midis.forEach(function (m) { flashKey(m, 'wrong', 900); });
        paintStep(i, INK);
        var pp = $('paper'); pp.classList.remove('oops'); void pp.offsetWidth; pp.classList.add('oops');
        say(wrongText(midis, expected), 'bad');
        clearTimeout(sayTimer); sayTimer = setTimeout(function () { if (S.listening && S.cur === i) prompt(i); }, 2600);
      };
      fol.cb.done = function (i, st) { clearTimeout(sayTimer); paintStep(i, st.firstTry ? GOOD : SLOW); note((st.firstTry ? 'ok' : 'done') + ' ' + (i + 1)); };
      fol.cb.finish = function () { finish(); };
      var failed = false;
      proc.onaudioprocess = function (ev) {
        if (failed) return;
        try { ear.push(ev.inputBuffer.getChannelData(0)); } catch (err) { failed = true; say('The listener stopped unexpectedly. <small>Reload the page to start again. (' + esc(String(err && err.message || err)).slice(0, 120) + ')</small>', 'bad'); }
      };
      S.audio = { ctx: ctx, stream: stream, proc: proc, src: src }; S.ear = ear; S.fol = fol;
      return ctx.state === 'suspended' ? ctx.resume() : undefined;
    });
  }
  function onFrame(f) {
    S.frame++;
    $('level').style.width = Math.max(0, Math.min(100, (f.db + 72) * 1.7)) + '%';
    if (S.frame % 3) return;
    var act = S.ear.tracker.active, list = [], top = -200;
    act.forEach(function (v) { if (v.level > top) top = v.level; });
    if (top < S.ear.refMax - 34) top = 1e9;          // only faint leftovers: show nothing
    act.forEach(function (v, m) { if (v.indep && v.level > top - 22) list.push(m); });
    list.sort(function (a, b) { return a - b; });
    var olds = document.querySelectorAll('#keys .hear'); for (var i = 0; i < olds.length; i++) olds[i].classList.remove('hear');
    list.slice(0, 8).forEach(function (m) { var k = $('k' + m); if (k) k.classList.add('hear'); });
    if (list.length && S.listening) S.heard = { at: Date.now(), notes: list.slice(0, 6) };
    $('hearing').textContent = S.listening ? (list.length ? 'Hearing ' + list.slice(0, 6).map(nm).join(' ') : 'Listening…') : '';
  }
  function start(fromTop) {
    stopDemo();
    ensureAudio().then(function () {
      applyBars();
      var from = (!fromTop && S.cur > S.range[0] && S.cur < S.range[1]) ? S.cur : S.range[0];
      S.fol.load(S.steps); S.fol.setHands(S.hands);
      for (var i = from; i <= S.range[1]; i++) S.steps[i].notes.forEach(function (n) { paint(n, inHands(n) ? INK : DIM); });
      S.mistakes = []; S.runFrom = from; S.startedAt = Date.now(); S.log = []; S.skips = 0; S.heard = null;
      if (!S.fol.start(from, S.range[1])) { say('There is nothing for that hand to play in these bars.'); return; }
      S.listening = true; goButton();
      note('start at ' + (from + 1));
    }).catch(function (e) { say(micProblem(e), 'bad'); });
  }
  function stopListening() {
    if (S.fol) S.fol.stop();
    S.listening = false; goButton(); $('hearing').textContent = '';
  }
  function releaseMic() {
    if (!S.audio) return;
    try { S.audio.proc.disconnect(); S.audio.src.disconnect(); S.audio.stream.getTracks().forEach(function (t) { t.stop(); }); S.audio.ctx.close(); } catch (e) { /* already gone */ }
    S.audio = null; S.ear = null; S.fol = null; $('level').style.width = '0%';
  }
  function goButton() { var b = $('go'); b.textContent = S.listening ? 'Stop' : 'Start listening'; b.classList.toggle('on', S.listening); $('skip').disabled = !S.listening; }
  function stopAll() { stopDemo(); stopListening(); clearTimeout(sayTimer); }

  /* ---------- report ---------- */
  function finish() {
    S.listening = false; goButton(); $('hearing').textContent = '';
    var st = S.fol.stats, total = 0, clean = 0, bars = {}, prev = -1, ratios = [], gaps = [];
    function bar(i) { var b = S.steps[i].m + S.barOffset; return bars[b] || (bars[b] = { bar: b, err: 0, slow: 0, notes: [] }); }
    for (var i = S.runFrom; i <= S.range[1]; i++) {
      if (!st[i]) continue;
      total++;
      if (st[i].firstTry) clean++; else bar(i).err += st[i].mistakes;
      if (prev >= 0) { var want = S.steps[i].ts - S.steps[prev].ts, took = st[i].time - st[prev].time; if (want > 0) { ratios.push(took / want); gaps.push({ i: i, r: took / want, took: took }); } }
      prev = i;
    }
    var sorted = ratios.slice().sort(function (a, b) { return a - b; }), med = sorted.length ? sorted[sorted.length >> 1] : 0;
    gaps.forEach(function (g) { if (med > 0 && g.r > 2.3 * med && g.took > 1.2 && st[g.i].firstTry) bar(g.i).slow++; });
    S.mistakes.forEach(function (m) {
      if (!bars[m.bar] || bars[m.bar].notes.length >= 2) return;
      var p0 = m.played[0], near = m.expected.slice().sort(function (a, b) { return Math.abs(a - p0) - Math.abs(b - p0); })[0];
      bars[m.bar].notes.push('played ' + m.played.map(nm).join(' and ') + ' for ' + nm(near));
    });
    var pct = total ? Math.round((100 * clean) / total) : 0;
    note('finish ' + pct + '%');
    var secs = Math.round((Date.now() - S.startedAt) / 1000), whole = S.runFrom === 0 && S.range[1] === S.steps.length - 1 && S.hands === 'both';
    $('repTitle').textContent = pct === 100 ? 'A clean run' : pct >= 85 ? 'Nearly there' : pct >= 60 ? 'Coming along' : 'Worth another pass';
    $('repPct').textContent = pct + '%';
    $('repSub').textContent = clean + ' of ' + total + ' steps right first time';
    var handsTxt = S.hands === 'both' ? 'both hands' : S.hands + ' hand';
    $('repText').textContent = S.piece.title + ', bars ' + $('from').value + ' to ' + $('to').value + ', ' + handsTxt + '. Time taken: ' + Math.floor(secs / 60) + ':' + ('0' + (secs % 60)).slice(-2) + '.';
    var spots = Object.keys(bars).map(function (k) { return bars[k]; }).filter(function (b) { return b.err || b.slow; })
      .sort(function (a, b) { return (b.err * 2 + b.slow) - (a.err * 2 + a.slow); }).slice(0, 3).sort(function (a, b) { return a.bar - b.bar; });
    var ul = $('repSpots'); ul.innerHTML = '';
    spots.forEach(function (b) {
      var li = document.createElement('li'); if (b.err) li.className = 'err';
      var why = b.err ? (b.err === 1 ? 'One wrong note' : b.err + ' wrong notes') + (b.notes.length ? ': ' + b.notes.join('; ') : '') : 'You paused here longer than elsewhere';
      var last = S.nBars - 1 + S.barOffset, a = b.bar, z = Math.min(last, b.bar + 1);
      li.innerHTML = '<div><b>Bar ' + b.bar + '</b>' + esc(why) + '.</div>';
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn'; btn.textContent = a === z ? 'Practise bar ' + a : 'Practise bars ' + a + '–' + z;
      btn.addEventListener('click', function () { $('from').value = a; $('to').value = z; closeReport(); applyBars(); setCursor(S.range[0]); start(true); });
      li.appendChild(btn); ul.appendChild(li);
    });
    $('repNote').textContent = spots.length ? 'Loop a tricky bar slowly until it comes out clean three times in a row, then play the whole piece again.' : (pct === 100 ? 'No wrong notes and no long pauses. Try it a little faster, or move on to the next piece.' : '');
    if (whole && total) { var old = store.best[S.piece.id]; if (!old || pct > old.pct) { store.best[S.piece.id] = { pct: pct, when: Date.now() }; save(); } }
    $('report').hidden = false; $('again').focus();
  }
  function closeReport() { $('report').hidden = true; }

  /* ---------- hear it ---------- */
  function tone(ctx, out, midi, at, dur) {
    var f = 440 * Math.pow(2, (midi - 69) / 12), g = ctx.createGain(), end = at + Math.min(3.2, dur + 0.5);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.5, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0006, end);
    g.connect(out);
    [1, 2, 3, 4].forEach(function (h, k) {
      var o = ctx.createOscillator(), a = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f * h; a.gain.value = [1, 0.42, 0.18, 0.07][k] * (midi > 84 ? 0.6 : 1);
      o.connect(a); a.connect(g); o.start(at); o.stop(end + 0.05);
    });
  }
  function startDemo() {
    stopAll(); applyBars();
    var Ctx = window.AudioContext || window.webkitAudioContext, ctx = new Ctx(), out = ctx.createGain(); out.gain.value = 0.22; out.connect(ctx.destination);
    var whole = 240 / ((S.piece.tempo || 80) * (+$('speed').value / 100)), a = S.range[0], b = S.range[1], t0 = ctx.currentTime + 0.2, timers = [];
    for (var i = a; i <= b; i++) (function (i) {
      var at = t0 + (S.steps[i].ts - S.steps[a].ts) * whole;
      S.steps[i].notes.forEach(function (n) { if (!n.tied) tone(ctx, out, n.midi, at, n.len * whole); });
      timers.push(setTimeout(function () { setCursor(i); showWanted(i); }, Math.max(0, (at - ctx.currentTime) * 1000)));
    })(i);
    var lastLen = 0; S.steps[b].notes.forEach(function (n) { lastLen = Math.max(lastLen, n.len); });
    var endAt = t0 + (S.steps[b].ts - S.steps[a].ts + lastLen) * whole + 0.6;
    timers.push(setTimeout(function () { stopDemo(); setCursor(a); showWanted(a); }, (endAt - ctx.currentTime) * 1000));
    S.demo = { ctx: ctx, timers: timers };
    $('hear').innerHTML = '&#9632; Stop';
    say('Listen and follow the cursor. <small>The speed slider sets how fast it plays.</small>');
  }
  function stopDemo() {
    if (!S.demo) return;
    S.demo.timers.forEach(clearTimeout); try { S.demo.ctx.close(); } catch (e) { /* closed */ }
    S.demo = null; $('hear').innerHTML = '&#9654; Hear it';
  }

  /* ---------- controls ---------- */
  function setHandsButtons() {
    var bs = document.querySelectorAll('[data-hands]');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i].getAttribute('data-hands') === S.hands ? 'true' : 'false');
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-hands]'), function (b) {
    b.addEventListener('click', function () {
      var was = S.listening; stopAll();
      S.hands = b.getAttribute('data-hands'); setHandsButtons(); paintAll(); showWanted(S.cur);
      if (was) start(true); else say(S.hands === 'both' ? 'Both hands. Press <b>Start listening</b>.' : 'Only the ' + S.hands + ' hand is checked now; the other is greyed out. Press <b>Start listening</b>.');
    });
  });
  $('go').addEventListener('click', function () { if (S.listening) { stopListening(); say('Stopped. <small>Start listening picks up where the cursor is. From the top goes back to the first bar.</small>'); } else start(false); });
  $('restart').addEventListener('click', function () { var was = S.listening; stopAll(); applyBars(); setCursor(S.range[0]); showWanted(S.cur); paintAll(); if (was) start(true); else prompt(S.cur); });
  function skip() { if (!S.listening || !S.fol) return; S.skips++; note('skip ' + (S.cur + 1)); S.fol.skip(); }
  $('skip').addEventListener('click', skip);
  document.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' && S.listening && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); skip(); } });
  $('hear').addEventListener('click', function () { if (S.demo) { stopDemo(); prompt(S.cur); } else startDemo(); });
  $('speed').addEventListener('input', function () { $('speedOut').textContent = this.value + '%'; });
  $('names').addEventListener('change', function () { showWanted(S.cur); });
  ['from', 'to'].forEach(function (id) { $(id).addEventListener('change', function () { var was = S.listening; stopAll(); applyBars(); setCursor(S.range[0]); showWanted(S.cur); if (was) start(true); else prompt(S.cur); }); });
  function zoom(d) {
    if (!S.osmd) return; var was = S.listening, at = S.cur; stopAll();
    S.zoom = Math.max(0.6, Math.min(1.7, S.zoom + d)); render(); applyBars(); setCursor(at); showWanted(at);
    if (was) start(false);
  }
  $('zoomIn').addEventListener('click', function () { zoom(0.1); });
  $('zoomOut').addEventListener('click', function () { zoom(-0.1); });
  $('back').addEventListener('click', function () { stopAll(); releaseMic(); $('practice').hidden = true; $('report').hidden = true; $('library').hidden = false; renderLibrary(); });
  $('again').addEventListener('click', function () { closeReport(); setCursor(S.range[0]); start(true); });
  $('whole').addEventListener('click', function () { closeReport(); $('from').value = S.barOffset; $('to').value = S.nBars - 1 + S.barOffset; applyBars(); setCursor(S.range[0]); start(true); });
  $('other').addEventListener('click', function () { $('back').click(); });

  /* ---------- report or request ----------
     Opens a ready-written email. The page itself sends nothing: no server, no recording. */
  var TO = ['darian.zigante', 'gmail.com'].join('@');
  var ASH = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], AFL = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  // Plain-text note names, so they survive any email program.
  function nmA(m) { var t = S.piece && S.piece.key < 0 ? AFL : ASH; return t[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
  // A short running record of the current run: "12.4 ok 23" = step 23 completed 12.4 s in.
  function note(what) { S.log.push(((Date.now() - S.startedAt) / 1000).toFixed(1) + ' ' + what); if (S.log.length > 40) S.log.shift(); }
  var ask = { kind: 'problem', info: [], where: '', opener: null, used: false };
  function details() {
    var L = ['Version: ' + $('version').textContent.replace(/^Version\s*/, '')];
    ask.where = '';
    if (!S.piece || $('practice').hidden) L.push('Screen: list of pieces');
    else {
      var p = S.piece, st = S.steps[S.cur], hands = S.hands === 'both' ? 'both hands' : S.hands + ' hand only';
      L.push('Piece: ' + p.title + (p.imported ? ' (imported file)' : ''));
      L.push('Settings: bars ' + $('from').value + ' to ' + $('to').value + ', ' + hands + ', speed ' + $('speed').value + '%, zoom ' + S.zoom.toFixed(1));
      if (st) {
        var want = []; st.notes.forEach(function (n) { if (!n.tied && inHands(n)) want.push(n.midi); });
        want.sort(function (a, b) { return a - b; });
        ask.where = ', bar ' + (st.m + S.barOffset);
        L.push('At: bar ' + (st.m + S.barOffset) + ', step ' + (S.cur + 1) + ' of ' + S.steps.length + ', music has ' + (want.map(nmA).join(' ') || 'nothing for this hand'));
      }
      if (S.listening && S.fol) {
        var got = []; S.fol.expected.forEach(function (m) { if (S.fol.hit.has(m)) got.push(m); });
        L.push('Listening: yes, ' + ((Date.now() - S.stepAt) / 1000).toFixed(1) + ' s on this step, accepted so far: ' + (got.map(nmA).join(' ') || 'none') + ', tries ' + (S.fol.tries || 0));
      } else L.push('Listening: no' + (!$('report').hidden ? ' (run finished: ' + $('repPct').textContent + ', ' + $('repSub').textContent + ')' : ''));
      if (S.startedAt) L.push('This run: ' + S.mistakes.length + ' wrong, ' + S.skips + ' skipped');
      if (S.heard) L.push('Last heard: ' + S.heard.notes.map(nmA).join(' ') + ' (' + ((Date.now() - S.heard.at) / 1000).toFixed(1) + ' s before)');
      if (S.log.length) L.push('Recent: ' + S.log.slice(-12).join(' | '));
    }
    if (S.audio) {
      var tr = S.audio.stream.getAudioTracks()[0];
      L.push('Microphone: ' + (tr && tr.label ? tr.label + ', ' : '') + S.audio.ctx.sampleRate + ' Hz' + (S.ear && isFinite(S.ear.refMax) ? ', peak ' + Math.round(S.ear.refMax) + ' dB' : ''));
    }
    L.push('Window: ' + window.innerWidth + ' x ' + window.innerHeight);
    L.push('Browser: ' + navigator.userAgent);
    return L;
  }
  function askNote() {
    var text = $('askText').value.trim(), problem = ask.kind === 'problem';
    var subject = '[Piano Coach] ' + (problem ? 'Problem' : 'Request') + (S.piece && !$('practice').hidden ? ': ' + S.piece.title + ask.where : '');
    var lines = [text, '', '---', 'Sent from Piano Coach (' + (problem ? 'problem' : 'request') + ')'].concat(ask.info);
    function url(ls) { return 'mailto:' + TO + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(ls.join('\r\n')); }
    var u = url(lines);
    // Some email programs refuse very long links: drop the running record first.
    if (u.length > 6000) u = url(lines.filter(function (l) { return l.indexOf('Recent: ') !== 0; }));
    return { subject: subject, body: lines.join('\n'), url: u, empty: !text };
  }
  function askKind(k) {
    ask.kind = k;
    var bs = document.querySelectorAll('[data-kind]');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i].getAttribute('data-kind') === k ? 'true' : 'false');
    $('askPrompt').textContent = k === 'problem' ? 'What happened?' : 'What would you like added or changed?';
    $('askText').placeholder = k === 'problem' ? 'For example: in bar 5 it kept waiting even though I played the right notes.' : 'For example: please add Clair de Lune, or make the note names bigger.';
  }
  function askHelp(text, cls) { var el = $('askHelp'); el.textContent = text; el.className = 'note-small' + (cls ? ' ' + cls : ''); }
  function openAsk(opener) {
    ask.info = details();                    // taken first, so it shows what was happening
    if (S.listening) { stopListening(); say('Stopped. <small>Start listening picks up where the cursor is. From the top goes back to the first bar.</small>'); }
    stopDemo(); clearTimeout(sayTimer);
    if (ask.used) { $('askText').value = ''; ask.used = false; ask.kind = 'problem'; }   // a fresh note
    ask.opener = opener || null;
    $('askInfo').textContent = ask.info.join('\n');
    $('askCancel').textContent = 'Cancel';
    askKind(ask.kind);
    askHelp('Open email starts a new email with your note already written. Press Send there. Notes go to ' + TO + '.');
    $('ask').hidden = false; $('askText').focus();
  }
  function closeAsk() { $('ask').hidden = true; if (ask.opener) { try { ask.opener.focus(); } catch (e) { /* gone */ } } }
  function askReady() {
    var n = askNote();
    if (n.empty) { askHelp('Please write a few words first.', 'bad'); $('askText').focus(); return null; }
    return n;
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, fail) {
      var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      var done = false; try { done = document.execCommand('copy'); } catch (e) { done = false; }
      document.body.removeChild(t); if (done) ok(); else fail(new Error('copy refused'));
    });
  }
  ['askLib', 'askBtn', 'askRep'].forEach(function (id) { $(id).addEventListener('click', function () { openAsk(this); }); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-kind]'), function (b) { b.addEventListener('click', function () { askKind(b.getAttribute('data-kind')); $('askText').focus(); }); });
  $('askForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var n = askReady(); if (!n) return;
    ask.used = true; $('askCancel').textContent = 'Close';
    window.location.href = n.url;
    askHelp('Your email should now be open with the note written. Press Send there. If nothing opened, press "Copy the note instead" and paste it into a new email to ' + TO + '.', 'good');
  });
  $('askCopy').addEventListener('click', function () {
    var n = askReady(); if (!n) return;
    copyText('To: ' + TO + '\nSubject: ' + n.subject + '\n\n' + n.body).then(function () {
      ask.used = true; $('askCancel').textContent = 'Close';
      askHelp('Copied. Start a new email to ' + TO + ', paste, and send.', 'good');
    }, function () { askHelp('Copying did not work here. Please write to ' + TO + ' instead.', 'bad'); });
  });
  $('askCancel').addEventListener('click', closeAsk);
  $('askText').addEventListener('input', function () { if (/\bbad\b/.test($('askHelp').className)) askHelp('Open email starts a new email with your note already written. Press Send there. Notes go to ' + TO + '.'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('ask').hidden) closeAsk(); });
  S.ask = { note: askNote, details: details, open: openAsk };   // for inspection

  var rs = null;
  window.addEventListener('resize', function () {
    clearTimeout(rs); rs = setTimeout(function () { if (!S.osmd || $('practice').hidden || S.listening || S.demo) return; var at = S.cur; render(); applyBars(); setCursor(at); showWanted(at); }, 250);
  });
  window.addEventListener('beforeunload', releaseMic);

  buildKeys(); renderLibrary(); goButton();
  window.PianoCoach = S;   // for inspection
})();
