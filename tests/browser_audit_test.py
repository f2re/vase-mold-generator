"""Regression scenarios found during the 0.3.1 audit, using actual CSG jobs."""
import json
import os
from pathlib import Path
import sys
import threading
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from playwright.sync_api import sync_playwright
from browser_fixture import load_app,install_http_bridge
from serve import Server
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('VMG_SCREENSHOT_DIR','artifacts'))/'audit';OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('VMG_TEST_URL');bridge=bool(os.environ.get('VMG_TEST_BRIDGE'));server=None
if not URL:
    server=Server(('127.0.0.1',0));threading.Thread(target=server.serve_forever,daemon=True).start();URL=f'http://127.0.0.1:{server.server_port}'
passed=[];errors=[]
def check(name,value):
    assert value,name
    passed.append(name);print('PASS',name,flush=True)
try:
 with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('VMG_CHROMIUM') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1500,'height':1060})
    page.on('pageerror',lambda e:errors.append(str(e)))
    if bridge:install_http_bridge(page,URL)
    load_app(page,None if bridge else URL)
    page.locator('#detail').select_option('fine');page.wait_for_function('vmg.ready && vmg.model.resolution.detail==="fine"')
    check('vase detail controls actual tessellation and error bound',page.evaluate('vmg.model.resolution.maxDeviationMm<=.01 && vmg.model.resolution.segments>128'))
    page.locator('#detail').select_option('custom');page.locator('#chordTolerance').fill('.005');page.wait_for_function('vmg.ready && vmg.model.resolution.chordToleranceMm===.005')
    check('custom tolerance reaches real geometry',page.evaluate('vmg.model.resolution.maxDeviationMm<=.005'))
    page.locator('#chordTolerance').fill('0');check('invalid detail blocks output',page.locator('#exportAll').is_disabled())
    page.locator('#detail').select_option('standard');page.wait_for_function('vmg.ready');check('switching preset recovers from hidden invalid tolerance',page.locator('#exportAll').is_enabled())
    before=page.evaluate('vmg.model.parts[0].mesh.length');page.locator('#meshEdges').check();page.wait_for_timeout(120)
    check('wire view preserves export mesh',page.evaluate('vmg.model.parts[0].mesh.length')==before and page.evaluate('vmg.viewer.meshEdges().length>0'))
    page.locator('#meshEdges').uncheck();page.locator('[data-source-mode="stl"]').click();page.locator('#stlFile').set_input_files(ROOT/'examples/capsule.stl');page.wait_for_function('vmg.stl.mesh')
    check('valid STL preview can be saved before CAD',page.locator('#saveProject').is_enabled() and page.locator('#exportAll').is_disabled())
    page.locator('#stl-kind').select_option('negative');page.locator('#stl-padding').fill('999');page.locator('#stl-kind').select_option('box')
    check('inactive negative error does not block enclosure',page.evaluate('vmg.stl.options().padding===10') and 'проверьте допустимое' not in page.locator('#stlMessage').inner_text())
    page.locator('#stl-kind').select_option('negative');page.locator('#stl-padding').fill('10');page.locator('#pickSprue').click();page.locator('#view3d').focus();page.keyboard.press('Escape')
    check('Escape cancels surface-point mode',page.evaluate('vmg.viewer.pointPicker===null'))
    page.locator('#stl-kind').select_option('box');page.locator('#stl-detail').select_option('fine')
    page.wait_for_function('vmg.stl.engine?.available')
    page.locator('#buildSTL').click();page.wait_for_function('vmg.ready',timeout=120000)
    check('fine CSG result carries full numeric quality report',page.evaluate('vmg.model.resolution.chordToleranceMm===.01 && vmg.model.parts.filter(p=>p.printable).every(p=>p.quality.geometryChecked)'))
    current=page.evaluate('vmg.model.sourceSha256');project=page.evaluate('vmg.stl.project()');project['parameters']['kind']='bad-kind'
    page.locator('#projectFile').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':json.dumps(project).encode()});page.wait_for_timeout(100)
    check('invalid JSON preserves model and every active setting',page.evaluate('vmg.ready && vmg.stl.options().kind==="box"') and page.evaluate('vmg.model.sourceSha256')==current)
    page.locator('[data-source-mode="vase"]').click();page.wait_for_function('vmg.ready && !vmg.model.kind')
    page.locator('#projectFile').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':json.dumps(project).encode()});page.wait_for_timeout(100)
    check('invalid STL project cannot switch source mode',page.evaluate('vmg.sourceMode==="vase" && vmg.ready'))
    page.locator('[data-source-mode="stl"]').click()
    # A real File read that completes late must not overwrite a newer load.
    page.evaluate('''async()=>{
      const controller=vmg.stl,raw=controller.raw.slice(0);
      const slow=new File([raw],'slow.stl');slow.arrayBuffer=async()=>{await new Promise(r=>setTimeout(r,150));return raw;};
      const p=controller.load(slow);await controller.load(new File([raw],'latest.stl'));await p;
    }''')
    check('latest asynchronous STL load wins',page.evaluate('vmg.stl.name==="latest.stl"'))
    # Delayed POST response, but the server and the CAD job are not mocked.
    page.evaluate('''()=>{
      const fetchOriginal=window.fetch;
      window.fetch=async(...args)=>{const r=await fetchOriginal(...args);if(args[0]==='/api/jobs' && args[1]?.method==='POST')await new Promise(resolve=>setTimeout(resolve,700));return r;};
    }''')
    page.locator('#buildSTL').click();page.wait_for_function('vmg.stl.submitting')
    check('submit phase prevents accidental double job',page.locator('#buildSTL').is_disabled())
    page.locator('#stl-scale').fill('.7');page.wait_for_timeout(1000)
    check('late result after edit cannot revive old export',page.evaluate('!vmg.ready && vmg.stl.job===null && vmg.stl.options().scale===.7'))
    page.locator('#buildSTL').click();page.wait_for_function('vmg.ready && vmg.model.p.scale===.7',timeout=120000)
    check('new generation recovers after in-flight cancellation',page.locator('#exportAll').is_enabled())
    page.locator('[data-mode="explode"]').click();page.locator('[data-camera="iso"]').click()
    page.evaluate('vmg.viewer.select(null);document.querySelector("#toast").hidden=true;document.querySelector(".workspace").scrollTop=0;document.querySelector(".parameters").scrollTop=0')
    page.wait_for_timeout(300);page.screenshot(path=str(OUT/'quality-desktop.png'),full_page=True)
    check('desktop viewport fits controls',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
    page.set_viewport_size({'width':390,'height':844});page.locator('#stl-detail').select_option('custom');page.locator('#stl-chordTolerance').fill('.005');page.locator('#buildSTL').click();page.wait_for_function('vmg.ready',timeout=120000)
    check('mobile custom quality remains usable without overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
    page.screenshot(path=str(OUT/'quality-mobile.png'),full_page=True)
    check('no uncaught errors across audit flows',not errors)
    (OUT/'results.json').write_text(json.dumps({'passed':len(passed),'checks':passed,'errors':errors,'transport':'HTTP bridge' if bridge else 'HTTP','renderer':page.evaluate('vmg.viewer.backend')},ensure_ascii=False,indent=2))
    browser.close()
finally:
 if server:server.shutdown();server.server_close()
