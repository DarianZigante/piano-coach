/* Starter library and a tiny notation shorthand that is turned into MusicXML.
 *
 * Shorthand, one string per hand, bars separated by "|":
 *   c4q      note: letter, optional # or b, octave, then length  w h q e s  (whole … sixteenth)
 *   f#4e.    a dot lengthens by half;  bb3h is B-flat
 *   [c4 e4 g4]h   chord
 *   rq       rest
 *   c4h~     tie into the next note of the same pitch
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PianoPieces = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DIV = 8;   // divisions per quarter note
  var LEN = { w: 32, h: 16, q: 8, e: 4, s: 2 };
  var TYPE = { w: 'whole', h: 'half', q: 'quarter', e: 'eighth', s: '16th' };
  var SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  var TOKEN = /\[[^\]]+\][whqes]\.?~?|r[whqes]\.?|[a-g][#b]?\d[whqes]\.?~?/g;

  function pitch(s) {
    var m = /^([a-g])([#b]?)(\d)$/.exec(s);
    if (!m) throw new Error('bad pitch ' + s);
    var alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, oct = +m[3];
    return { step: m[1].toUpperCase(), alter: alter, octave: oct, midi: 12 * (oct + 1) + SEMI[m[1]] + alter };
  }
  function parseBar(str) {
    var out = [], toks = str.match(TOKEN) || [];
    if (toks.join('').replace(/\s/g, '') !== str.replace(/\s/g, '')) throw new Error('cannot read bar: "' + str + '"');
    toks.forEach(function (t) {
      var tie = /~$/.test(t); if (tie) t = t.slice(0, -1);
      var dot = /\.$/.test(t); if (dot) t = t.slice(0, -1);
      var len = t.slice(-1), body = t.slice(0, -1), ev = { len: len, dot: dot, tie: tie, dur: LEN[len] * (dot ? 1.5 : 1) };
      if (body === 'r') ev.rest = true;
      else if (body[0] === '[') ev.pitches = body.slice(1, -1).trim().split(/\s+/).map(pitch);
      else ev.pitches = [pitch(body)];
      out.push(ev);
    });
    return out;
  }
  function parseHand(str) { return str.split('|').map(function (b) { return parseBar(b.trim()); }); }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function noteXml(ev, staff, voice, open) {
    var x = '';
    if (ev.rest) {
      return '<note><rest/><duration>' + ev.dur + '</duration><voice>' + voice + '</voice><type>' + TYPE[ev.len] + '</type>' + (ev.dot ? '<dot/>' : '') + '<staff>' + staff + '</staff></note>';
    }
    ev.pitches.forEach(function (p, i) {
      var stop = open[p.midi], start = ev.tie;
      x += '<note>' + (i ? '<chord/>' : '') + '<pitch><step>' + p.step + '</step>' + (p.alter ? '<alter>' + p.alter + '</alter>' : '') + '<octave>' + p.octave + '</octave></pitch>' +
        '<duration>' + ev.dur + '</duration>' + (stop ? '<tie type="stop"/>' : '') + (start ? '<tie type="start"/>' : '') +
        '<voice>' + voice + '</voice><type>' + TYPE[ev.len] + '</type>' + (ev.dot ? '<dot/>' : '') + '<staff>' + staff + '</staff>' +
        (stop || start ? '<notations>' + (stop ? '<tied type="stop"/>' : '') + (start ? '<tied type="start"/>' : '') + '</notations>' : '') + '</note>';
      if (stop) delete open[p.midi];
      if (start) open[p.midi] = true;
    });
    return x;
  }

  function toMusicXml(piece) {
    var rh = parseHand(piece.rh), lh = parseHand(piece.lh);
    if (rh.length !== lh.length) throw new Error(piece.title + ': the hands have ' + rh.length + ' and ' + lh.length + ' bars');
    var barLen = piece.time[0] * (4 * DIV / piece.time[1]);
    var sum = function (b) { return b.reduce(function (a, e) { return a + e.dur; }, 0); };
    var x = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>' + esc(piece.title) + '</work-title></work>' +
      '<identification><creator type="composer">' + esc(piece.composer || '') + '</creator></identification>' +
      '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">';
    var openR = {}, openL = {};
    for (var i = 0; i < rh.length; i++) {
      var a = sum(rh[i]), b = sum(lh[i]), pickup = piece.pickup && i === 0;
      if (a !== b || (!pickup && a !== barLen)) throw new Error(piece.title + ': bar ' + (i + 1) + ' adds up to ' + a + ' / ' + b + ', expected ' + barLen);
      x += '<measure number="' + (piece.pickup ? i : i + 1) + '"' + (pickup ? ' implicit="yes"' : '') + '>';
      if (i === 0) {
        x += '<attributes><divisions>' + DIV + '</divisions><key><fifths>' + (piece.key || 0) + '</fifths></key><time><beats>' + piece.time[0] + '</beats><beat-type>' + piece.time[1] + '</beat-type></time>' +
          '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>' +
          '<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>' + piece.tempo + '</per-minute></metronome></direction-type><staff>1</staff><sound tempo="' + piece.tempo + '"/></direction>';
      }
      rh[i].forEach(function (ev) { x += noteXml(ev, 1, 1, openR); });
      x += '<backup><duration>' + a + '</duration></backup>';
      lh[i].forEach(function (ev) { x += noteXml(ev, 2, 5, openL); });
      if (i === rh.length - 1) x += '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
      x += '</measure>';
    }
    return x + '</part></score-partwise>';
  }

  // Bach's first prelude: every bar is one broken chord played twice.
  function prelude(chords) {
    var rh = [], lh = [];
    chords.forEach(function (c) {
      var n = c.split(' '), half = 're ' + n[2] + 's ' + n[3] + 's ' + n[4] + 's ' + n[2] + 's ' + n[3] + 's ' + n[4] + 's';
      rh.push(half + ' ' + half);
      lh.push(n[0] + 's ' + n[1] + 's re rq ' + n[0] + 's ' + n[1] + 's re rq');
    });
    return { rh: rh.join(' | '), lh: lh.join(' | ') };
  }
  var pre = prelude(['c4 e4 g4 c5 e5', 'c4 d4 a4 d5 f5', 'b3 d4 g4 d5 f5', 'c4 e4 g4 c5 e5', 'c4 e4 a4 e5 a5', 'c4 d4 f#4 a4 d5', 'b3 d4 g4 d5 g5',
    'b3 c4 e4 g4 c5', 'a3 c4 e4 g4 c5', 'd3 a3 d4 f#4 c5', 'g3 b3 d4 g4 b4', 'g3 bb3 e4 g4 c#5', 'f3 a3 d4 a4 d5', 'f3 ab3 d4 f4 b4',
    'e3 g3 c4 g4 c5', 'e3 f3 a3 c4 f4', 'd3 f3 a3 c4 f4', 'g2 d3 g3 b3 f4', 'c3 e3 g3 c4 e4']);

  var LIBRARY = [
    { id: 'five-finger', group: 'Warm-ups', title: 'Five-finger warm-up', composer: 'Exercise', note: 'Right hand walks up and down five keys over a held left hand.',
      key: 0, time: [4, 4], tempo: 80,
      rh: 'c4q d4q e4q f4q | g4q f4q e4q d4q | c4q e4q g4q e4q | c4w',
      lh: '[c3 g3]w | [c3 g3]w | [c3 e3 g3]w | [c3 e3 g3]w' },
    { id: 'c-scale', group: 'Warm-ups', title: 'C major scale', composer: 'Exercise', note: 'Both hands, one octave up and back. Try each hand alone first.',
      key: 0, time: [4, 4], tempo: 80,
      rh: 'c4q d4q e4q f4q | g4q a4q b4q c5q | b4q a4q g4q f4q | e4q d4q c4h',
      lh: 'c3q d3q e3q f3q | g3q a3q b3q c4q | b3q a3q g3q f3q | e3q d3q c3h' },
    { id: 'chords', group: 'Warm-ups', title: 'Chord changes in C', composer: 'Exercise', note: 'C, F and G chords in the right hand over single bass notes.',
      key: 0, time: [4, 4], tempo: 66,
      rh: '[c4 e4 g4]h [c4 f4 a4]h | [b3 d4 g4]h [c4 e4 g4]h | [c4 e4 g4]h [c4 f4 a4]h | [b3 f4 g4]h [c4 e4 g4]h',
      lh: 'c3h f3h | g3h c3h | c3h f2h | g2h c3h' },
    { id: 'ode', group: 'Pieces', title: 'Ode to Joy', composer: 'Ludwig van Beethoven', note: 'The theme from the Ninth Symphony, with a simple left hand.',
      key: 0, time: [4, 4], tempo: 100,
      rh: 'e4q e4q f4q g4q | g4q f4q e4q d4q | c4q c4q d4q e4q | e4q. d4e d4h | e4q e4q f4q g4q | g4q f4q e4q d4q | c4q c4q d4q e4q | d4q. c4e c4h | ' +
          'd4q d4q e4q c4q | d4q e4e f4e e4q c4q | d4q e4e f4e e4q d4q | c4q d4q g3h | e4q e4q f4q g4q | g4q f4q e4q d4q | c4q c4q d4q e4q | d4q. c4e c4h',
      lh: '[c3 g3]w | [b2 g3]w | [c3 g3]w | [c3 g3]h [b2 g3]h | [c3 g3]w | [b2 g3]w | [c3 g3]w | [b2 g3]h [c3 g3]h | ' +
          '[b2 g3]h [c3 g3]h | [b2 g3]h [c3 g3]h | [b2 g3]h [c3 g3]h | [c3 g3]q [b2 g3]q [b2 g3]h | [c3 g3]w | [b2 g3]w | [c3 g3]w | [b2 g3]h [c3 g3]h' },
    { id: 'minuet', group: 'Pieces', title: 'Minuet in G', composer: 'Christian Petzold (Anna Magdalena Notebook)', note: 'First half. Watch the F sharps.',
      key: 1, time: [3, 4], tempo: 100,
      rh: 'd5q g4e a4e b4e c5e | d5q g4q g4q | e5q c5e d5e e5e f#5e | g5q g4q g4q | c5q d5e c5e b4e a4e | b4q c5e b4e a4e g4e | f#4q g4e a4e b4e g4e | b4q a4h | ' +
          'd5q g4e a4e b4e c5e | d5q g4q g4q | e5q c5e d5e e5e f#5e | g5q g4q g4q | c5q d5e c5e b4e a4e | b4q c5e b4e a4e g4e | a4q b4e a4e g4e f#4e | g4h.',
      lh: '[g3 b3 d4]h a3q | b3h. | c4h. | b3h. | a3h. | g3h. | d4q b3q g3q | d4q d3e c4e b3e a3e | ' +
          'b3h a3q | g3q b3q g3q | c4h. | b3q c4e b3e a3e g3e | a3h f#3q | g3h b3q | c4q d4q d3q | g3h g2q' },
    { id: 'prelude', group: 'Pieces', title: 'Prelude in C', composer: 'Johann Sebastian Bach', note: 'Bars 1 to 19. Hold the two left-hand notes while the right hand plays, or use the pedal.',
      key: 0, time: [4, 4], tempo: 60, rh: pre.rh, lh: pre.lh },
    { id: 'elise', group: 'Pieces', title: 'Für Elise', composer: 'Ludwig van Beethoven', note: 'The opening phrase.',
      key: 0, time: [3, 8], tempo: 60, pickup: true,
      rh: 'e5s d#5s | e5s d#5s e5s b4s d5s c5s | a4e rs c4s e4s a4s | b4e rs e4s g#4s b4s | c5e rs e4s e5s d#5s | e5s d#5s e5s b4s d5s c5s | a4e rs c4s e4s a4s | b4e rs e4s c5s b4s | a4q re',
      lh: 're | rq. | a2s e3s a3s rs re | e2s e3s g#3s rs re | a2s e3s a3s rs re | rq. | a2s e3s a3s rs re | e2s e3s g#3s rs re | a2s e3s a3s rs re' },
    { id: 'gymnopedie', group: 'Pieces', title: 'Gymnopédie No. 1', composer: 'Erik Satie', note: 'The opening. Slow, with the pedal; the bass note comes first, then the chord.',
      key: 2, time: [3, 4], tempo: 66,
      rh: 'rh. | rh. | rh. | rh. | rq f#5q a5q | g5q f#5q c#5q | b4q c#5q d5q | a4h. | f#4h.~ | f#4h.~ | f#4h.~ | f#4h.',
      lh: 'g2q [b3 d4 f#4]h | d2q [a3 c#4 f#4]h | g2q [b3 d4 f#4]h | d2q [a3 c#4 f#4]h | g2q [b3 d4 f#4]h | d2q [a3 c#4 f#4]h | g2q [b3 d4 f#4]h | d2q [a3 c#4 f#4]h | g2q [b3 d4 f#4]h | d2q [a3 c#4 f#4]h | g2q [b3 d4 f#4]h | d2q [a3 c#4 f#4]h' },
    { id: 'jingle', group: 'Seasonal', title: 'Jingle Bells', composer: 'James Lord Pierpont', note: 'The chorus.',
      key: 0, time: [4, 4], tempo: 108,
      rh: 'e4q e4q e4h | e4q e4q e4h | e4q g4q c4q. d4e | e4w | f4q f4q f4q. f4e | f4q e4q e4q e4e e4e | e4q d4q d4q e4q | d4h g4h | ' +
          'e4q e4q e4h | e4q e4q e4h | e4q g4q c4q. d4e | e4w | f4q f4q f4q. f4e | f4q e4q e4q e4e e4e | g4q g4q f4q d4q | c4w',
      lh: '[c3 g3]w | [c3 g3]w | [c3 g3]w | [c3 g3]w | [c3 f3 a3]w | [c3 g3]w | [d3 a3]w | [b2 g3]w | [c3 g3]w | [c3 g3]w | [c3 g3]w | [c3 g3]w | [c3 f3 a3]w | [c3 g3]w | [b2 g3]w | [c3 g3]w' },
    { id: 'silent', group: 'Seasonal', title: 'Silent Night', composer: 'Franz Xaver Gruber', note: 'Gentle and even, three beats to the bar.',
      key: 0, time: [3, 4], tempo: 84,
      rh: 'g4q. a4e g4q | e4h. | g4q. a4e g4q | e4h. | d5h d5q | b4h. | c5h c5q | g4h. | a4h a4q | c5q. b4e a4q | g4q. a4e g4q | e4h. | ' +
          'a4h a4q | c5q. b4e a4q | g4q. a4e g4q | e4h. | d5h d5q | f5q. d5e b4q | c5h. | e5h. | c5q g4q e4q | g4q. f4e d4q | c4h.~ | c4h.',
      lh: '[c3 g3]h. | [c3 g3]h. | [c3 g3]h. | [c3 g3]h. | [b2 g3]h. | [b2 g3]h. | [c3 g3]h. | [c3 g3]h. | [f3 a3]h. | [f3 a3]h. | [c3 g3]h. | [c3 g3]h. | ' +
          '[f3 a3]h. | [f3 a3]h. | [c3 g3]h. | [c3 g3]h. | [b2 g3]h. | [b2 g3]h. | [c3 g3]h. | [c3 g3]h. | [c3 g3]h. | [b2 g3]h. | [c3 g3]h. | [c3 g3]h.' }
  ];

  return { library: LIBRARY, toMusicXml: toMusicXml, parseHand: parseHand };
});
