/* Keeps a clean copy of the page's markup before any other script changes it.
   The Download button builds the downloadable file from this copy. Must stay the first script. */
(function () {
  var kids = document.body.children, keep = [];
  for (var i = 0; i < kids.length; i++) if (kids[i].tagName !== 'SCRIPT') keep.push(kids[i].outerHTML);
  window.PianoCoachMarkup = keep;
  // As a Claude artifact the page sits inside a frame, and the microphone is blocked there.
  var framed = false;
  try { framed = window.self !== window.top; } catch (e) { framed = true; }
  window.PianoCoachPreview = framed || !!(window.claude && window.claude.use);
})();
