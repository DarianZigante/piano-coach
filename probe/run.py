import sys, json
from playwright.sync_api import sync_playwright
url, shot = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--allow-file-access-from-files'])
    pg = b.new_page(viewport={'width': 1200, 'height': 900})
    logs = []
    pg.on('console', lambda m: logs.append(m.text)); pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
    pg.goto(url); pg.wait_for_function("document.title === 'done'", timeout=30000)
    print(json.dumps(pg.evaluate('window.__out'), indent=1)[:6000])
    print('LOGS', logs[:10])
    pg.screenshot(path=shot, full_page=True)
    b.close()
