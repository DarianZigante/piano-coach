# Browser check for the artifact build (dist/artifact/index.html) and the file its Download button produces.
# Usage: python3 probe/artifact.py <base url of repo root> <wav of "Five-finger warm-up"> <work dir>
import sys, json, time, os, re
from playwright.sync_api import sync_playwright

base, wav, work = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
os.makedirs(work, exist_ok=True)
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
lib = open(os.path.join(here, 'node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js'), 'rb').read()
CDN = 'https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@1.9.0/build/opensheetmusicdisplay.min.js'
fails = []
def check(name, ok, extra=''):
    print(('PASS ' if ok else 'FAIL ') + name + (' :: ' + str(extra)[:300] if extra and not ok else ''))
    if not ok: fails.append(name)

AS_ARTIFACT = """
window.claude = { use: function (n) { return new Promise(function (r) { setTimeout(function () {
  r(n === 'downloads' ? { save: function (req) { window.__saved = req; return Promise.resolve({ status: 'saved' }); } } : null); }, 60); }); } };
navigator.mediaDevices.getUserMedia = function () { return Promise.reject(new DOMException('blocked by frame', 'NotAllowedError')); };
"""
def page(b, init=None, mic=False):
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['microphone'] if mic else [])
    ctx.route(CDN, lambda r: r.fulfill(status=200, content_type='application/javascript', body=lib))
    if init: ctx.add_init_script(init)
    pg = ctx.new_page(); pg.logs = []
    pg.on('console', lambda m: pg.logs.append(m.type + ': ' + m.text)); pg.on('pageerror', lambda e: pg.logs.append('PAGEERROR ' + str(e)))
    return pg

with sync_playwright() as p:
    args = ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + wav + '%noloop']
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=args)

    # 1. As an artifact: download strip, preview, microphone message, download
    pg = page(b, AS_ARTIFACT)
    pg.goto(base + '/dist/artifact/index.html'); pg.wait_for_selector('#groups .card')
    check('download strip shows in the artifact', pg.is_visible('#dl'))
    pg.screenshot(path=work + '/artifact_library.png')
    pg.click('#groups .card:has(h3:text-is("Minuet in G"))'); pg.wait_for_selector('#score svg', timeout=20000); time.sleep(0.5)
    check('sheet music draws with the library from the CDN', pg.evaluate("document.querySelectorAll('#score svg').length") > 0)
    box = pg.evaluate("(function(){var k=document.getElementById('keys').getBoundingClientRect();return [k.bottom, innerHeight, document.documentElement.scrollHeight]})()")
    check('layout still fits one screen with the strip', abs(box[0] - box[1]) < 2 and box[2] <= box[1] + 1, box)
    pg.click('#go'); time.sleep(0.5)
    check('microphone message explains the preview', 'cannot work in this preview' in pg.inner_text('#say'), pg.inner_text('#say'))
    pg.screenshot(path=work + '/artifact_practice.png')
    time.sleep(0.2); pg.click('#dlBtn'); time.sleep(0.4)
    saved = pg.evaluate("window.__saved ? { filename: window.__saved.filename, data: window.__saved.data } : null")
    check('download offered', bool(saved))
    check('file name carries date and time', bool(saved) and re.match(r'^Piano Coach \d{4}-\d\d-\d\d \d{4}\.html$', saved['filename']) is not None, saved and saved['filename'])
    check('saved message', 'Saved as' in pg.inner_text('#dlMsg'), pg.inner_text('#dlMsg'))
    html = saved['data']
    order = re.findall(r'<script data-part="([a-z]+)"', html.split('</head>', 1)[1])
    check('all parts present, in order', order == ['snapshot', 'osmd', 'engine', 'follower', 'pieces', 'app', 'download'], order)
    check('starts as an HTML document with the notes', html.startswith('<!DOCTYPE html>') and 'PIANO COACH: notes for whoever edits' in html.split('<style', 1)[0])
    check('markup is the clean copy', 'id="dl" hidden' in html and '<div id="groups"></div>' in html and '<div id="keys" aria-hidden="true"></div>' in html)
    built = open(os.path.join(here, 'dist/artifact/index.html'), encoding='utf8').read()
    norm = lambda s: re.sub(r'\s+', ' ', s)
    for part in ['engine', 'follower', 'pieces', 'app']:
        seg = lambda s: s.split('</head>', 1)[1].split('<script data-part="%s">' % part, 1)[1].split('</script>', 1)[0]
        check('script "%s" is byte-identical to the built page' % part, seg(html) == seg(built))
    out = os.path.join(work, 'Piano Coach downloaded.html'); open(out, 'w', encoding='utf8').write(html)
    print('downloaded size', len(html) // 1000, 'KB')
    bad = [l for l in pg.logs if 'PAGEERROR' in l or l.startswith('error')]
    check('no page errors as an artifact', not bad, bad)

    # 2. The downloaded file, opened from disk like she would
    pg = page(b, None, mic=True)
    pg.goto('file://' + out.replace(' ', '%20')); pg.wait_for_selector('#groups .card')
    check('download strip hidden in the downloaded file', not pg.is_visible('#dl') and not pg.evaluate("window.PianoCoachPreview"))
    check('version shown', pg.inner_text('#version').startswith('Version '))
    pg.click('#groups .card:has(h3:text-is("Five-finger warm-up"))'); pg.wait_for_selector('#score svg', timeout=20000); time.sleep(0.6)
    pg.click('#go'); time.sleep(22)
    st = pg.evaluate("({report: !document.getElementById('report').hidden, pct: document.getElementById('repPct').innerText, sub: document.getElementById('repSub').innerText, sr: PianoCoach.audio && PianoCoach.audio.ctx.sampleRate})")
    print('run from the downloaded file:', json.dumps(st))
    check('listening works in the downloaded file (same score as the hosted page)', st['report'] and st['pct'] == '92%' and st['sub'].startswith('12 of 13'), st)
    pg.click('#askRep'); check('report-or-request works in the downloaded file', pg.is_visible('#ask'))
    bad = [l for l in pg.logs if 'PAGEERROR' in l or l.startswith('error')]
    check('no page errors in the downloaded file', not bad, bad)

    # 3. Downloading again from a downloaded copy gives the same file (nothing drifts)
    pg = page(b, AS_ARTIFACT)
    pg.goto('file://' + out.replace(' ', '%20')); pg.wait_for_selector('#groups .card'); time.sleep(0.3)
    again = pg.evaluate("window.PianoCoachBuild()")
    check('a second download is identical to the first', again == html, (len(again), len(html)))
    b.close()
print('RESULT', 'ok' if not fails else 'FAILED: ' + ', '.join(fails))
sys.exit(1 if fails else 0)
