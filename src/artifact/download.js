/* The Download button. Shown only where the page is open as a Claude artifact, because the
   microphone is blocked there. It builds a standalone copy of this page from its own parts
   (the style, the clean markup, and every script that has a data-part) and offers it as a file. */
(function () {
  if (!window.PianoCoachPreview) return;
  var $ = function (id) { return document.getElementById(id); };
  document.documentElement.classList.add('preview');
  $('dl').hidden = false;
  function msg(t) { $('dlMsg').textContent = t; }

  function build() {
    var head = '', nodes = document.head.childNodes, i, n;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (n.nodeType === 8) { if (/PIANO COACH/.test(n.nodeValue)) head += '<' + '!--' + n.nodeValue + '--' + '>\n'; continue; }
      if (n.nodeType !== 1) continue;
      var mine = (n.tagName === 'META' && (n.hasAttribute('charset') || n.getAttribute('name') === 'viewport')) || n.tagName === 'TITLE' ||
        (n.tagName === 'LINK' && n.getAttribute('rel') === 'icon') || (n.tagName === 'STYLE' && n.hasAttribute('data-part'));
      if (mine) head += n.outerHTML + '\n';
    }
    var scripts = '', ss = document.querySelectorAll('script[data-part]');
    for (i = 0; i < ss.length; i++) {
      var part = ss[i].getAttribute('data-part'), src = ss[i].getAttribute('src');
      var open = '<' + 'script data-part="' + part + '"', close = '<' + '/script>\n';
      scripts += src ? open + ' src="' + src + '">' + close : open + '>' + ss[i].textContent + close;
    }
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' + head + '</head>\n<body>\n' + window.PianoCoachMarkup.join('\n') + '\n' + scripts + '</body>\n</html>\n';
  }
  window.PianoCoachBuild = build;   // for inspection

  var OFF = 'Download is not switched on for this copy. Ask Claude in the chat: "declare the downloads capability for this artifact".';
  var saver = null, state = 'waiting';
  if (window.claude && window.claude.use) {
    window.claude.use('downloads').then(function (d) { saver = d; state = d ? 'ready' : 'off'; if (!d) msg(OFF); }, function () { state = 'off'; msg(OFF); });
  } else { state = 'off'; }

  $('dlBtn').addEventListener('click', function () {
    if (state === 'waiting') { msg('Download is still getting ready. Try again in a few seconds.'); return; }
    if (state === 'off') { msg(OFF); return; }
    var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; };
    var name = 'Piano Coach ' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + p(d.getMinutes()) + '.html';
    msg('');
    saver.save({ filename: name, data: build() }).then(function () {
      msg('Saved as "' + name + '". In your Downloads folder, right-click the file, choose Open With, then Google Chrome.');
    }, function (e) {
      var c = e && e.code;
      if (c === 'declined') msg('');
      else if (c === 'rate_limited') msg('A download is already waiting for your answer.');
      else msg('The download did not work here (' + (c || 'unknown reason') + '). Try Export in the artifact menu, or ask Claude for this page as an HTML file.');
    });
  });
})();
