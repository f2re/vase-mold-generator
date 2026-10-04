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
          for (const name of ['geometry.js','stl.js','export.js','viewer.js','worker.js','stl-mode.js','app.js']) {
            let code=source[name];
            for (const [file,url] of Object.entries(urls)) code=code.replaceAll("'./"+file+"'",JSON.stringify(url));
            // A module Worker accepts its Blob URL as an absolute URL.
            urls[name]=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
          }
          window.__fixtureModules=urls;
          await import(urls['app.js']);
        }''', source)
    page.wait_for_function('window.vmg && window.vmg.ready', timeout=30000)


def install_http_bridge(page, base_url):
    """Test transport for a browser that cannot navigate to loopback.
    The real server, job queue and OpenSCAD run unchanged. Not a mock result.
    Only this app's relative API/example URLs can cross the bridge.
    """
    import base64
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError
    def bridge(request):
        path=request['path']
        if not path.startswith(('/api/','examples/')) or '..' in path or '://' in path:
            raise ValueError('Test bridge only accepts local VMG resources')
        req=Request(base_url+'/'+path.lstrip('/'),data=request.get('body','').encode() if request.get('body') else None,
                    headers=request.get('headers',{}),method=request.get('method','GET'))
        try:
            with urlopen(req,timeout=30) as response:
                body=response.read();status=response.status;kind=response.headers.get('Content-Type','application/octet-stream')
        except HTTPError as response:
            body=response.read();status=response.code;kind='application/json'
        return {'status':status,'kind':kind,'body':base64.b64encode(body).decode()}
    page.expose_function('__vmgHTTPBridge',bridge)
    page.evaluate('''() => {
      const original=window.fetch.bind(window);
      window.fetch=async (input,init={})=>{
        if(typeof input!=='string'||(!input.startsWith('/api/')&&!input.startsWith('examples/')))return original(input,init);
        const data=await window.__vmgHTTPBridge({path:input,method:init.method||'GET',headers:Object.fromEntries(new Headers(init.headers).entries()),body:init.body||''});
        return new Response(Uint8Array.from(atob(data.body),c=>c.charCodeAt(0)),{status:data.status,headers:{'Content-Type':data.kind}});
      };
    }''')
