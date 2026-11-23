import sys, json, time
from playwright.sync_api import sync_playwright
url = sys.argv[1]; piece = sys.argv[2]; shot = sys.argv[3]
wav = sys.argv[4] if len(sys.argv) > 4 else None
wait = float(sys.argv[5]) if len(sys.argv) > 5 else 0
args = ['--no-sandbox', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required']
if wav: args += ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + wav + '%noloop']
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=args)
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['microphone'] if wav else [])
    pg = ctx.new_page(); logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text)); pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
    pg.goto(url); pg.wait_for_selector('#groups .card')
    if piece == 'library':
        pg.screenshot(path=shot)
    else:
        pg.click(f'#groups .card:has(h3:text-is("{piece}"))'); pg.wait_for_selector('#score svg', timeout=20000); time.sleep(0.6)
        if wav:
            pg.click('#go'); time.sleep(wait)
            print('state', json.dumps(pg.evaluate("({listening: PianoCoach.listening, cur: PianoCoach.cur, steps: PianoCoach.steps.length, mistakes: PianoCoach.mistakes, report: !document.getElementById('report').hidden, say: document.getElementById('say').innerText, pct: document.getElementById('repPct').innerText, sub: document.getElementById('repSub').innerText, sr: PianoCoach.audio && PianoCoach.audio.ctx.sampleRate})")))
        pg.screenshot(path=shot)
    print('LOGS', logs[:12])
    b.close()
