// Builds the single self-contained page that GitHub Pages serves: index.html
// Usage: node build.js
const fs = require('fs'), path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
const parts = [
  ['opensheetmusicdisplay 1.9.0 (BSD-3-Clause) — https://opensheetmusicdisplay.org', read('node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js')],
  ['listening engine', read('src/engine.js')],
  ['score follower', read('src/follower.js')],
  ['pieces', read('src/pieces.js')],
  ['page', read('src/app.js')],
];
const scripts = parts.map(([name, js]) => `<script>/* ${name} */\n${safe(js)}\n</script>`).join('\n');
// Shown at the bottom of the first screen so it is easy to tell which version is open.
const stamp = new Date().toLocaleString('en-CA', {
  timeZone: 'America/Toronto', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
});
const html = read('src/template.html')
  .replace('<!--SCRIPTS-->', () => scripts)
  .replace('<!--BUILD-->', () => stamp);
const out = path.join(__dirname, 'index.html');
fs.writeFileSync(out, html);
console.log('wrote', out, (html.length / 1e6).toFixed(2), 'MB,', 'version', stamp);
