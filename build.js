// Builds the page from src/ in two forms:
//   index.html                the hosted page (GitHub Pages). Fully self-contained.
//   dist/artifact/index.html  the same page for publishing as a Claude artifact: the sheet-music
//                             library loads from a CDN so the file stays small enough to edit in a
//                             chat, and a Download button is added because the microphone is
//                             blocked inside an artifact.
// Usage: node build.js
const fs = require('fs'), path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
const OSMD = 'opensheetmusicdisplay 1.9.0 (BSD-3-Clause), https://opensheetmusicdisplay.org';
const CDN = 'https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@1.9.0/build/opensheetmusicdisplay.min.js';
const inline = (part, js) => `<script data-part="${part}">\n${safe(js)}\n</script>`;
const own = [['engine', 'src/engine.js'], ['follower', 'src/follower.js'], ['pieces', 'src/pieces.js'], ['app', 'src/app.js']]
  .map(([part, file]) => inline(part, read(file)));
// Shown at the bottom of the first screen so it is easy to tell which version is open.
const stamp = new Date().toLocaleString('en-CA', {
  timeZone: 'America/Toronto', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
});
function make(out, note, scripts) {
  const html = read('src/template.html')
    .replace('<!--NOTE-->\n', () => note)
    .replace('<!--SCRIPTS-->', () => scripts.join('\n'))
    .replace('<!--BUILD-->', () => stamp);
  fs.mkdirSync(path.dirname(path.join(__dirname, out)), { recursive: true });
  fs.writeFileSync(path.join(__dirname, out), html);
  console.log('wrote', out, (html.length / 1e3).toFixed(0), 'KB');
}
make('index.html', '', [inline('osmd', `/* ${OSMD} */\n` + read('node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js'))].concat(own));
make('dist/artifact/index.html', `<!--\n${read('src/artifact/note.txt')}-->\n`, [
  inline('snapshot', read('src/artifact/snapshot.js')),
  `<script data-part="osmd" src="${CDN}"></script>`,
].concat(own, [inline('download', read('src/artifact/download.js'))]));
console.log('version', stamp);
