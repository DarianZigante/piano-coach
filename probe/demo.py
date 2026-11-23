import sys, json, time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800}); logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text)); pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
    pg.goto(sys.argv[1]); pg.wait_for_selector('#groups .card')
    for name in ['C major scale', 'Chord changes in C', 'Ode to Joy', 'Prelude in C', 'Für Elise', 'Gymnopédie No. 1', 'Jingle Bells', 'Silent Night']:
        pg.click(f'#groups .card:has(h3:text-is("{name}"))'); pg.wait_for_selector('#score svg', timeout=20000); time.sleep(0.4)
        info = pg.evaluate("({steps: PianoCoach.steps.length, bars: PianoCoach.nBars, noEl: PianoCoach.steps.reduce((a,s)=>a+s.notes.filter(n=>!n.el).length,0)})")
        print(name, info)
        if name == 'Für Elise': pg.screenshot(path='/tmp/elise.png')
        if name == 'Gymnopédie No. 1':
            pg.click('[data-hands=right]'); pg.click('#hear'); time.sleep(2.5)
            print('  demo cur', pg.evaluate("PianoCoach.cur"), pg.evaluate("document.getElementById('hear').innerText")); pg.screenshot(path='/tmp/gym.png'); pg.click('#hear')
        if name == 'Prelude in C': pg.click('#zoomOut'); pg.click('#zoomOut'); time.sleep(0.3); pg.screenshot(path='/tmp/prelude.png')
        pg.click('#back')
    print('LOGS', logs[:8]); b.close()
