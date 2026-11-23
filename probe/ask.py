# Browser check for the "Report or request" dialog.
# Usage: python3 probe/ask.py <url> <wav of a short performance of "Five-finger warm-up"> <screenshot dir>
import sys, json, time, urllib.parse
from playwright.sync_api import sync_playwright

url, wav, shots = sys.argv[1], sys.argv[2], sys.argv[3]
args = ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + wav + '%noloop']
fails = []
def check(name, ok, extra=''):
    print(('PASS ' if ok else 'FAIL ') + name + (' :: ' + str(extra) if extra and not ok else ''))
    if not ok: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=args)
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['microphone', 'clipboard-read', 'clipboard-write'])
    pg = ctx.new_page(); logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text)); pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
    pg.goto(url); pg.wait_for_selector('#groups .card')

    # 1. From the list of pieces
    pg.click('#askLib')
    check('dialog opens from the library', pg.is_visible('#ask'))
    check('text box has focus', pg.evaluate("document.activeElement.id") == 'askText')
    pg.click('#askSend')
    check('empty note is refused', 'few words' in pg.inner_text('#askHelp'))
    pg.click('[data-kind=request]')
    check('request wording', 'added or changed' in pg.inner_text('#askPrompt'))
    pg.fill('#askText', 'Please add "Clair de Lune" & a metronome.\nThanks!')
    n = pg.evaluate("PianoCoach.ask.note()")
    check('subject for a request', n['subject'] == '[Piano Coach] Request', n['subject'])
    check('mailto address', n['url'].startswith('mailto:darian.zigante@gmail.com?subject='), n['url'][:60])
    q = urllib.parse.parse_qs(n['url'].split('?', 1)[1])
    check('body survives encoding', q['body'][0].replace('\r\n', '\n') == n['body'], q['body'][0][:80])
    check('body has note and details', n['body'].startswith('Please add "Clair de Lune" & a metronome.\nThanks!\n\n---\n') and 'Screen: list of pieces' in n['body'] and 'Version: ' in n['body'], n['body'])
    pg.screenshot(path=shots + '/ask_library.png')
    pg.click('#askCopy'); time.sleep(0.3)
    clip = pg.evaluate("navigator.clipboard.readText()")
    check('copy puts address, subject and note on the clipboard', clip.startswith('To: darian.zigante@gmail.com\nSubject: [Piano Coach] Request\n\nPlease add'), clip[:90])
    check('copy confirmation', 'Copied' in pg.inner_text('#askHelp'))
    check('cancel becomes close', pg.inner_text('#askCancel') == 'Close')
    pg.keyboard.press('Escape')
    check('escape closes', not pg.is_visible('#ask'))
    pg.click('#askLib')
    check('text is cleared after a note was used', pg.input_value('#askText') == '')
    pg.click('#askCancel')

    # 2. In the middle of a run
    pg.click('#groups .card:has(h3:text-is("Five-finger warm-up"))'); pg.wait_for_selector('#score svg', timeout=20000); time.sleep(0.6)
    pg.click('#go'); time.sleep(7)
    was = pg.evaluate("PianoCoach.listening")
    pg.click('#askBtn')
    check('was listening before the dialog', was)
    check('listening stops when the dialog opens', pg.evaluate("PianoCoach.listening") is False)
    info = pg.text_content('#askInfo')
    print('--- details mid-run ---\n' + info + '\n---')
    check('details: piece', 'Piece: Five-finger warm-up' in info)
    check('details: listening state', 'Listening: yes' in info)
    check('details: position', 'At: bar ' in info and 'music has' in info)
    check('details: running record', 'Recent: ' in info and 'start at 1' in info)
    check('details: microphone', 'Microphone: ' in info and ' Hz' in info)
    pg.fill('#askText', 'It kept waiting in this bar.')
    n = pg.evaluate("PianoCoach.ask.note()")
    check('subject for a problem', n['subject'].startswith('[Piano Coach] Problem: Five-finger warm-up, bar '), n['subject'])
    check('link length is safe', len(n['url']) < 6000, len(n['url']))
    print('subject:', n['subject'], '| link length:', len(n['url']))
    pg.screenshot(path=shots + '/ask_practice.png')
    pg.click('#askSend'); time.sleep(0.5)
    check('page still here after Open email', pg.is_visible('#ask') and 'should now be open' in pg.inner_text('#askHelp'), pg.inner_text('#askHelp'))
    pg.click('#askCancel')
    check('focus returns to the button', pg.evaluate("document.activeElement.id") == 'askBtn')

    # 3. After a finished run
    pg.click('#restart'); time.sleep(0.3)
    pg.evaluate("PianoCoach.listening || document.getElementById('go').click()"); time.sleep(1.5)
    for _ in range(40):
        if pg.evaluate("PianoCoach.listening"): pg.keyboard.press('ArrowRight'); time.sleep(0.12)
    time.sleep(0.5)
    check('run report shows', pg.is_visible('#report'))
    pg.click('#askRep')
    info = pg.text_content('#askInfo')
    check('details after a run', 'run finished' in info and 'skipped' in info, info)
    check('dialog sits above the run report', pg.evaluate("(function(){var r=document.getElementById('askText').getBoundingClientRect();return document.elementFromPoint(r.left+5,r.top+5).id})()") == 'askText')
    pg.screenshot(path=shots + '/ask_after_run.png')
    pg.keyboard.press('Escape')

    bad = [l for l in logs if 'PAGEERROR' in l or (l.startswith('error') and 'mailto' not in l.lower() and 'scheme' not in l.lower())]
    check('no page errors', not bad, bad)
    print('LOGS', logs[:8])
    b.close()
print('RESULT', 'ok' if not fails else 'FAILED: ' + ', '.join(fails))
sys.exit(1 if fails else 0)
