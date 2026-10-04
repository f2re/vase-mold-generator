"""Load the real ES modules from local files when browser navigation is restricted.
Only module URLs are rewritten. Runtime logic, meshes, styles and DOM are unchanged.
Production HTTP delivery must be tested separately with VMG_TEST_URL.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def load_app(page, url=None):
    if url:
        page.goto(url, wait_until='networkidle')
    else:
        html = (ROOT / 'index.html').read_text()
        html = re.sub(r'<script type="module"[^>]+></script>', '', html)
        html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>' + (ROOT / 'styles.css').read_text() + '</style>')
        html = re.sub(r'<link rel="icon"[^>]+>', '', html)
        page.set_content(html)
        source = {p.name:p.read_text() for p in (ROOT / 'src').glob('*.js')}
        page.evaluate('''async source => {
          const urls = {};
          for (const name of ['geometry.js','export.js','viewer.js','worker.js','app.js']) {
            let code=source[name];
            for (const [file,url] of Object.entries(urls)) code=code.replaceAll("'./"+file+"'",JSON.stringify(url));
            // A module Worker accepts its Blob URL as an absolute URL.
            urls[name]=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
          }
          window.__fixtureModules=urls;
          await import(urls['app.js']);
        }''', source)
    page.wait_for_function('window.vmg && window.vmg.ready', timeout=30000)
